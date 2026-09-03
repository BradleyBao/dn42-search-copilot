const DEFAULT_SETTINGS = {
  endpoint: "https://baaka.dn42/search?q={query}",
  timeoutMs: 8000,
  debugEnabled: false,
  proxyEnabled: false,
  proxyTemplate: "https://proxy.dn42.tianyibrad.com/{url}",
};

const form = document.querySelector("#settings-form");
const endpointInput = document.querySelector("#endpoint");
const timeoutInput = document.querySelector("#timeout");
const debugInput = document.querySelector("#debug-enabled");
const proxyEnabledInput = document.querySelector("#proxy-enabled");
const proxyTemplateInput = document.querySelector("#proxy-template");
const statusOutput = document.querySelector("output");

chrome.storage.sync.get(DEFAULT_SETTINGS).then((settings) => {
  endpointInput.value = settings.endpoint;
  timeoutInput.value = settings.timeoutMs;
  debugInput.checked = settings.debugEnabled;
  proxyEnabledInput.checked = settings.proxyEnabled;
  proxyTemplateInput.value = settings.proxyTemplate;
  proxyTemplateInput.disabled = !settings.proxyEnabled;
});

proxyEnabledInput.addEventListener("change", () => {
  proxyTemplateInput.disabled = !proxyEnabledInput.checked;
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  try {
    const endpoint = endpointInput.value.trim();
    const testUrl = new URL(endpoint.replace("{query}", "test"));
    if (!/^https?:$/.test(testUrl.protocol)) throw new Error("Unsupported protocol");

    const proxyTemplate = proxyTemplateInput.value.trim();
    if (proxyEnabledInput.checked) {
      if (!proxyTemplate.includes("{url}")) throw new Error("Missing proxy placeholder");
      const proxyTestUrl = new URL(proxyTemplate.replaceAll("{url}", testUrl.href));
      if (!/^https?:$/.test(proxyTestUrl.protocol)) throw new Error("Unsupported proxy protocol");

      const proxyOriginPattern = `${proxyTestUrl.origin}/*`;
      const hasPermission = await chrome.permissions.contains({ origins: [proxyOriginPattern] });
      if (!hasPermission) {
        const granted = await chrome.permissions.request({ origins: [proxyOriginPattern] });
        if (!granted) throw new Error("Proxy permission was not granted");
      }
    }

    await chrome.storage.sync.set({
      endpoint,
      timeoutMs: Number(timeoutInput.value),
      debugEnabled: debugInput.checked,
      proxyEnabled: proxyEnabledInput.checked,
      proxyTemplate,
    });
    statusOutput.textContent = "Settings saved.";
  } catch {
    statusOutput.textContent = "Enter valid HTTP or HTTPS endpoint and proxy settings.";
  }
});
