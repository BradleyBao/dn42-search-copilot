(() => {
  const ROOT_ID = "dn42-search-copilot-root";
  let activeQuery = "";
  let requestSequence = 0;

  function escapeHtml(value) {
    const element = document.createElement("span");
    element.textContent = value;
    return element.innerHTML;
  }

  function getQuery() {
    return new URL(window.location.href).searchParams.get("q")?.trim() || "";
  }

  async function render(shadowRoot, force = false) {
    const query = getQuery();
    if (!force && query === activeQuery) return;

    activeQuery = query;
    const view = shadowRoot.querySelector(".copilot");
    const sequence = ++requestSequence;

    if (!query) {
      view.innerHTML = createNotice(
        "No Google query found.",
        "Search Google to explore related DN42 resources.",
      );
      bindEvents(shadowRoot);
      return;
    }

    view.innerHTML = createNotice("Searching DN42", escapeHtml(query), true);
    bindEvents(shadowRoot);

    const response = await sendMessage({ type: "DN42_SEARCH", query });

    if (sequence !== requestSequence) return;

    view.innerHTML = response.status === "success"
      ? createResults(query, response)
      : createNotice(
          "DN42 service unavailable",
          response.message || "Check your DN42 connection and try again.",
          false,
          true,
        );
    bindEvents(shadowRoot);
  }

  function createNotice(title, detail, loading = false, retry = false) {
    return `
      <aside class="panel">
        <header>
          <div>
            <b>DN42 SEARCH COPILOT</b>
            <h2>${title}</h2>
          </div>
          <button class="collapse" type="button" title="Collapse sidebar" aria-label="Collapse sidebar">-</button>
        </header>
        <p class="detail ${loading ? "loading" : ""}">${detail}</p>
        ${retry ? '<button class="retry" type="button">Try again</button>' : ""}
        <footer><button class="settings" type="button">Settings</button></footer>
      </aside>
      <button class="expand" type="button">DN42</button>
    `;
  }

  function createResults(query, response) {
    const links = response.results.length
      ? response.results.map((result) => `
          <a href="${escapeHtml(result.url)}" target="_blank" rel="noreferrer">
            <strong>${escapeHtml(result.title)}</strong>
            <small>${escapeHtml(new URL(result.url).hostname)}</small>
            ${result.snippet ? `<span>${escapeHtml(result.snippet)}</span>` : ""}
          </a>
        `).join("")
      : '<p class="detail">No link results found.</p>';

    return `
      <aside class="panel">
        <header>
          <div>
            <b>DN42 SEARCH COPILOT</b>
            <h2>${escapeHtml(query)}</h2>
            <small>via ${escapeHtml(response.source)}</small>
          </div>
          <button class="collapse" type="button" title="Collapse sidebar" aria-label="Collapse sidebar">-</button>
        </header>
        <main>${links}</main>
        <footer>
          <button class="refresh" type="button">Refresh</button>
          <button class="settings" type="button">Settings</button>
        </footer>
      </aside>
      <button class="expand" type="button">DN42</button>
    `;
  }

  function bindEvents(shadowRoot) {
    const panel = shadowRoot.querySelector(".panel");
    shadowRoot.querySelector(".collapse")?.addEventListener("click", () => panel.classList.add("closed"));
    shadowRoot.querySelector(".expand")?.addEventListener("click", () => panel.classList.remove("closed"));
    shadowRoot.querySelector(".refresh, .retry")?.addEventListener("click", () => render(shadowRoot, true));
    shadowRoot.querySelector(".settings")?.addEventListener("click", async () => {
      await sendMessage({ type: "DN42_OPEN_OPTIONS" });
    });
  }

  async function sendMessage(message) {
    try {
      return await chrome.runtime.sendMessage(message);
    } catch (error) {
      const invalidated = error?.message?.includes("Extension context invalidated");
      return {
        status: "offline",
        message: invalidated
          ? "The extension was reloaded. Refresh this Google tab to continue."
          : "The extension service worker is unavailable.",
      };
    }
  }

  function mount() {
    let host = document.getElementById(ROOT_ID);
    if (!host) {
      host = document.createElement("div");
      host.id = ROOT_ID;
      document.documentElement.append(host);
      const shadowRoot = host.attachShadow({ mode: "open" });
      shadowRoot.innerHTML = `
        <link rel="stylesheet" href="${chrome.runtime.getURL("sidebar.css")}">
        <div class="copilot"></div>
      `;
    }
    render(host.shadowRoot);
  }

  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    history[method] = function (...args) {
      const result = original.apply(this, args);
      queueMicrotask(mount);
      return result;
    };
  }

  window.addEventListener("popstate", mount);
  mount();
})();
