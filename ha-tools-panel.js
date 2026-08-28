/* HA Tools Panel v4.0.0 — retired monolith compatibility notice */
(function () {
  'use strict';

  const escapeHtml = value => String(value == null ? '' : value).replace(
    /[&<>"']/g,
    character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[character],
  );

  class HAToolsPanel extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this._panel = {};
    }

    set hass(value) { this._hass = value; }
    set narrow(value) { this._narrow = value; }
    set route(value) { this._route = value; }

    set panel(value) {
      this._panel = value || {};
      this._render();
    }

    connectedCallback() { this._render(); }

    _render() {
      const title = escapeHtml(this._panel?.title || 'HA Tools Panel retired');
      this.shadowRoot.innerHTML = `
        <style>
          :host { display: block; padding: 24px; color: var(--primary-text-color); }
          ha-card { max-width: 760px; margin: 0 auto; padding: 24px; }
          h1 { margin: 0 0 12px; font-size: 24px; }
          p { line-height: 1.55; color: var(--secondary-text-color); }
          a { color: var(--primary-color); }
          code { overflow-wrap: anywhere; }
        </style>
        <ha-card>
          <h1>${title}</h1>
          <p>The legacy all-in-one panel is retired and no longer loads bundled tool scripts. Its former cards have independent repositories so each tool can own its security, lifecycle, tests, and HACS releases.</p>
          <p>Remove this panel resource, then install only the individual HA Tools you use from <a href="https://github.com/MacSiem" target="_blank" rel="noopener noreferrer">github.com/MacSiem</a>.</p>
        </ha-card>
      `;
    }
  }

  if (!customElements.get('ha-tools-panel')) {
    customElements.define('ha-tools-panel', HAToolsPanel);
  }
})();
