const DEFAULT_SETTINGS = {
  endpoint: "https://baaka.dn42/search?q={query}",
  timeoutMs: 8000,
  debugEnabled: false,
  proxyEnabled: false,
  proxyTemplate: "https://proxy.dn42.tianyibrad.com/{url}",
};

const PREVIOUS_DEFAULT_ENDPOINT = "https://baaka.dn42/?q={query}";

const CACHE_TTL_MS = 60_000;
const resultCache = new Map();

chrome.runtime.onInstalled.addListener(async (details) => {
  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  if (settings.endpoint === PREVIOUS_DEFAULT_ENDPOINT) {
    settings.endpoint = DEFAULT_SETTINGS.endpoint;
  }
  await chrome.storage.sync.set(settings);

  if (details.reason === "install") {
    await chrome.tabs.create({ url: chrome.runtime.getURL("welcome.html") });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "DN42_OPEN_OPTIONS") {
    chrome.runtime.openOptionsPage();
    return;
  }

  if (message?.type !== "DN42_SEARCH") return;

  search(message.query).then(sendResponse);
  return true;
});

async function search(query) {
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) return { status: "empty", results: [] };

  const settings = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const targetUrl = createSearchUrl(settings.endpoint, normalizedQuery);
  const url = settings.proxyEnabled ? createProxyUrl(settings.proxyTemplate, targetUrl) : targetUrl;
  const cached = resultCache.get(url);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    debugLog(settings, "cache hit", { url });
    return cached.value;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), settings.timeoutMs);
  const startedAt = Date.now();

  try {
    const originPattern = `${new URL(url).origin}/*`;
    const hasHostPermission = await chrome.permissions.contains({ origins: [originPattern] });
    debugLog(settings, "host permission checked", { hasHostPermission, originPattern });

    debugLog(settings, "request started", {
      proxyEnabled: settings.proxyEnabled,
      targetUrl,
      timeoutMs: settings.timeoutMs,
      url,
    });
    const response = await fetch(url, { signal: controller.signal, credentials: "omit" });
    debugLog(settings, "response received", {
      elapsedMs: Date.now() - startedAt,
      finalUrl: response.url,
      status: response.status,
    });
    if (!response.ok) throw new Error(`DN42 endpoint returned HTTP ${response.status}`);

    // Manifest V3 service workers do not expose DOMParser.
    const results = extractSearchResults(await response.text(), response.url);
    const value = { status: "success", results, source: new URL(response.url).hostname };
    resultCache.set(url, { createdAt: Date.now(), value });
    debugLog(settings, "results parsed", { count: results.length });
    return value;
  } catch (error) {
    const endpointHost = getEndpointHost(url);
    const message = error.name === "AbortError"
      ? `The request to ${endpointHost} timed out.`
      : error.message.startsWith("DN42 endpoint returned HTTP")
        ? error.message
        : `Could not connect to ${endpointHost}. Check the DN42 tunnel and route.`;
    debugLog(settings, "request failed", {
      elapsedMs: Date.now() - startedAt,
      error: error.message,
      name: error.name,
      url,
    });

    return {
      status: "offline",
      message,
      results: [],
    };
  } finally {
    clearTimeout(timeout);
  }
}

function debugLog(settings, event, details) {
  if (settings.debugEnabled) {
    console.info(`[DN42 Search Copilot] ${event}`, details);
  }
}

function getEndpointHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "the configured DN42 endpoint";
  }
}

function createSearchUrl(endpoint, query) {
  const configuredEndpoint = String(endpoint || DEFAULT_SETTINGS.endpoint);
  if (configuredEndpoint.includes("{query}")) {
    return configuredEndpoint.replaceAll("{query}", encodeURIComponent(query));
  }

  const url = new URL(configuredEndpoint);
  url.searchParams.set("q", query);
  return url.href;
}

function createProxyUrl(template, targetUrl) {
  const configuredTemplate = String(template || "").trim();
  if (!configuredTemplate.includes("{url}")) {
    throw new Error("The proxy template must contain {url}.");
  }

  const proxyUrl = configuredTemplate.replaceAll("{url}", targetUrl);
  const parsed = new URL(proxyUrl);
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error("The proxy template must use HTTP or HTTPS.");
  }
  return proxyUrl;
}

function extractSearchResults(html, baseUrl) {
  const results = extractSearxResults(html, baseUrl);
  return results.length ? results : extractLinks(html, baseUrl);
}

function extractSearxResults(html, baseUrl) {
  const results = [];
  const seenUrls = new Set();
  const articlePattern = /<article\b([^>]*)>([\s\S]*?)<\/article>/gi;
  let article;

  while ((article = articlePattern.exec(html)) && results.length < 8) {
    const classes = getAttribute(article[1], "class").split(/\s+/);
    if (!classes.includes("result")) continue;

    const heading = article[2].match(/<h3\b[^>]*>[\s\S]*?<a\b([^>]*)>([\s\S]*?)<\/a>[\s\S]*?<\/h3>/i);
    if (!heading) continue;

    const href = getAttribute(heading[1], "href");
    const title = htmlToText(heading[2]);
    const url = toHttpUrl(href, baseUrl);
    if (!url || !title || seenUrls.has(url.href)) continue;

    seenUrls.add(url.href);
    results.push({
      title: title.slice(0, 160),
      url: url.href,
      snippet: extractSnippet(article[2]),
    });
  }

  return results;
}

function extractSnippet(articleHtml) {
  const contentPattern = /<(?:p|div)\b([^>]*)>([\s\S]*?)<\/(?:p|div)>/gi;
  let element;

  while ((element = contentPattern.exec(articleHtml))) {
    if (getAttribute(element[1], "class").split(/\s+/).includes("content")) {
      return htmlToText(element[2]).slice(0, 260);
    }
  }

  return "";
}

function extractLinks(html, baseUrl) {
  const results = [];
  const seenUrls = new Set();
  const anchorPattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;

  while ((match = anchorPattern.exec(html)) && results.length < 8) {
    const href = getAttribute(match[1], "href");
    const title = htmlToText(match[2]);
    if (!href || !title) continue;

    const url = toHttpUrl(href, baseUrl);
    if (!url || seenUrls.has(url.href)) continue;
    seenUrls.add(url.href);
    results.push({ title: title.slice(0, 160), url: url.href, snippet: "" });
  }

  return results;
}

function toHttpUrl(href, baseUrl) {
  try {
    const url = new URL(decodeHtmlEntities(href), baseUrl);
    return /^https?:$/.test(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

function getAttribute(attributes, name) {
  const pattern = new RegExp(
    `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
    "i",
  );
  const match = attributes.match(pattern);
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? "";
}

function htmlToText(html) {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function decodeHtmlEntities(value) {
  const namedEntities = { amp: "&", apos: "'", gt: ">", lt: "<", quot: '"' };
  return value.replace(/&(?:#(x[\da-f]+|\d+)|([a-z]+));/gi, (entity, code, name) => {
    if (code) {
      const number = code[0].toLowerCase() === "x" ? parseInt(code.slice(1), 16) : parseInt(code, 10);
      return Number.isSafeInteger(number) ? String.fromCodePoint(number) : entity;
    }
    return namedEntities[name.toLowerCase()] ?? entity;
  });
}
