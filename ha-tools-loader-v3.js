/**
 * HA Tools Panel - Dynamic Loader v3
 * Loads ha-tools-panel.js with cache-bust timestamp.
 * System font stack — no CDN dependency. Inter is preferred when installed locally.
 */
(function() {
  const BASE = '/local/community/ha-tools-panel/ha-tools-panel.js';
  const script = document.createElement('script');
  script.type = 'text/javascript';
  script.src = BASE + '?_=' + Date.now();
  script.onerror = () => console.error('[HA Tools Loader] Failed to load panel:', BASE);
  document.head.appendChild(script);
})();