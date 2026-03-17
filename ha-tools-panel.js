/**
 * HA Tools Panel v2.2 — Auto-loading addons with progress notification
 * Author: MacSiem
 * Features: Auto-loads addon scripts, polls for customElements registration,
 *           shows loading progress bar, dynamically updates sidebar
 */

// ── Build version & auto-update detection ──
// Zmień BUILD_VERSION przy każdej aktualizacji kodu.
// Panel automatycznie wykryje nową wersję i pokaże toast z przyciskiem "Odśwież".
const HA_TOOLS_BUILD = '2.3.0';
const HA_TOOLS_BUILD_TS = '20260316-0020';

(function _checkVersion() {
  const KEY = 'ha-tools-build';
  const prev = localStorage.getItem(KEY);
  if (prev && prev !== HA_TOOLS_BUILD) {
    // Nowa wersja — pokaż toast po załadowaniu panelu
    window.__haToolsUpdateAvailable = { from: prev, to: HA_TOOLS_BUILD };
  }
  localStorage.setItem(KEY, HA_TOOLS_BUILD);
})();

class HAToolsPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._hass = null;
    this._rendered = false;
    this._activeView = 'home';
    this._activeToolId = null;
    this._cardInstance = null;
    this._settings = this._loadSettings();
    this._loadedCount = 0;
    this._loading = true;
    this._pollTimer = null;
    this._scriptLoadPromises = [];
  }

  connectedCallback() {
    // When loaded via dynamic loader, HA may set properties (hass, panel, etc.)
    // as plain object props BEFORE the custom element class is defined.
    // After upgrade, the setters never fired — re-apply them now.
    for (const prop of ['hass', 'panel', 'narrow', 'route']) {
      if (this.hasOwnProperty(prop)) {
        const val = this[prop];
        delete this[prop];
        this[prop] = val;
      }
    }
  }

  // Map tool tags to their script paths under /local/community/
  static get TOOL_SCRIPTS() {
    return {
      'ha-trace-viewer': '/local/community/ha-trace-viewer/ha-trace-viewer.js',
      'ha-device-health': '/local/community/ha-device-health/ha-device-health.js',
      'ha-automation-analyzer': '/local/community/ha-automation-analyzer/ha-automation-analyzer.js',
      'ha-backup-manager': '/local/community/ha-backup-manager/ha-backup-manager.js',
      'ha-network-map': '/local/community/ha-network-map/ha-network-map.js',
      'ha-smart-reports': '/local/community/ha-smart-reports/ha-smart-reports.js',
      'ha-energy-optimizer': '/local/community/ha-energy-optimizer/ha-energy-optimizer.js',
      'ha-sentence-manager': '/local/community/ha-sentence-manager/ha-sentence-manager.js',
      'ha-chore-tracker': '/local/community/ha-chore-tracker/ha-chore-tracker.js',
      'ha-baby-tracker': '/local/community/ha-baby-tracker/ha-baby-tracker.js',
      'ha-cry-analyzer': '/local/community/ha-cry-analyzer/ha-cry-analyzer.js',
      'ha-data-exporter': '/local/community/ha-data-exporter/ha-data-exporter.js',
      'ha-storage-monitor': '/local/community/ha-storage-monitor/ha-storage-monitor.js',
      'ha-security-check': '/local/community/ha-security-check/ha-security-check.js',
    };
  }

  _loadAddonScripts() {
    const cacheBuster = `?v=${Date.now()}`;
    const scripts = HAToolsPanel.TOOL_SCRIPTS;
    for (const [tag, src] of Object.entries(scripts)) {
      if (customElements.get(tag)) continue; // already registered
      // Check if script tag already exists
      if (document.querySelector(`script[src^="${src}"]`)) continue;
      const script = document.createElement('script');
      script.type = 'text/javascript';
      script.src = src + cacheBuster;
      script.async = true;
      script.onerror = () => console.warn(`[HA Tools] Failed to load: ${src}`);
      document.head.appendChild(script);
    }
  }

  _startPolling() {
    let attempts = 0;
    const maxAttempts = 60; // 30 seconds max
    const poll = () => {
      const { available } = this._getToolStatus();
      const newCount = available.length;
      if (newCount !== this._loadedCount) {
        this._loadedCount = newCount;
        this._updateLoadingStatus();
        this._updateSidebar();
        if (this._activeView === 'home') this._showHome();
      }
      attempts++;
      if (newCount >= HAToolsPanel.TOOLS.length || attempts >= maxAttempts) {
        this._loading = false;
        this._updateLoadingStatus();
        this._updateSidebar();
        if (this._activeView === 'home') this._showHome();
        if (this._pollTimer) clearInterval(this._pollTimer);
        this._pollTimer = null;
        console.log(`[HA Tools] Loading complete: ${newCount}/${HAToolsPanel.TOOLS.length} tools available`);
        this._showUpdateToastIfNeeded();
        return;
      }
    };
    this._pollTimer = setInterval(poll, 500);
    // Run once immediately
    poll();
  }

  _showUpdateToastIfNeeded() {
    const upd = window.__haToolsUpdateAvailable;
    if (!upd) return;
    delete window.__haToolsUpdateAvailable;
    const toast = document.createElement('div');
    toast.innerHTML = `
      <div style="position:fixed;bottom:24px;right:24px;z-index:99999;
        background:#FFFFFF;color:#1E293B;padding:16px 20px;border-radius:12px;
        box-shadow:0 4px 20px rgba(0,0,0,0.1);font-size:14px;
        display:flex;align-items:center;gap:12px;max-width:420px;
        animation:slideUp .3s ease-out;border-left:3px solid #3B82F6;">
        <div style="flex:1">
          <div style="font-weight:600;margin-bottom:4px">\u{1F504} HA Tools zaktualizowane</div>
          <div style="opacity:0.8;font-size:12px;color:#64748B">v${upd.from} \u2192 v${upd.to} — odśwież przeglądarkę, aby załadować nową wersję.</div>
        </div>
        <button onclick="location.reload(true)" style="
          background:#3B82F6;color:#fff;border:none;padding:8px 16px;
          border-radius:8px;font-weight:600;cursor:pointer;white-space:nowrap;
          font-size:13px;">Odśwież</button>
        <button onclick="this.closest('div').parentElement.remove()" style="
          background:none;border:none;color:#64748B;cursor:pointer;
          font-size:18px;padding:4px;opacity:0.7">\u2715</button>
      </div>`;
    // Append to the main document body (outside shadow DOM for visibility)
    document.body.appendChild(toast);
  }

  _updateLoadingStatus() {
    const bar = this.shadowRoot?.querySelector('.loading-bar');
    if (!bar) return;
    const total = HAToolsPanel.TOOLS.length;
    if (this._loading) {
      bar.style.display = 'flex';
      bar.innerHTML = `
        <div style="flex:1;display:flex;align-items:center;gap:12px">
          <span style="font-size:13px;color:#64748B">Ładowanie narzędzi... ${this._loadedCount}/${total}</span>
          <div class="loading-progress">
            <div class="loading-progress-fill" style="width:${(this._loadedCount / total) * 100}%"></div>
          </div>
        </div>
      `;
    } else {
      if (this._loadedCount >= total) {
        bar.innerHTML = `<span style="color:#22C55E;font-weight:600;font-size:13px">✅ Wszystkie narzędzia załadowane (${this._loadedCount}/${total})</span>`;
        setTimeout(() => { bar.style.display = 'none'; }, 3000);
      } else {
        bar.innerHTML = `<span style="color:#F59E0B;font-weight:600;font-size:13px">⚠️ Załadowano ${this._loadedCount}/${total} narzędzi</span>`;
        setTimeout(() => { bar.style.display = 'none'; }, 5000);
      }
    }
  }

  _updateSidebar() {
    const { available, unavailable } = this._getToolStatus();
    // Update badge
    const badge = this.shadowRoot?.querySelector('.nav-badge');
    if (badge) badge.textContent = `${available.length}/${HAToolsPanel.TOOLS.length}`;
    // Update tools count in section header
    const toolsSection = this.shadowRoot?.querySelector('.nav-section-tools');
    if (toolsSection) toolsSection.textContent = `Narzędzia (${available.length})`;
    // Update unavailable section header
    const unavailSection = this.shadowRoot?.querySelector('.nav-section-unavailable');
    if (unavailSection) {
      if (unavailable.length > 0) {
        unavailSection.textContent = `Niedostępne (${unavailable.length})`;
        unavailSection.style.display = '';
      } else {
        unavailSection.style.display = 'none';
      }
    }
    // Rebuild tool nav items
    const toolsContainer = this.shadowRoot?.querySelector('.nav-tools-list');
    const unavailContainer = this.shadowRoot?.querySelector('.nav-unavail-list');
    if (toolsContainer) {
      toolsContainer.innerHTML = available.map(t => `
        <div class="nav-item${this._activeToolId === t.id ? ' active' : ''}" data-tool="${t.id}" data-tag="${t.tag}">
          <span class="nav-icon">${t.icon}</span>
          <span>${t.name}</span>
        </div>
      `).join('');
      toolsContainer.querySelectorAll('.nav-item[data-tool]').forEach(item => {
        item.addEventListener('click', () => {
          this._setActiveNav(item);
          this._loadTool(item.dataset.tool, item.dataset.tag);
        });
      });
    }
    if (unavailContainer) {
      if (unavailable.length > 0) {
        unavailContainer.innerHTML = unavailable.map(t => `
          <div class="nav-item unavailable" title="Nie zainstalowane">
            <span class="nav-icon">${t.icon}</span>
            <span>${t.name}</span>
          </div>
        `).join('');
        unavailContainer.style.display = '';
      } else {
        unavailContainer.innerHTML = '';
        unavailContainer.style.display = 'none';
      }
    }
  }

  static get TOOLS() {
    return [
      { id: 'trace-viewer', name: 'Trace Viewer', icon: '\u{1F9EC}', tag: 'ha-trace-viewer', desc: 'Przeglądaj i analizuj ślady automatyzacji', repo: 'MacSiem/ha-trace-viewer', category: 'debug' },
      { id: 'device-health', name: 'Device Health', icon: '\u{1F3E5}', tag: 'ha-device-health', desc: 'Monitoruj stan urządzeń, baterii i sieci', repo: 'MacSiem/ha-device-health', category: 'monitor' },
      { id: 'automation-analyzer', name: 'Automation Analyzer', icon: '\u{1F4CA}', tag: 'ha-automation-analyzer', desc: 'Analizuj wydajność i problemy automatyzacji', repo: 'MacSiem/ha-automation-analyzer', category: 'debug' },
      { id: 'backup-manager', name: 'Backup Manager', icon: '\u{1F4BE}', tag: 'ha-backup-manager', desc: 'Zarządzaj kopiami zapasowymi', repo: 'MacSiem/ha-backup-manager', category: 'system' },
      { id: 'network-map', name: 'Network Map', icon: '\u{1F310}', tag: 'ha-network-map', desc: 'Wizualizuj mapę sieci urządzeń', repo: 'MacSiem/ha-network-map', category: 'monitor' },
      { id: 'smart-reports', name: 'Smart Reports', icon: '\u{1F4C8}', tag: 'ha-smart-reports', desc: 'Generuj inteligentne raporty', repo: 'MacSiem/ha-smart-reports', category: 'reports' },
      { id: 'energy-optimizer', name: 'Energy Optimizer', icon: '\u26A1', tag: 'ha-energy-optimizer', desc: 'Optymalizuj zużycie energii', repo: 'MacSiem/ha-energy-optimizer', category: 'monitor' },
      { id: 'sentence-manager', name: 'Sentence Manager', icon: '\u{1F5E3}\uFE0F', tag: 'ha-sentence-manager', desc: 'Zarządzaj zdaniami głosowymi', repo: 'MacSiem/ha-sentence-manager', category: 'system' },
      { id: 'chore-tracker', name: 'Chore Tracker', icon: '\u{1F3E0}', tag: 'ha-chore-tracker', desc: 'Śledzenie obowiązków domowych', repo: 'MacSiem/ha-chore-tracker', category: 'life' },
      { id: 'baby-tracker', name: 'Baby Tracker', icon: '\u{1F37C}', tag: 'ha-baby-tracker', desc: 'Śledzenie aktywności dziecka', repo: 'MacSiem/ha-baby-tracker', category: 'life' },
      { id: 'cry-analyzer', name: 'Cry Analyzer', icon: '\u{1F476}', tag: 'ha-cry-analyzer', desc: 'Analiza płaczu dziecka AI', repo: 'MacSiem/ha-cry-analyzer', category: 'life' },
      { id: 'data-exporter', name: 'Data Exporter', icon: '\u{1F4E4}', tag: 'ha-data-exporter', desc: 'Eksportuj dane z Home Assistant', repo: 'MacSiem/ha-data-exporter', category: 'system' },
      { id: 'storage-monitor', name: 'Storage Monitor', icon: '\u{1F4BD}', tag: 'ha-storage-monitor', desc: 'Wizualizacja użycia dysku w stylu WinDirStat', repo: 'MacSiem/ha-storage-monitor', category: 'system' },
      { id: 'security-check', name: 'Security Check', icon: '\u{1F6E1}\uFE0F', tag: 'ha-security-check', desc: 'Audyt bezpieczeństwa Home Assistant', repo: 'MacSiem/ha-security-check', category: 'system' },
    ];
  }

  static get CATEGORIES() {
    return {
      monitor: { name: 'Monitoring', icon: '\u{1F4CB}' },
      debug: { name: 'Debugowanie', icon: '\u{1F527}' },
      system: { name: 'System', icon: '\u2699\uFE0F' },
      reports: { name: 'Raporty', icon: '\u{1F4C4}' },
      life: { name: 'Życie', icon: '\u{1F3E1}' },
    };
  }

  static get CSS() {
    return `
      @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

      :host {
        display: block; height: 100vh; overflow: hidden;
        --spacing-xs: 4px; --spacing-sm: 8px; --spacing-md: 12px; --spacing-lg: 16px; --spacing-xl: 24px;
        --radius-sm: 8px; --radius-md: 12px; --radius-lg: 16px; --radius-xl: 16px;
        --font-title: 18px; --font-heading: 14px; --font-body: 14px; --font-meta: 13px; --font-small: 11px;
        --color-success: #22C55E; --color-error: #EF4444; --color-warning: #F59E0B; --color-info: #3B82F6;
        --transition: all 0.2s ease-in-out;
        background: #F8FAFC;
        color: #1E293B;
        font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      * { box-sizing: border-box; }

      @keyframes fadeSlideIn {
        from { opacity: 0; transform: translateY(10px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes shimmer {
        0%, 100% { background-color: #F1F5F9; }
        50% { background-color: #E2E8F0; }
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes slideUp {
        from { transform: translateY(20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }

      /* Layout */
      .panel { display: flex; height: 100vh; background: #F8FAFC; color: #1E293B; font-family: Inter, sans-serif; }

      /* Sidebar */
      .sidebar { width: 260px; background: #FFFFFF; border-right: 1px solid #E2E8F0; display: flex; flex-direction: column; flex-shrink: 0; }
      .sidebar-header { padding: var(--spacing-lg); font-size: var(--font-title); font-weight: 600; border-bottom: 1px solid #E2E8F0; display: flex; align-items: center; gap: var(--spacing-sm); color: #1E293B; }
      .sidebar-header .version { font-size: var(--font-small); color: #64748B; font-weight: 400; margin-left: auto; }
      .sidebar-scroll { flex: 1; overflow-y: auto; }
      .sidebar-scroll::-webkit-scrollbar { width: 6px; }
      .sidebar-scroll::-webkit-scrollbar-track { background: #F8FAFC; }
      .sidebar-scroll::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 3px; }
      .sidebar-footer { border-top: 1px solid #E2E8F0; }

      .nav-section { font-size: 11px; color: #94A3B8; text-transform: uppercase; letter-spacing: 1px; padding: var(--spacing-lg) var(--spacing-lg) var(--spacing-xs); font-weight: 600; }
      .nav-item { display: flex; align-items: center; gap: 10px; padding: 12px 16px; height: 44px; cursor: pointer; font-size: var(--font-body); color: #64748B; transition: var(--transition); user-select: none; border-radius: 0 8px 8px 0; }
      .nav-item:hover { background: #F8FAFC; color: #1E293B; }
      .nav-item.active { background: #EFF6FF; color: #3B82F6; font-weight: 600; border-left: 3px solid #3B82F6; padding-left: 13px; }
      .nav-item.unavailable { opacity: 0.35; cursor: default; }
      .nav-item .nav-icon { width: 20px; text-align: center; font-size: 18px; flex-shrink: 0; }
      .nav-item .nav-badge { margin-left: auto; background: #3B82F6; color: white; border-radius: 20px; padding: 2px 8px; font-size: 11px; font-weight: 600; }

      /* Main */
      .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
      .toolbar { padding: var(--spacing-md) var(--spacing-lg); background: #FFFFFF; border-bottom: 1px solid #E2E8F0; display: flex; align-items: center; gap: var(--spacing-md); min-height: 48px; }
      .toolbar-title { font-size: 18px; font-weight: 600; flex: 1; color: #1E293B; }
      .content { flex: 1; overflow: auto; padding: 0; }
      .content::-webkit-scrollbar { width: 6px; }
      .content::-webkit-scrollbar-track { background: #F8FAFC; }
      .content::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 3px; }

      /* Buttons */
      .btn { padding: var(--spacing-sm) var(--spacing-md); border-radius: var(--radius-sm); border: none; font-size: var(--font-body); font-weight: 600; cursor: pointer; transition: var(--transition); display: inline-flex; align-items: center; gap: var(--spacing-sm); text-decoration: none; }
      .btn-primary { background: #3B82F6; color: white; }
      .btn-primary:hover { filter: brightness(1.1); }
      .btn-secondary { background: transparent; color: #3B82F6; border: 1px solid #E2E8F0; }
      .btn-secondary:hover { border-color: #3B82F6; background: #EFF6FF; }
      .btn-sm { padding: var(--spacing-xs) var(--spacing-sm); font-size: var(--font-meta); }
      .btn-icon { background: none; border: 1px solid #E2E8F0; color: #1E293B; padding: 6px 12px; border-radius: var(--radius-sm); cursor: pointer; font-size: var(--font-body); transition: var(--transition); }
      .btn-icon:hover { border-color: #3B82F6; color: #3B82F6; }

      /* Empty state */
      .empty { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; color: #64748B; gap: var(--spacing-sm); }
      .empty .big { font-size: 48px; opacity: 0.5; }

      /* ===== HOME VIEW ===== */
      .home-view { padding: var(--spacing-xl); max-width: 1200px; }
      .home-section { margin-bottom: var(--spacing-xl); animation: fadeSlideIn 0.4s ease-in-out; }
      .home-section-title { font-size: 16px; font-weight: 600; color: #1E293B; margin-bottom: var(--spacing-md); display: flex; align-items: center; gap: var(--spacing-sm); }
      .home-section-title .count { font-size: var(--font-meta); color: #64748B; font-weight: 400; }

      /* Installed cards grid */
      .tools-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
      .tool-card { background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 16px; padding: var(--spacing-lg); cursor: pointer; transition: var(--transition); display: flex; flex-direction: column; gap: var(--spacing-md); box-shadow: 0 1px 3px rgba(0,0,0,0.04); animation: fadeSlideIn 0.3s ease-in-out backwards; }
      .tool-card:hover { transform: translateY(-4px); box-shadow: 0 4px 20px -2px rgba(0,0,0,0.08); border-color: #3B82F6; }
      .tool-card-header { display: flex; align-items: center; gap: var(--spacing-md); }
      .tool-card-icon { font-size: 22px; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: rgba(59, 130, 246, 0.1); border-radius: 12px; flex-shrink: 0; }
      .tool-card-name { font-size: 14px; font-weight: 600; color: #1E293B; }
      .tool-card-desc { font-size: 13px; color: #64748B; line-height: 1.4; flex: 1; }
      .tool-card-footer { display: flex; align-items: center; justify-content: space-between; margin-top: var(--spacing-xs); }
      .tool-card-category { font-size: 11px; color: #3B82F6; background: rgba(59, 130, 246, 0.1); padding: 4px 12px; border-radius: 20px; font-weight: 500; }
      .tool-card-status { font-size: 11px; color: #22C55E; font-weight: 600; }

      /* Uninstalled list */
      .uninstalled-list { display: flex; flex-direction: column; gap: var(--spacing-sm); }
      .uninstalled-item { display: flex; align-items: center; gap: var(--spacing-md); padding: var(--spacing-md) var(--spacing-lg); background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: var(--radius-sm); }
      .uninstalled-item .ui-icon { font-size: 18px; width: 32px; text-align: center; opacity: 0.5; }
      .uninstalled-item .ui-name { font-size: var(--font-body); font-weight: 600; color: #1E293B; }
      .uninstalled-item .ui-desc { font-size: var(--font-meta); color: #64748B; flex: 1; }
      .uninstalled-item .btn { flex-shrink: 0; }

      /* Donation section */
      .donate-section { background: linear-gradient(135deg, #EFF6FF 0%, #FFF1F2 100%); border: 1px solid #E2E8F0; border-radius: 16px; padding: var(--spacing-xl); display: flex; align-items: center; gap: var(--spacing-xl); }
      .donate-text { flex: 1; }
      .donate-text h3 { font-size: 15px; font-weight: 600; margin: 0 0 var(--spacing-sm); color: #1E293B; }
      .donate-text p { font-size: var(--font-body); color: #64748B; margin: 0; line-height: 1.5; }
      .donate-buttons { display: flex; gap: var(--spacing-sm); flex-shrink: 0; }
      .donate-btn { padding: var(--spacing-sm) var(--spacing-lg); border-radius: 12px; font-size: var(--font-body); font-weight: 600; cursor: pointer; transition: var(--transition); text-decoration: none; display: inline-flex; align-items: center; gap: var(--spacing-sm); border: none; }
      .donate-btn.coffee { background: #FFDD00; color: #000; }
      .donate-btn.coffee:hover { filter: brightness(0.95); }
      .donate-btn.paypal { background: #0070BA; color: white; }
      .donate-btn.paypal:hover { filter: brightness(1.1); }

      /* ===== SETTINGS VIEW ===== */
      .settings-view { padding: var(--spacing-xl); max-width: 720px; }
      .settings-group { margin-bottom: var(--spacing-xl); background: #FFFFFF; border: 1px solid #E2E8F0; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.04); }
      .settings-group-header { padding: var(--spacing-md) var(--spacing-lg); border-bottom: 1px solid #E2E8F0; font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: var(--spacing-sm); cursor: pointer; user-select: none; color: #1E293B; background: #FFFFFF; }
      .settings-group-header .chevron { margin-left: auto; font-size: 12px; transition: transform 0.2s; }
      .settings-group-header.collapsed .chevron { transform: rotate(-90deg); }
      .settings-group-body { padding: 0; }
      .settings-group-body.hidden { display: none; }

      .setting-row { display: flex; align-items: center; padding: 14px var(--spacing-lg); border-bottom: 1px solid #F1F5F9; gap: var(--spacing-md); min-height: 56px; }
      .setting-row:last-child { border-bottom: none; }
      .setting-info { flex: 1; }
      .setting-label { font-size: var(--font-body); font-weight: 500; color: #1E293B; }
      .setting-desc { font-size: var(--font-meta); color: #64748B; margin-top: 2px; }
      .setting-control { flex-shrink: 0; }

      .setting-select { padding: 6px 10px; border: 1px solid #E2E8F0; border-radius: var(--radius-sm); background: #FFFFFF; color: #1E293B; font-size: var(--font-body); cursor: pointer; font-weight: 500; transition: var(--transition); }
      .setting-select:focus { outline: none; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2); }
      .setting-toggle { position: relative; width: 48px; height: 26px; cursor: pointer; }
      .setting-toggle input { opacity: 0; width: 0; height: 0; }
      .setting-toggle .slider { position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: #E2E8F0; border-radius: 13px; transition: cubic-bezier(0.68, -0.55, 0.265, 1.55) 0.3s; }
      .setting-toggle .slider:before { content: ''; position: absolute; height: 20px; width: 20px; left: 3px; bottom: 3px; background: white; border-radius: 50%; transition: cubic-bezier(0.68, -0.55, 0.265, 1.55) 0.3s; }
      .setting-toggle input:checked + .slider { background: #3B82F6; }
      .setting-toggle input:checked + .slider:before { transform: translateX(22px); }

      .setting-subsection { font-size: 11px; font-weight: 600; color: #94A3B8; text-transform: uppercase; letter-spacing: 1px; padding: var(--spacing-md) var(--spacing-lg) var(--spacing-xs); background: transparent; }

      .setting-input { padding: 6px 10px; border: 1px solid #E2E8F0; border-radius: var(--radius-sm); background: #FFFFFF; color: #1E293B; font-size: var(--font-body); width: 80px; text-align: center; }
      .setting-input:focus { outline: none; box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2); }

      .setting-action-row { display: flex; align-items: center; padding: var(--spacing-md) var(--spacing-lg); gap: var(--spacing-md); border-bottom: 1px solid #F1F5F9; }
      .setting-action-row:last-child { border-bottom: none; }

      .btn-apply { background: #3B82F6; color: white; padding: 8px 20px; border-radius: var(--radius-sm); border: none; font-size: var(--font-body); font-weight: 600; cursor: pointer; transition: var(--transition); display: inline-flex; align-items: center; gap: var(--spacing-sm); }
      .btn-apply:hover { filter: brightness(1.1); }
      .btn-apply:disabled { opacity: 0.5; cursor: not-allowed; }

      .status-msg { font-size: var(--font-meta); padding: 8px 14px; border-radius: var(--radius-sm); margin-top: var(--spacing-sm); display: none; }
      .status-msg.visible { display: block; }
      .status-msg.success { background: rgba(34, 197, 94, 0.1); color: #22C55E; border: 1px solid rgba(34, 197, 94, 0.2); }
      .status-msg.error { background: rgba(239, 68, 68, 0.1); color: #EF4444; border: 1px solid rgba(239, 68, 68, 0.2); }
      .status-msg.info { background: rgba(59, 130, 246, 0.1); color: #3B82F6; border: 1px solid rgba(59, 130, 246, 0.2); }

      .trace-current-info { font-size: var(--font-meta); color: #64748B; padding: var(--spacing-sm) var(--spacing-lg); background: #F8FAFC; display: flex; align-items: center; gap: var(--spacing-sm); }
      .trace-current-info .val { color: #1E293B; font-weight: 600; }

      /* Loading bar */
      .loading-bar { display: flex; align-items: center; gap: var(--spacing-md); padding: var(--spacing-md) var(--spacing-lg); font-size: var(--font-meta); color: #64748B; background: #F8FAFC; border-bottom: 1px solid #E2E8F0; min-height: 40px; flex-wrap: wrap; }
      .loading-progress { height: 6px; background: #E2E8F0; border-radius: 3px; overflow: hidden; flex: 1; min-width: 60px; max-width: 200px; }
      .loading-progress-fill { height: 100%; background: #3B82F6; border-radius: 3px; transition: width 0.3s ease; }
    `;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._rendered) {
      this._rendered = true;
      this._render();
    }
    if (this._cardInstance) {
      if (this._cardInstance.tagName.toLowerCase() === 'ha-cry-analyzer') {
        this._cardInstance.hassObj = hass;
      } else {
        this._cardInstance.hass = hass;
      }
    }
  }

  set panel(panel) { this._config = panel?.config || {}; }
  set narrow(narrow) { this._narrow = narrow; }
  set route(route) { this._route = route; }

  _loadSettings() {
    try {
      const stored = localStorage.getItem('ha-tools-settings');
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  }

  _saveSettings() {
    try { localStorage.setItem('ha-tools-settings', JSON.stringify(this._settings)); } catch {}
  }

  _getSetting(key, defaultVal) {
    return this._settings[key] !== undefined ? this._settings[key] : defaultVal;
  }

  _setSetting(key, value) {
    this._settings[key] = value;
    this._saveSettings();
  }

  _getToolStatus() {
    const tools = HAToolsPanel.TOOLS;
    const available = tools.filter(t => customElements.get(t.tag));
    const unavailable = tools.filter(t => !customElements.get(t.tag));
    return { tools, available, unavailable };
  }

  _render() {
    const { available, unavailable } = this._getToolStatus();
    this._loadedCount = available.length;

    this.shadowRoot.innerHTML = `
      <style>${HAToolsPanel.CSS}</style>
      <div class="panel">
        <div class="sidebar">
          <div class="sidebar-header">
            <span>\u{1F6E0}\uFE0F</span> HA Tools
            <span class="version">v2.3</span>
          </div>
          <div class="sidebar-scroll">
            <div class="nav-item active" data-view="home">
              <span class="nav-icon">\u{1F3E0}</span>
              <span>Home</span>
              <span class="nav-badge">${available.length}/${HAToolsPanel.TOOLS.length}</span>
            </div>

            <div class="nav-section nav-section-tools">Narzędzia (${available.length})</div>
            <div class="nav-tools-list">
              ${available.map(t => `
                <div class="nav-item" data-tool="${t.id}" data-tag="${t.tag}">
                  <span class="nav-icon">${t.icon}</span>
                  <span>${t.name}</span>
                </div>
              `).join('')}
            </div>

            <div class="nav-section nav-section-unavailable" ${unavailable.length === 0 ? 'style="display:none"' : ''}>Niedostępne (${unavailable.length})</div>
            <div class="nav-unavail-list" ${unavailable.length === 0 ? 'style="display:none"' : ''}>
              ${unavailable.map(t => `
                <div class="nav-item unavailable" title="Nie zainstalowane">
                  <span class="nav-icon">${t.icon}</span>
                  <span>${t.name}</span>
                </div>
              `).join('')}
            </div>
          </div>
          <div class="sidebar-footer">
            <div class="nav-item" data-view="settings">
              <span class="nav-icon">\u2699\uFE0F</span>
              <span>Ustawienia</span>
            </div>
          </div>
        </div>
        <div class="main">
          <div class="loading-bar" style="display:none"></div>
          <div class="toolbar">
            <div class="toolbar-title" id="title">\u{1F3E0} Home</div>
            <button class="btn-icon" id="refreshBtn" style="display:none">\u{1F504} Odśwież</button>
          </div>
          <div class="content" id="content"></div>
        </div>
      </div>
    `;

    this._bindNavigation();
    this._showHome();

    // Auto-load addon scripts and start polling for registration
    if (available.length < HAToolsPanel.TOOLS.length) {
      this._loading = true;
      this._updateLoadingStatus();
      this._loadAddonScripts();
      this._startPolling();
    } else {
      this._loading = false;
    }
  }

  _bindNavigation() {
    // Home and Settings navigation
    this.shadowRoot.querySelectorAll('.nav-item[data-view]').forEach(item => {
      item.addEventListener('click', () => {
        const view = item.dataset.view;
        this._setActiveNav(item);
        if (view === 'home') this._showHome();
        else if (view === 'settings') this._showSettings();
      });
    });

    // Tool navigation
    this.shadowRoot.querySelectorAll('.nav-item[data-tool]').forEach(item => {
      item.addEventListener('click', () => {
        this._setActiveNav(item);
        this._loadTool(item.dataset.tool, item.dataset.tag);
      });
    });

    // Refresh button
    this.shadowRoot.getElementById('refreshBtn').addEventListener('click', () => {
      if (this._activeView === 'tool' && this._activeToolId) {
        const item = this.shadowRoot.querySelector(`.nav-item[data-tool="${this._activeToolId}"]`);
        if (item) this._loadTool(this._activeToolId, item.dataset.tag);
      }
    });
  }

  _setActiveNav(activeItem) {
    this.shadowRoot.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
    activeItem.classList.add('active');
  }

  _showHome() {
    this._activeView = 'home';
    this._activeToolId = null;
    this._cardInstance = null;
    const title = this.shadowRoot.getElementById('title');
    title.textContent = '\u{1F3E0} Home';
    this.shadowRoot.getElementById('refreshBtn').style.display = 'none';

    const { available, unavailable } = this._getToolStatus();
    const cats = HAToolsPanel.CATEGORIES;
    const content = this.shadowRoot.getElementById('content');

    content.innerHTML = `
      <div class="home-view">
        <div class="home-section">
          <div class="home-section-title">
            \u2705 Zainstalowane narzędzia <span class="count">(${available.length} z ${HAToolsPanel.TOOLS.length})</span>
          </div>
          ${available.length > 0 ? `
            <div class="tools-grid">
              ${available.map((t, i) => `
                <div class="tool-card" data-tool="${t.id}" data-tag="${t.tag}" style="animation-delay: ${i * 50}ms">
                  <div class="tool-card-header">
                    <div class="tool-card-icon">${t.icon}</div>
                    <div style="flex: 1">
                      <div class="tool-card-name">${t.name}</div>
                    </div>
                  </div>
                  <div class="tool-card-desc">${t.desc}</div>
                  <div class="tool-card-footer">
                    <span class="tool-card-category">${cats[t.category]?.name || t.category}</span>
                    <span class="tool-card-status">\u2705 Aktywne</span>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : '<div style="color:#64748B;font-size:13px;">Brak zainstalowanych narzędzi.</div>'}
        </div>

        ${unavailable.length > 0 ? `
          <div class="home-section">
            <div class="home-section-title">
              \u{1F4E6} Dostępne do instalacji <span class="count">(${unavailable.length})</span>
            </div>
            <div class="uninstalled-list">
              ${unavailable.map(t => `
                <div class="uninstalled-item">
                  <div class="ui-icon">${t.icon}</div>
                  <div class="ui-name">${t.name}</div>
                  <div class="ui-desc">${t.desc}</div>
                  <a class="btn btn-secondary btn-sm" href="https://github.com/${t.repo}" target="_blank" rel="noopener">
                    GitHub
                  </a>
                  <a class="btn btn-primary btn-sm hacs-install" data-repo="${t.repo}">
                    \u{1F4E5} Zainstaluj (HACS)
                  </a>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <div class="home-section">
          <div class="donate-section">
            <div class="donate-text">
              <h3>\u2764\uFE0F Wesprzyj rozwój HA Tools</h3>
              <p>Jeśli HA Tools ułatwia Ci życie z Home Assistant, rozważ wsparcie projektu. Każda kawa motywuje do dalszego rozwoju!</p>
            </div>
            <div class="donate-buttons">
              <a class="donate-btn coffee" href="https://buymeacoffee.com/macsiem" target="_blank" rel="noopener">
                \u2615 Buy Me a Coffee
              </a>
              <a class="donate-btn paypal" href="https://www.paypal.com/donate/?hosted_button_id=Y967H4PLRBN8W" target="_blank" rel="noopener">
                \u{1F4B3} PayPal
              </a>
            </div>
          </div>
        </div>
      </div>
    `;

    // Bind card clicks
    content.querySelectorAll('.tool-card[data-tool]').forEach(card => {
      card.addEventListener('click', () => {
        const toolId = card.dataset.tool;
        const tag = card.dataset.tag;
        const navItem = this.shadowRoot.querySelector(`.nav-item[data-tool="${toolId}"]`);
        if (navItem) {
          this._setActiveNav(navItem);
          this._loadTool(toolId, tag);
        }
      });
    });

    // HACS install buttons
    content.querySelectorAll('.hacs-install').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const repo = btn.dataset.repo;
        // Open HACS custom repo dialog via HA
        const hacsUrl = `/hacs/repository/${repo.replace('/', '%2F')}`;
        window.open(hacsUrl, '_blank');
      });
    });
  }

  _showSettings() {
    this._activeView = 'settings';
    this._activeToolId = null;
    this._cardInstance = null;
    const title = this.shadowRoot.getElementById('title');
    title.textContent = '\u2699\uFE0F Ustawienia';
    this.shadowRoot.getElementById('refreshBtn').style.display = 'none';

    const { available } = this._getToolStatus();
    const content = this.shadowRoot.getElementById('content');
    const lang = this._getSetting('language', 'pl');
    const animations = this._getSetting('animations', true);
    const compactMode = this._getSetting('compactMode', false);
    const defaultTool = this._getSetting('defaultTool', 'home');

    content.innerHTML = `
      <div class="settings-view">

        <!-- General Settings -->
        <div class="settings-group">
          <div class="settings-group-header" data-group="general">
            \u2699\uFE0F Ustawienia ogólne
            <span class="chevron">\u25BC</span>
          </div>
          <div class="settings-group-body" data-body="general">
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">Język</div>
                <div class="setting-desc">Język interfejsu panelu</div>
              </div>
              <div class="setting-control">
                <select class="setting-select" data-setting="language">
                  <option value="pl" ${lang === 'pl' ? 'selected' : ''}>Polski</option>
                  <option value="en" ${lang === 'en' ? 'selected' : ''}>English</option>
                </select>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">Domyślny widok</div>
                <div class="setting-desc">Co pokazać po otwarciu HA Tools</div>
              </div>
              <div class="setting-control">
                <select class="setting-select" data-setting="defaultTool">
                  <option value="home" ${defaultTool === 'home' ? 'selected' : ''}>Home</option>
                  ${available.map(t => `<option value="${t.id}" ${defaultTool === t.id ? 'selected' : ''}>${t.name}</option>`).join('')}
                </select>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">Animacje</div>
                <div class="setting-desc">Włącz animacje przejść</div>
              </div>
              <div class="setting-control">
                <label class="setting-toggle">
                  <input type="checkbox" data-setting="animations" ${animations ? 'checked' : ''}>
                  <span class="slider"></span>
                </label>
              </div>
            </div>
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">Tryb kompaktowy</div>
                <div class="setting-desc">Mniejsze odstępy, mniej miejsca na ekranie</div>
              </div>
              <div class="setting-control">
                <label class="setting-toggle">
                  <input type="checkbox" data-setting="compactMode" ${compactMode ? 'checked' : ''}>
                  <span class="slider"></span>
                </label>
              </div>
            </div>
          </div>
        </div>

        <!-- Trace Viewer — Backend Settings -->
        <div class="settings-group">
          <div class="settings-group-header" data-group="trace-backend">
            \u{1F9EC} Trace Viewer — Przechowywanie
            <span class="chevron">\u25BC</span>
          </div>
          <div class="settings-group-body" data-body="trace-backend">
            <div class="trace-current-info">
              \u{1F4CA} Obecne ustawienie HA: <span class="val">stored_traces = 5</span> (domyślne per automatyzacja)
            </div>

            <div class="setting-subsection">Ilość traces</div>
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">Przechowuj N ostatnich traces</div>
                <div class="setting-desc">Ile trace'ów HA ma przechowywać na automatyzację (domyślnie 5). Zmiana dotyczy WSZYSTKICH automatyzacji.</div>
              </div>
              <div class="setting-control">
                <select class="setting-select" id="storedTracesCount">
                  <option value="5" ${this._getSetting('trace.storedCount', 20) == 5 ? 'selected' : ''}>5 (domyślne)</option>
                  <option value="10" ${this._getSetting('trace.storedCount', 20) == 10 ? 'selected' : ''}>10</option>
                  <option value="20" ${this._getSetting('trace.storedCount', 20) == 20 ? 'selected' : ''}>20</option>
                  <option value="50" ${this._getSetting('trace.storedCount', 20) == 50 ? 'selected' : ''}>50</option>
                  <option value="100" ${this._getSetting('trace.storedCount', 20) == 100 ? 'selected' : ''}>100</option>
                </select>
              </div>
            </div>

            <div class="setting-subsection">Filtr czasowy (frontend)</div>
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">Maksymalny wiek traces</div>
                <div class="setting-desc">Ukryj traces starsze niż wybrany okres (filtrowanie po stronie frontendu, nie usuwa danych z HA)</div>
              </div>
              <div class="setting-control">
                <select class="setting-select" data-setting="trace.maxAge" id="traceMaxAge">
                  <option value="0" ${this._getSetting('trace.maxAge', '0') == '0' ? 'selected' : ''}>Bez limitu</option>
                  <option value="3600" ${this._getSetting('trace.maxAge', '0') == '3600' ? 'selected' : ''}>1 godzina</option>
                  <option value="21600" ${this._getSetting('trace.maxAge', '0') == '21600' ? 'selected' : ''}>6 godzin</option>
                  <option value="43200" ${this._getSetting('trace.maxAge', '0') == '43200' ? 'selected' : ''}>12 godzin</option>
                  <option value="86400" ${this._getSetting('trace.maxAge', '0') == '86400' ? 'selected' : ''}>24 godziny</option>
                  <option value="604800" ${this._getSetting('trace.maxAge', '0') == '604800' ? 'selected' : ''}>7 dni</option>
                  <option value="2592000" ${this._getSetting('trace.maxAge', '0') == '2592000' ? 'selected' : ''}>30 dni</option>
                </select>
              </div>
            </div>

            <div class="setting-action-row">
              <button class="btn-apply" id="applyTracesBtn">\u{1F4BE} Zastosuj stored_traces do wszystkich automatyzacji</button>
            </div>
            <div style="padding: 0 var(--spacing-lg) var(--spacing-md);">
              <div class="status-msg" id="traceStatus"></div>
            </div>
          </div>
        </div>

        <!-- Per-addon settings -->
        ${available.map(t => {
          const prefix = t.id;
          const refreshInterval = this._getSetting(`${prefix}.refreshInterval`, 30);
          const showNotifications = this._getSetting(`${prefix}.showNotifications`, true);
          const dashboardCard = this._getSetting(`${prefix}.dashboardCard`, true);
          const pageSize = this._getSetting(`${prefix}.pageSize`, 15);
          const isTraceViewer = prefix === 'trace-viewer';
          return `
            <div class="settings-group">
              <div class="settings-group-header" data-group="${prefix}">
                ${t.icon} ${t.name}
                <span class="chevron">\u25BC</span>
              </div>
              <div class="settings-group-body" data-body="${prefix}">
                <div class="setting-subsection">Wyświetlanie</div>
                <div class="setting-row">
                  <div class="setting-info">
                    <div class="setting-label">Pokazuj w dashboardzie</div>
                    <div class="setting-desc">Widoczność karty na stronie głównej</div>
                  </div>
                  <div class="setting-control">
                    <label class="setting-toggle">
                      <input type="checkbox" data-setting="${prefix}.dashboardCard" ${dashboardCard ? 'checked' : ''}>
                      <span class="slider"></span>
                    </label>
                  </div>
                </div>

                <div class="setting-subsection">Działanie</div>
                ${isTraceViewer ? `
                <div class="setting-row">
                  <div class="setting-info">
                    <div class="setting-label">Wpisów na stronę</div>
                    <div class="setting-desc">Ile traces/automatyzacji wyświetlać na jednej stronie</div>
                  </div>
                  <div class="setting-control">
                    <select class="setting-select" data-setting="${prefix}.pageSize">
                      <option value="10" ${pageSize == 10 ? 'selected' : ''}>10</option>
                      <option value="15" ${pageSize == 15 ? 'selected' : ''}>15</option>
                      <option value="25" ${pageSize == 25 ? 'selected' : ''}>25</option>
                      <option value="30" ${pageSize == 30 ? 'selected' : ''}>30</option>
                      <option value="50" ${pageSize == 50 ? 'selected' : ''}>50</option>
                      <option value="100" ${pageSize == 100 ? 'selected' : ''}>100</option>
                    </select>
                  </div>
                </div>
                ` : ''}
                <div class="setting-row">
                  <div class="setting-info">
                    <div class="setting-label">Interwał odświeżania (sek)</div>
                    <div class="setting-desc">Jak często odświeżać dane</div>
                  </div>
                  <div class="setting-control">
                    <select class="setting-select" data-setting="${prefix}.refreshInterval">
                      <option value="10" ${refreshInterval == 10 ? 'selected' : ''}>10s</option>
                      <option value="30" ${refreshInterval == 30 ? 'selected' : ''}>30s</option>
                      <option value="60" ${refreshInterval == 60 ? 'selected' : ''}>60s</option>
                      <option value="300" ${refreshInterval == 300 ? 'selected' : ''}>5min</option>
                    </select>
                  </div>
                </div>
                <div class="setting-row">
                  <div class="setting-info">
                    <div class="setting-label">Powiadomienia</div>
                    <div class="setting-desc">Pokaż powiadomienia z tego narzędzia</div>
                  </div>
                  <div class="setting-control">
                    <label class="setting-toggle">
                      <input type="checkbox" data-setting="${prefix}.showNotifications" ${showNotifications ? 'checked' : ''}>
                      <span class="slider"></span>
                    </label>
                  </div>
                </div>
              </div>
            </div>
          `;
        }).join('')}

      </div>
    `;

    // Bind settings controls
    content.querySelectorAll('.setting-select').forEach(select => {
      select.addEventListener('change', () => {
        this._setSetting(select.dataset.setting, select.value);
      });
    });

    content.querySelectorAll('.setting-toggle input').forEach(toggle => {
      toggle.addEventListener('change', () => {
        this._setSetting(toggle.dataset.setting, toggle.checked);
      });
    });

    // Collapsible groups
    content.querySelectorAll('.settings-group-header').forEach(header => {
      header.addEventListener('click', () => {
        const group = header.dataset.group;
        const body = content.querySelector(`.settings-group-body[data-body="${group}"]`);
        if (body) {
          body.classList.toggle('hidden');
          header.classList.toggle('collapsed');
        }
      });
    });

    // Trace storage — Apply button
    const applyBtn = content.querySelector('#applyTracesBtn');
    const traceStatus = content.querySelector('#traceStatus');
    const storedTracesSelect = content.querySelector('#storedTracesCount');
    if (applyBtn && storedTracesSelect) {
      applyBtn.addEventListener('click', async () => {
        const count = parseInt(storedTracesSelect.value);
        this._setSetting('trace.storedCount', count);
        applyBtn.disabled = true;
        applyBtn.textContent = '\u23F3 Stosowanie...';
        await this._applyStoredTraces(count, traceStatus);
        applyBtn.disabled = false;
        applyBtn.textContent = '\u{1F4BE} Zastosuj stored_traces do wszystkich automatyzacji';
      });
    }

    // Load current stored_traces value from first automation
    if (this._hass) {
      const infoEl = content.querySelector('.trace-current-info');
      this._loadCurrentStoredTraces(infoEl, storedTracesSelect);
    }
  }

  async _loadCurrentStoredTraces(infoEl, selectEl) {
    try {
      const automations = Object.values(this._hass.states)
        .filter(s => s.entity_id.startsWith('automation.'))
        .map(s => s.attributes.id)
        .filter(Boolean);
      if (automations.length === 0) return;

      // Sample first 5 automations to check their stored_traces
      const sample = automations.slice(0, 5);
      const values = [];
      for (const id of sample) {
        try {
          const config = await this._hass.callApi('GET', `config/automation/config/${id}`);
          values.push(config.stored_traces || 5);
        } catch { values.push(5); }
      }

      const unique = [...new Set(values)];
      const current = unique.length === 1 ? unique[0] : `${Math.min(...values)}-${Math.max(...values)}`;
      if (infoEl) {
        infoEl.innerHTML = `\u{1F4CA} Obecne ustawienie HA: <span class="val">stored_traces = ${current}</span> (sprawdzono ${sample.length} z ${automations.length} automatyzacji)`;
      }
      // Pre-select current value if all are the same
      if (unique.length === 1 && selectEl) {
        const opt = selectEl.querySelector(`option[value="${unique[0]}"]`);
        if (opt) opt.selected = true;
      }
    } catch (e) {
      console.warn('[HA Tools] Could not load stored_traces info:', e);
    }
  }

  async _applyStoredTraces(count, statusEl) {
    if (!this._hass) {
      statusEl.textContent = '\u274C Brak połączenia z Home Assistant';
      statusEl.className = 'status-msg visible error';
      return;
    }
    statusEl.textContent = '\u23F3 Pobieranie listy automatyzacji...';
    statusEl.className = 'status-msg visible info';

    try {
      // Get all automations
      const automations = Object.values(this._hass.states)
        .filter(s => s.entity_id.startsWith('automation.'))
        .map(s => s.attributes.id)
        .filter(Boolean);

      let updated = 0;
      let skippedYaml = 0;
      let errors = 0;

      // Count YAML vs UI automations
      for (const id of automations) {
        statusEl.textContent = `\u23F3 Sprawdzanie ${updated + skippedYaml + 1}/${automations.length}...`;
        try {
          await this._hass.callApi('GET', `config/automation/config/${id}`);
          updated++;
        } catch (e) {
          skippedYaml++;
        }
      }

      statusEl.innerHTML = `\u2705 stored_traces: ${count}<br>` +
        `<small>\u{1F4CA} ${automations.length} automatyzacji: ${updated} UI, ${skippedYaml} YAML</small><br>` +
        `<small style="opacity:0.8">\u{1F4DD} Ustaw <code>stored_traces: ${count}</code> w configuration.yaml pod sekcją <code>automation:</code> — API nie obsługuje tego pola per-automatyzacja.</small>`;
      statusEl.className = 'status-msg visible success';
    } catch (e) {
      statusEl.textContent = `\u274C Błąd: ${e.message}`;
      statusEl.className = 'status-msg visible error';
    }
  }

  _loadTool(toolId, tag) {
    this._activeView = 'tool';
    this._activeToolId = toolId;
    this._cardInstance = null;

    const tool = HAToolsPanel.TOOLS.find(t => t.id === toolId);
    const displayName = tool ? tool.name : toolId;
    const displayIcon = tool ? tool.icon : '';
    const title = this.shadowRoot.getElementById('title');
    title.textContent = `${displayIcon} ${displayName}`;
    // Hide panel refresh for tools that have their own refresh button
    const toolsWithOwnRefresh = ['ha-trace-viewer', 'ha-data-exporter'];
    this.shadowRoot.getElementById('refreshBtn').style.display = toolsWithOwnRefresh.includes(tag) ? 'none' : '';

    const content = this.shadowRoot.getElementById('content');
    content.innerHTML = `<div class="empty"><div class="big">\u23F3</div><div>Ładowanie...</div></div>`;

    requestAnimationFrame(() => {
      setTimeout(() => {
        try {
          content.innerHTML = '';
          const card = document.createElement(tag);

          if (typeof card.setConfig === 'function') {
            card.setConfig({ title: displayName, panel_mode: true });
          }

          if (tag === 'ha-cry-analyzer') {
            card.hassObj = this._hass;
          } else {
            card.hass = this._hass;
          }

          card.style.cssText = 'display:block; min-height:calc(100vh - 56px);';
          content.appendChild(card);
          this._cardInstance = card;
        } catch (e) {
          content.innerHTML = `<div class="empty"><div class="big">\u26A0\uFE0F</div><div>Błąd: ${e.message}</div></div>`;
        }
      }, 100);
    });
  }
}

customElements.define('ha-tools-panel', HAToolsPanel);
console.log('[HA Tools Panel v2.2] Registered — auto-loading addons');
