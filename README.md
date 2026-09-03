# DN42 Search Copilot

Version 1.0.0 is a Chrome Manifest V3 extension that adds an isolated DN42 search panel to Google Search result pages. Google remains unchanged; the panel searches a DN42 endpoint in the background and displays matching links alongside the public results.

## Install locally

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Select Load unpacked and choose `dn42-search-copilot-extension`.
4. Configure the DN42 endpoint through Extension options.

Default: `https://baaka.dn42/search?q={query}`. Connection to a DN42-capable network is required. An unavailable endpoint affects only the sidebar, never Google Search.

## Proxy support

The extension can send DN42 searches through any compatible web proxy. In Extension options, enable **Use a web proxy for DN42 search requests** and enter a template such as `https://proxy.dn42.tianyibrad.com/{url}`. The `{url}` placeholder is replaced with the complete configured DN42 search URL. Chrome requests access only to the proxy origin you configure when you save the setting.

This is an extension-background request, so page-level CORS does not apply. The proxy itself must be reachable over trusted HTTPS and return the target page HTML.
