/**
 * HA Tools Panel v2.2 â€” Auto-loading addons with progress notification
 * Author: MacSiem
 * Features: Auto-loads addon scripts, polls for customElements registration,
 *           shows loading progress bar, dynamically updates sidebar
 */

// â”€â”€ Build version & auto-update detection â”€â”€
// ZmieĹ„ BUILD_VERSION przy kaĹĽdej aktualizacji kodu.
// Panel automatycznie wykryje nowÄ… wersjÄ™ i pokaĹĽe toast z przyciskiem "OdĹ›wieĹĽ".
const HA_TOOLS_BUILD = '3.3.0';
const HA_TOOLS_BUILD_TS = '20260324-0955';

(function _checkVersion() {
  const KEY = 'ha-tools-build';
  // Just store current version, no toast (HA caching makes version detection unreliable)
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
    this._lastSidebarAvailCount = -1;
    this._lastSidebarUnavailCount = -1;
  }

  connectedCallback() {
    // When loaded via dynamic loader, HA may set properties (hass, panel, etc.)
    // as plain object props BEFORE the custom element class is defined.
    // After upgrade, the setters never fired â€” re-apply them now.
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
      'ha-energy-email': '/local/community/ha-energy-email/ha-energy-email.js',
      'ha-vacuum-water-monitor': '/local/community/ha-vacuum-water-monitor/ha-vacuum-water-monitor.js',
      'ha-log-email': '/local/community/ha-log-email/ha-log-email.js',
      'ha-yaml-checker': '/local/community/ha-yaml-checker/ha-yaml-checker.js',
      'ha-energy-insights': '/local/community/ha-energy-insights/ha-energy-insights.js',
    };
  }

  _loadAddonScripts() {
    // Always use Date.now() cache buster to avoid stale JS from HACS/browser cache
    const cb = Date.now();
    const scripts = HAToolsPanel.TOOL_SCRIPTS;
    for (const [tag, src] of Object.entries(scripts)) {
      if (customElements.get(tag)) continue; // already registered by HACS or previous load
      // Force-load with cache buster â€” do NOT check for existing script tags
      // because HACS may have loaded an older cached version that failed to register
      const script = document.createElement('script');
      script.type = 'text/javascript';
      script.src = src + '?_=' + cb;
      script.async = true;
      script.onerror = () => console.warn(`[HA Tools] Failed to load: ${src}`);
      document.head.appendChild(script);
    }
  }

  _startPolling() {
    let attempts = 0;
    const maxAttempts = 120; // 60 seconds max
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
        // Loading complete
        this._showUpdateToastIfNeeded();
        return;
      }
    };
    this._pollTimer = setInterval(poll, 500);
    // Run once immediately
    poll();
  }

  _showUpdateToastIfNeeded() {
    // Disabled: HA caching makes version detection unreliable, toast was showing false downgrades
  }

  _updateLoadingStatus() {
    const bar = this.shadowRoot?.querySelector('.loading-bar');
    if (!bar) return;
    const total = HAToolsPanel.TOOLS.length;
    if (this._loading) {
      bar.style.display = 'flex';
      bar.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.2);border-radius:10px;width:100%;">
          <div class="spinner" style="width:18px;height:18px;border-width:2px;flex-shrink:0;"></div>
          <span style="font-size:13px;font-weight:500;color:var(--bento-text);">\u0141adowanie... ${this._loadedCount}/${total}</span>
          <div class="loading-progress" style="flex:1;">
            <div class="loading-progress-fill" style="width:${(this._loadedCount / total) * 100}%"></div>
          </div>
        </div>
      `;
    } else {
      if (this._loadedCount >= total) {
        bar.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:10px;width:100%;">
            <span style="font-size:16px;">\u2705</span>
            <span style="flex:1;font-size:13px;font-weight:500;color:var(--bento-text);">${this._loadedCount}/${total} narz\u0119dzi gotowych</span>
            <button onclick="this.closest('.loading-bar').style.display='none'" style="background:none;border:none;cursor:pointer;font-size:16px;color:var(--bento-text-secondary);padding:0 4px;">\u2715</button>
          </div>`;
        setTimeout(() => { bar.style.display = 'none'; }, 4000);
      } else {
        bar.innerHTML = `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 16px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:10px;width:100%;">
            <span style="font-size:16px;">\u26A0\uFE0F</span>
            <span style="flex:1;font-size:13px;font-weight:500;color:var(--bento-text);">${this._loadedCount}/${total} narz\u0119dzi za\u0142adowanych</span>
            <button onclick="this.closest('.loading-bar').style.display='none'" style="background:none;border:none;cursor:pointer;font-size:16px;color:var(--bento-text-secondary);padding:0 4px;">\u2715</button>
          </div>`;
        setTimeout(() => { bar.style.display = 'none'; }, 8000);
      }
    }
  }

  _updateSidebar() {
    const { available, unavailable } = this._getToolStatus();
    const availCount = available.length;
    const unavailCount = unavailable.length;

    // Always update badge and section header counts (cheap text-only updates)
    const badge = this.shadowRoot?.querySelector('.nav-badge');
    if (badge) badge.textContent = `${availCount}/${HAToolsPanel.TOOLS.length}`;
    const toolsSection = this.shadowRoot?.querySelector('.nav-section-tools');
    if (toolsSection) toolsSection.textContent = `Narz\u0119dzia (${availCount})`;
    const unavailSection = this.shadowRoot?.querySelector('.nav-section-unavailable');
    if (unavailSection) {
      if (unavailCount > 0) {
        unavailSection.textContent = `Niedost\u0119pne (${unavailCount})`;
        unavailSection.style.display = '';
      } else {
        unavailSection.style.display = 'none';
      }
    }

    // Only do full DOM rebuild when the tool list actually changed in size.
    // This prevents sidebar flicker caused by repeated innerHTML resets during the 60s polling loop.
    const listChanged = availCount !== this._lastSidebarAvailCount || unavailCount !== this._lastSidebarUnavailCount;

    const toolsContainer = this.shadowRoot?.querySelector('.nav-tools-list');
    const unavailContainer = this.shadowRoot?.querySelector('.nav-unavail-list');

    if (listChanged && toolsContainer) {
      this._lastSidebarAvailCount = availCount;
      this._lastSidebarUnavailCount = unavailCount;

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

      if (unavailContainer) {
        if (unavailCount > 0) {
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
    } else if (!listChanged && toolsContainer) {
      // List unchanged — just sync the active class without touching DOM structure
      toolsContainer.querySelectorAll('.nav-item[data-tool]').forEach(item => {
        if (item.dataset.tool === this._activeToolId) {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }
      });
    }
  }

  static get TOOLS() {
    return [
      { id: 'trace-viewer', name: 'Trace Viewer', icon: '\u{1F9EC}', tag: 'ha-trace-viewer', desc: 'PrzeglÄ…daj i analizuj Ĺ›lady automatyzacji', repo: 'MacSiem/ha-trace-viewer', category: 'debug' },
      { id: 'device-health', name: 'Device Health', icon: '\u{1F3E5}', tag: 'ha-device-health', desc: 'Monitoruj stan urzÄ…dzeĹ„, baterii i sieci', repo: 'MacSiem/ha-device-health', category: 'monitor' },
      { id: 'automation-analyzer', name: 'Automation Analyzer', icon: '\u{1F4CA}', tag: 'ha-automation-analyzer', desc: 'Analizuj wydajnoĹ›Ä‡ i problemy automatyzacji', repo: 'MacSiem/ha-automation-analyzer', category: 'debug' },
      { id: 'backup-manager', name: 'Backup Manager', icon: '\u{1F4BE}', tag: 'ha-backup-manager', desc: 'ZarzÄ…dzaj kopiami zapasowymi', repo: 'MacSiem/ha-backup-manager', category: 'system' },
      { id: 'network-map', name: 'Network Map', icon: '\u{1F310}', tag: 'ha-network-map', desc: 'Wizualizuj mapÄ™ sieci urzÄ…dzeĹ„', repo: 'MacSiem/ha-network-map', category: 'monitor' },
      { id: 'smart-reports', name: 'Smart Reports', icon: '\u{1F4C8}', tag: 'ha-smart-reports', desc: 'Generuj inteligentne raporty', repo: 'MacSiem/ha-smart-reports', category: 'reports' },
      { id: 'energy-optimizer', name: 'Energy Optimizer', icon: '\u26A1', tag: 'ha-energy-optimizer', desc: 'Optymalizuj zuĹĽycie energii', repo: 'MacSiem/ha-energy-optimizer', category: 'monitor' },
      { id: 'sentence-manager', name: 'Sentence Manager', icon: '\u{1F5E3}\uFE0F', tag: 'ha-sentence-manager', desc: 'ZarzÄ…dzaj zdaniami gĹ‚osowymi', repo: 'MacSiem/ha-sentence-manager', category: 'system' },
      { id: 'chore-tracker', name: 'Chore Tracker', icon: '\u{1F3E0}', tag: 'ha-chore-tracker', desc: 'Ĺšledzenie obowiÄ…zkĂłw domowych', repo: 'MacSiem/ha-chore-tracker', category: 'life' },
      { id: 'baby-tracker', name: 'Baby Tracker', icon: '\u{1F37C}', tag: 'ha-baby-tracker', desc: 'Ĺšledzenie aktywnoĹ›ci dziecka', repo: 'MacSiem/ha-baby-tracker', category: 'life' },
      { id: 'cry-analyzer', name: 'Cry Analyzer', icon: '\u{1F476}', tag: 'ha-cry-analyzer', desc: 'Analiza pĹ‚aczu dziecka AI', repo: 'MacSiem/ha-cry-analyzer', category: 'life' },
      { id: 'data-exporter', name: 'Data Exporter', icon: '\u{1F4E4}', tag: 'ha-data-exporter', desc: 'Eksportuj dane z Home Assistant', repo: 'MacSiem/ha-data-exporter', category: 'system' },
      { id: 'storage-monitor', name: 'Storage Monitor', icon: '\u{1F4BD}', tag: 'ha-storage-monitor', desc: 'Wizualizacja uĹĽycia dysku w stylu WinDirStat', repo: 'MacSiem/ha-storage-monitor', category: 'system' },
      { id: 'security-check', name: 'Security Check', icon: '\u{1F6E1}\uFE0F', tag: 'ha-security-check', desc: 'Audyt bezpieczeĹ„stwa Home Assistant', repo: 'MacSiem/ha-security-check', category: 'system' },
      { id: 'log-email', name: 'Log Email', icon: '\uD83D\uDEA8', tag: 'ha-log-email', desc: 'Email digest b\u0142\u0119d\u00F3w i ostrze\u017Ce\u0144 HA', repo: 'MacSiem/ha-log-email', category: 'reports' },
      { id: 'yaml-checker', name: 'YAML Checker', icon: '\uD83D\uDD0D', tag: 'ha-yaml-checker', desc: 'Walidator YAML: config check, encje, szablony', repo: 'MacSiem/ha-yaml-checker', category: 'debug' },
      { id: 'energy-insights', name: 'Energy Insights', icon: '\u26A1', tag: 'ha-energy-insights', desc: 'Dashboard energii: zu\u017Cycie, koszty, top urz\u0105dzenia, trendy', repo: 'MacSiem/ha-energy-insights', category: 'monitor' },
    ];
  }

  static get CATEGORIES() {
    return {
      monitor: { name: 'Monitoring', icon: '\u{1F4CB}' },
      debug: { name: 'Debugowanie', icon: '\u{1F527}' },
      system: { name: 'System', icon: '\u2699\uFE0F' },
      reports: { name: 'Raporty', icon: '\u{1F4C4}' },
      life: { name: 'Ĺ»ycie', icon: '\u{1F3E1}' },
    };
  }

  static get CSS() {
    return `

@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

:host {
  --bento-bg: #F8FAFC;
  --bento-card: #FFFFFF;
  --bento-primary: #3B82F6;
  --bento-primary-hover: #2563EB;
  --bento-text: #1E293B;
  --bento-text-secondary: #64748B;
  --bento-border: #E2E8F0;
  --bento-success: #10B981;
  --bento-warning: #F59E0B;
  --bento-error: #EF4444;
  --bento-radius: 16px;
  --bento-radius-sm: 10px;
  --bento-radius-xs: 6px;
  --bento-shadow: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.02);
  --bento-shadow-md: 0 4px 12px rgba(0,0,0,0.06);
  --bento-transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  display: block;
  color-scheme: light dark;
}

/* Dark mode - detect HA dark theme via background luminance or prefers-color-scheme */
@media (prefers-color-scheme: dark) {
  :host {
    --bento-bg: #1a1a2e;
    --bento-card: #16213e;
    --bento-text: #e2e8f0;
    --bento-text-secondary: #94a3b8;
    --bento-border: #334155;
    --bento-shadow: 0 1px 3px rgba(0,0,0,0.3);
    --bento-shadow-md: 0 4px 12px rgba(0,0,0,0.4);
  }
}

/* Also detect HA theme via CSS custom property - this works when HA sets dark theme */
:host-context([data-themes]) {
  --bento-bg: var(--lovelace-background, var(--primary-background-color, #F8FAFC));
  --bento-card: var(--card-background-color, var(--ha-card-background, #FFFFFF));
  --bento-text: var(--primary-text-color, #1E293B);
  --bento-text-secondary: var(--secondary-text-color, #64748B);
  --bento-border: var(--divider-color, #E2E8F0);
}

* { box-sizing: border-box; }

@keyframes fadeSlideIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
@keyframes shimmer { to { background-position: -200% 0; } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes slideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }

.panel {
  display: flex;
  height: 100vh;
  background: var(--bento-bg);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  color: var(--bento-text);
}

/* SIDEBAR */
.sidebar {
  width: 260px;
  background: var(--bento-card);
  contain: layout style; /* Isolate reflows to prevent flicker on DOM updates */
  border-right: 1px solid var(--bento-border);
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
}

.sidebar-header {
  padding: 20px;
  font-size: 18px;
  font-weight: 700;
  color: var(--bento-text);
  border-bottom: 1px solid var(--bento-border);
  letter-spacing: -0.01em;
}

.sidebar-header .version {
  font-size: 11px;
  color: var(--bento-text-secondary);
  font-weight: 500;
  margin-left: 8px;
}

.sidebar-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.sidebar-scroll::-webkit-scrollbar { width: 4px; }
.sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
.sidebar-scroll::-webkit-scrollbar-thumb { background: var(--bento-border); border-radius: 2px; }

.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid var(--bento-border);
  font-size: 11px;
  color: var(--bento-text-secondary);
}

/* NAV */
.nav-section {
  padding: 8px 12px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--bento-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  margin: 2px 8px;
  border-radius: var(--bento-radius-sm);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  color: var(--bento-text-secondary);
  transition: var(--bento-transition);
  font-family: 'Inter', sans-serif;
}

.nav-item:hover {
  background: rgba(59, 130, 246, 0.06);
  color: var(--bento-text);
}

.nav-item.active {
  background: rgba(59, 130, 246, 0.1);
  color: var(--bento-primary);
  font-weight: 600;
}

.nav-item.unavailable {
  opacity: 0.4;
  cursor: not-allowed;
}

.nav-item .nav-icon {
  font-size: 16px;
  width: 20px;
  text-align: center;
}

.nav-item .nav-badge {
  margin-left: auto;
  background: var(--bento-border);
  color: var(--bento-text-secondary);
  font-size: 10px;
  font-weight: 700;
  padding: 2px 7px;
  border-radius: 10px;
}

/* MAIN AREA */
.main {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bento-bg);
}

.toolbar {
  display: flex;
  align-items: center;
  padding: 16px 24px;
  background: var(--bento-card);
  border-bottom: 1px solid var(--bento-border);
  gap: 12px;
}

.toolbar-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--bento-text);
  letter-spacing: -0.01em;
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.content::-webkit-scrollbar { width: 6px; }
.content::-webkit-scrollbar-track { background: transparent; }
.content::-webkit-scrollbar-thumb { background: var(--bento-border); border-radius: 3px; }

/* BUTTONS */
.btn {
  padding: 9px 16px; border: 1.5px solid var(--bento-border); background: var(--bento-card);
  color: var(--bento-text); border-radius: var(--bento-radius-sm); cursor: pointer;
  font-size: 13px; font-weight: 500; font-family: 'Inter', sans-serif; transition: var(--bento-transition);
}
.btn:hover { background: var(--bento-bg); border-color: var(--bento-primary); color: var(--bento-primary); }
.btn-primary { padding: 9px 16px; background: var(--bento-primary); color: white; border: 1.5px solid var(--bento-primary); border-radius: var(--bento-radius-sm); cursor: pointer; font-size: 13px; font-weight: 600; font-family: 'Inter', sans-serif; transition: var(--bento-transition); box-shadow: 0 2px 8px rgba(59, 130, 246, 0.25); }
.btn-primary:hover { background: var(--bento-primary-hover); transform: translateY(-1px); }
.btn-secondary { padding: 9px 16px; background: var(--bento-card); color: var(--bento-text); border: 1.5px solid var(--bento-border); border-radius: var(--bento-radius-sm); cursor: pointer; font-size: 13px; font-weight: 500; font-family: 'Inter', sans-serif; transition: var(--bento-transition); }
.btn-secondary:hover { border-color: var(--bento-primary); color: var(--bento-primary); }
.btn-sm { padding: 6px 12px; font-size: 12px; border-radius: var(--bento-radius-xs); }
.btn-icon { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border: 1.5px solid var(--bento-border); background: var(--bento-card); border-radius: var(--bento-radius-sm); cursor: pointer; transition: var(--bento-transition); font-size: 16px; padding: 0; }
.btn-icon:hover { border-color: var(--bento-primary); color: var(--bento-primary); background: rgba(59, 130, 246, 0.04); }
.toolbar-actions { display: flex; align-items: center; gap: 10px; margin-left: auto; }
.ar-toggle { display: flex; align-items: center; gap: 6px; cursor: pointer; user-select: none; }
.ar-toggle input { display: none; }
.ar-track { width: 34px; height: 18px; background: var(--bento-border); border-radius: 9px; position: relative; transition: 0.2s; }
.ar-thumb { position: absolute; width: 14px; height: 14px; background: white; border-radius: 50%; top: 2px; left: 2px; transition: 0.2s; box-shadow: 0 1px 2px rgba(0,0,0,0.15); }
.ar-toggle input:checked ~ .ar-track { background: var(--bento-primary); }
.ar-toggle input:checked ~ .ar-track .ar-thumb { left: 18px; }
.ar-lbl { font-size: 11px; color: var(--bento-text-secondary); font-weight: 500; }
.ar-toggle input:checked ~ .ar-lbl { color: var(--bento-primary); }

/* UNINSTALLED / UNAVAILABLE TOOLS */
.uninstalled-list { display: flex; flex-direction: column; gap: 12px; }
.uninstalled-item {
  display: flex; align-items: center; gap: 12px; padding: 14px 16px;
  background: var(--bento-bg); border: 1.5px dashed var(--bento-border);
  border-radius: var(--bento-radius); transition: var(--bento-transition);
}
.uninstalled-item:hover { border-color: var(--bento-primary); background: rgba(59, 130, 246, 0.03); }
.ui-icon { font-size: 24px; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: var(--bento-card); border-radius: var(--bento-radius-sm); border: 1px solid var(--bento-border); flex-shrink: 0; }
.ui-name { font-size: 14px; font-weight: 600; color: var(--bento-text); min-width: 120px; }
.ui-desc { flex: 1; font-size: 12.5px; color: var(--bento-text-secondary); line-height: 1.4; }
.uninstalled-item.loading-item { opacity: 0.6; border-style: dotted; }
.uninstalled-item.loading-item .ui-desc { font-style: italic; }

/* SETTING SUBSECTIONS & ACTIONS */
.setting-subsection {
  font-size: 11px; font-weight: 700; color: var(--bento-text-secondary);
  text-transform: uppercase; letter-spacing: 0.06em;
  padding: 12px 20px 6px; border-top: 1px solid var(--bento-border);
  margin-top: 4px;
}
.trace-current-info {
  padding: 12px 20px; margin: 0; font-size: 13px; color: var(--bento-text);
  background: rgba(59,130,246,0.06); border-bottom: 1px solid var(--bento-border);
}
.trace-current-info .val { font-weight: 700; color: var(--bento-primary); }
.setting-action-row { padding: 12px 20px; border-top: 1px solid var(--bento-border); }
.btn-apply {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border: 1.5px solid var(--bento-primary); background: rgba(59,130,246,0.08);
  color: var(--bento-primary); border-radius: var(--bento-radius-sm); cursor: pointer;
  font-size: 13px; font-weight: 600; font-family: 'Inter', sans-serif; transition: var(--bento-transition);
}
.btn-apply:hover { background: var(--bento-primary); color: white; }
.status-msg { padding: 8px 16px; margin: 8px 20px; border-radius: var(--bento-radius-sm); font-size: 12px; display: none; }
.status-msg.visible { display: block; }
.status-msg.success { background: rgba(16,185,129,0.08); color: var(--bento-success); border: 1px solid var(--bento-success); }
.status-msg.error { background: rgba(239,68,68,0.08); color: var(--bento-error); border: 1px solid var(--bento-error); }
.status-msg.info { background: rgba(59,130,246,0.08); color: var(--bento-primary); border: 1px solid var(--bento-primary); }

.empty { text-align: center; padding: 48px 24px; color: var(--bento-text-secondary); font-size: 14px; }
.empty .big { font-size: 48px; margin-bottom: 12px; opacity: 0.5; }

/* HOME VIEW */
.home-view { animation: fadeSlideIn 0.4s ease-out; }
.home-section { margin-bottom: 32px; }
.home-section-title { font-size: 16px; font-weight: 600; color: var(--bento-text); margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
.home-section-title .count { background: var(--bento-border); color: var(--bento-text-secondary); font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 10px; }

.tools-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 16px; }
.tool-card { background: var(--bento-card); border: 1px solid var(--bento-border); border-radius: var(--bento-radius); padding: 20px; cursor: pointer; transition: var(--bento-transition); animation: fadeSlideIn 0.4s ease-out; }
.tool-card:hover { border-color: var(--bento-primary); box-shadow: var(--bento-shadow-md); transform: translateY(-2px); }
.tool-card-header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.tool-card-icon { font-size: 24px; width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; background: rgba(59, 130, 246, 0.08); border-radius: var(--bento-radius-sm); }
.tool-card-name { font-size: 14px; font-weight: 600; color: var(--bento-text); }
.tool-card-desc { font-size: 12px; color: var(--bento-text-secondary); line-height: 1.5; margin-bottom: 10px; }
.tool-card-footer { display: flex; align-items: center; justify-content: space-between; }
.tool-card-category { font-size: 11px; font-weight: 500; color: var(--bento-text-secondary); }
.tool-card-status { font-size: 11px; font-style: italic; color: var(--bento-success); }

/* TOOL STATUS */
.tool-status { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
.tool-status.loaded { background: rgba(16, 185, 129, 0.1); color: #059669; }
.tool-status.error { background: rgba(239, 68, 68, 0.1); color: #DC2626; }
.tool-status.loading { background: rgba(59, 130, 246, 0.1); color: var(--bento-primary); }

/* SETTINGS */
.settings-view { animation: fadeSlideIn 0.4s ease-out; }
.settings-group { background: var(--bento-card); border: 1px solid var(--bento-border); border-radius: var(--bento-radius); margin-bottom: 16px; overflow: hidden; }
.settings-group-header {
  display: flex; justify-content: space-between; align-items: center; padding: 16px 20px;
  font-size: 15px; font-weight: 600; color: var(--bento-text); cursor: pointer;
  background: var(--bento-card); border-bottom: 1px solid var(--bento-border);
  transition: var(--bento-transition); user-select: none;
}
.settings-group-header:hover { background: rgba(59, 130, 246, 0.04); }
.settings-group-header .chevron { font-size: 12px; color: var(--bento-text-secondary); transition: transform 0.2s ease; }
.settings-group-header.collapsed .chevron { transform: rotate(-90deg); }
.settings-group-body { padding: 4px 0; }
.settings-group-body.hidden { display: none; }
.setting-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 14px 20px; border-bottom: 1px solid var(--bento-border);
  transition: var(--bento-transition);
}
.setting-row:last-child { border-bottom: none; }
.setting-row:hover { background: rgba(59, 130, 246, 0.03); }
.setting-info { flex: 1; min-width: 0; margin-right: 16px; }
.setting-label { font-size: 13.5px; font-weight: 500; color: var(--bento-text); }
.setting-desc { font-size: 12px; color: var(--bento-text-secondary); margin-top: 3px; line-height: 1.4; }
.setting-control { flex-shrink: 0; }
.setting-select {
  padding: 8px 12px; border: 1.5px solid var(--bento-border); border-radius: var(--bento-radius-sm);
  background: var(--bento-card); color: var(--bento-text); font-size: 13px;
  font-family: 'Inter', sans-serif; cursor: pointer; transition: var(--bento-transition);
  outline: none; min-width: 120px;
}
.setting-select:focus { border-color: var(--bento-primary); box-shadow: 0 0 0 3px rgba(59,130,246,0.1); }
.setting-toggle { position: relative; display: inline-block; width: 44px; height: 24px; cursor: pointer; }
.setting-toggle input { opacity: 0; width: 0; height: 0; }
.setting-toggle .slider {
  position: absolute; top: 0; left: 0; right: 0; bottom: 0;
  background: var(--bento-border); border-radius: 12px; transition: 0.25s ease;
}
.setting-toggle .slider::before {
  content: ''; position: absolute; width: 20px; height: 20px;
  background: white; border-radius: 50%; top: 2px; left: 2px;
  transition: 0.25s ease; box-shadow: 0 1px 3px rgba(0,0,0,0.15);
}
.setting-toggle input:checked + .slider { background: var(--bento-primary); }
.setting-toggle input:checked + .slider::before { left: 22px; }
.settings-value { font-size: 13px; color: var(--bento-text-secondary); }

/* TOGGLE */
.toggle { width: 44px; height: 24px; background: var(--bento-border); border-radius: 12px; cursor: pointer; position: relative; transition: var(--bento-transition); border: none; padding: 0; }
.toggle.on { background: var(--bento-primary); }
.toggle::after { content: ''; position: absolute; width: 20px; height: 20px; background: white; border-radius: 50%; top: 2px; left: 2px; transition: var(--bento-transition); box-shadow: 0 1px 3px rgba(0,0,0,0.15); }
.toggle.on::after { left: 22px; }

/* LOADING */
.loading-view { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 48px; }
.spinner { width: 32px; height: 32px; border: 3px solid var(--bento-border); border-top: 3px solid var(--bento-primary); border-radius: 50%; animation: spin 0.8s linear infinite; }
.loading-text { margin-top: 16px; color: var(--bento-text-secondary); font-size: 14px; }

.skeleton { background: linear-gradient(90deg, var(--bento-border) 25%, rgba(226,232,240,0.5) 50%, var(--bento-border) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: var(--bento-radius-xs); }

/* TOAST */
.toast { position: fixed; bottom: 24px; right: 24px; background: var(--bento-text); color: white; padding: 14px 20px; border-radius: var(--bento-radius-sm); font-size: 13px; font-weight: 500; box-shadow: var(--bento-shadow-md); z-index: 1000; animation: slideUp 0.3s ease-out; font-family: 'Inter', sans-serif; }
.toast.error { background: var(--bento-error); }
.toast.success { background: var(--bento-success); }

/* MOBILE SIDEBAR TOGGLE */
.sidebar-toggle {
  display: none;
  width: 36px; height: 36px;
  border: 1.5px solid var(--bento-border);
  background: var(--bento-card);
  border-radius: var(--bento-radius-sm);
  cursor: pointer;
  font-size: 18px;
  align-items: center; justify-content: center;
  color: var(--bento-text);
  transition: var(--bento-transition);
  flex-shrink: 0;
}
.sidebar-toggle:hover { background: var(--bento-bg); border-color: var(--bento-primary); }

.sidebar-overlay {
  display: none;
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.3);
  z-index: 99;
}

/* RESPONSIVE */
@media (max-width: 900px) {
  .tools-grid { grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); }
  .content { padding: 16px; }
}

@media (max-width: 768px) {
  .sidebar-toggle { display: flex; }
  .panel { flex-direction: row; position: relative; }
  .sidebar {
    position: fixed; top: 0; left: 0; bottom: 0;
    width: 260px; z-index: 100;
    transform: translateX(-100%);
    transition: transform 0.25s ease;
    border-right: 1px solid var(--bento-border);
    box-shadow: none;
  }
  .sidebar.open {
    transform: translateX(0);
    box-shadow: 4px 0 20px rgba(0,0,0,0.15);
  }
  .sidebar-overlay.visible { display: block; }
  .sidebar-scroll {
    display: flex; flex-direction: column;
    overflow-y: auto; overflow-x: hidden;
    padding: 8px 0;
  }
  .nav-item { white-space: nowrap; margin: 2px 8px; }
  .tools-grid { grid-template-columns: 1fr; }
  .content { padding: 12px; }
  .toolbar { padding: 12px 16px; }
  .toolbar-title { font-size: 15px; }
  .home-section-title { font-size: 14px; }
  .tool-card { padding: 12px; }
  .donate-section { padding: 16px; flex-direction: column; text-align: center; }
  .donate-buttons { justify-content: center; }
}

@media (max-width: 480px) {
  .tools-grid { grid-template-columns: 1fr; gap: 8px; }
  .tool-card-title { font-size: 13px; }
  .tool-card-desc { font-size: 11px; }
  .content { padding: 8px; }
}

/* Donate Section - Bento Style */
.donate-section {
  margin-top: 32px;
  background: linear-gradient(135deg, #fff5f5 0%, #fff0f6 50%, #f8f0ff 100%);
  border: 1px solid #fecdd3;
  border-radius: 16px;
  padding: 28px 32px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  flex-wrap: wrap;
}
.donate-section h3 {
  font-size: 17px;
  font-weight: 600;
  color: #881337;
  margin: 0 0 6px 0;
}
.donate-section p {
  font-size: 13.5px;
  color: #9f1239;
  margin: 0;
  opacity: 0.85;
  line-height: 1.5;
}
.donate-buttons {
  display: flex;
  gap: 12px;
  flex-shrink: 0;
}
.donate-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 20px;
  border-radius: 10px;
  font-size: 13.5px;
  font-weight: 600;
  text-decoration: none;
  transition: all 0.2s ease;
  box-shadow: 0 2px 8px rgba(0,0,0,0.06);
}
.donate-btn.coffee {
  background: #FFDD00;
  color: #000;
  border: 1px solid #e6c700;
}
.donate-btn.coffee:hover {
  background: #ffe534;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(255,221,0,0.4);
}
.donate-btn.paypal {
  background: #0070ba;
  color: #fff;
  border: 1px solid #005ea6;
}
.donate-btn.paypal:hover {
  background: #0086e0;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0,112,186,0.4);
}


`;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._rendered) {
      this._rendered = true;
      this._render();
    }
    // Throttle hass propagation to child card (HA sends ~3 updates/sec)
    if (this._cardInstance) {
      const now = Date.now();
      if (!this._lastHassPropagation || (now - this._lastHassPropagation) > 5000) {
        this._lastHassPropagation = now;
        if (this._cardInstance.tagName.toLowerCase() === 'ha-cry-analyzer') {
          this._cardInstance.hassObj = hass;
        } else {
          this._cardInstance.hass = hass;
        }
      } else if (!this._hassPropScheduled) {
        this._hassPropScheduled = true;
        setTimeout(() => {
          this._hassPropScheduled = false;
          this._lastHassPropagation = Date.now();
          if (this._cardInstance) {
            if (this._cardInstance.tagName.toLowerCase() === 'ha-cry-analyzer') {
              this._cardInstance.hassObj = this._hass;
            } else {
              this._cardInstance.hass = this._hass;
            }
          }
        }, 5000);
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
      <style>
/* ===== BENTO LIGHT MODE DESIGN SYSTEM ===== */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

:host {
  --bento-primary: #3B82F6;
  --bento-primary-hover: #2563EB;
  --bento-primary-light: rgba(59, 130, 246, 0.08);
  --bento-success: #10B981;
  --bento-success-light: rgba(16, 185, 129, 0.08);
  --bento-error: #EF4444;
  --bento-error-light: rgba(239, 68, 68, 0.08);
  --bento-warning: #F59E0B;
  --bento-warning-light: rgba(245, 158, 11, 0.08);
  --bento-bg: #F8FAFC;
  --bento-card: #FFFFFF;
  --bento-border: #E2E8F0;
  --bento-text: #1E293B;
  --bento-text-secondary: #64748B;
  --bento-text-muted: #94A3B8;
  --bento-radius-xs: 6px;
  --bento-radius-sm: 10px;
  --bento-radius-md: 16px;
  --bento-shadow-sm: 0 1px 3px rgba(0,0,0,0.04), 0 1px 2px rgba(0,0,0,0.06);
  --bento-shadow-md: 0 4px 12px rgba(0,0,0,0.05), 0 2px 4px rgba(0,0,0,0.04);
  --bento-shadow-lg: 0 8px 25px rgba(0,0,0,0.06), 0 4px 10px rgba(0,0,0,0.04);
  --bento-transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

/* Card */
.card, .ha-card, ha-card, .main-card, .exporter-card, .security-card, .reports-card, .storage-card, .chore-card, .cry-card, .backup-card, .network-card, .sentence-card, .energy-card, .panel-card {
  background: var(--bento-card) !important;
  border: 1px solid var(--bento-border) !important;
  border-radius: var(--bento-radius-md) !important;
  box-shadow: var(--bento-shadow-sm) !important;
  font-family: 'Inter', sans-serif !important;
  color: var(--bento-text) !important;
  overflow: hidden;
}

/* Headers */
.card-header, .header, .card-title, h1, h2, h3 {
  color: var(--bento-text) !important;
  font-family: 'Inter', sans-serif !important;
}
.card-header, .header {
  border-bottom: 1px solid var(--bento-border) !important;
  padding-bottom: 12px !important;
  margin-bottom: 16px !important;
}

/* Tabs */
.tabs, .tab-bar, .tab-nav, .tab-header {
  display: flex;
  gap: 4px;
  border-bottom: 2px solid var(--bento-border);
  padding: 0 4px;
  margin-bottom: 20px;
  overflow-x: auto;
}
.tab, .tab-btn, .tab-button {
  padding: 10px 18px;
  border: none;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  font-family: 'Inter', sans-serif;
  color: var(--bento-text-secondary);
  border-bottom: 2px solid transparent;
  margin-bottom: -2px;
  transition: var(--bento-transition);
  white-space: nowrap;
  border-radius: 0;
}
.tab:hover, .tab-btn:hover, .tab-button:hover {
  color: var(--bento-primary);
  background: var(--bento-primary-light);
}
.tab.active, .tab-btn.active, .tab-button.active {
  color: var(--bento-primary);
  border-bottom-color: var(--bento-primary);
  background: rgba(59, 130, 246, 0.04);
  font-weight: 600;
}

/* Tab content */
.tab-content { display: none; }
.tab-content.active { display: block; animation: bentoFadeIn 0.3s ease-out; }
@keyframes bentoFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }

/* Buttons */
button, .btn, .action-btn {
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  font-weight: 500;
  border-radius: var(--bento-radius-xs);
  transition: var(--bento-transition);
  cursor: pointer;
}
button.active, .btn.active, .btn-primary, .action-btn.active {
  background: var(--bento-primary) !important;
  color: white !important;
  border-color: var(--bento-primary) !important;
  box-shadow: 0 2px 8px rgba(59, 130, 246, 0.25);
}

/* Status badges */
.badge, .status-badge, .tag, .chip {
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
  font-family: 'Inter', sans-serif;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.badge-success, .status-ok, .status-good { background: var(--bento-success-light); color: var(--bento-success); }
.badge-error, .status-error, .status-critical { background: var(--bento-error-light); color: var(--bento-error); }
.badge-warning, .status-warning { background: var(--bento-warning-light); color: var(--bento-warning); }
.badge-info, .status-info { background: var(--bento-primary-light); color: var(--bento-primary); }

/* Tables */
table { width: 100%; border-collapse: separate; border-spacing: 0; font-family: 'Inter', sans-serif; }
th { background: var(--bento-bg); color: var(--bento-text-secondary); font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 14px; text-align: left; border-bottom: 2px solid var(--bento-border); }
td { padding: 12px 14px; border-bottom: 1px solid var(--bento-border); color: var(--bento-text); font-size: 13px; }
tr:hover td { background: var(--bento-primary-light); }
tr:last-child td { border-bottom: none; }

/* Inputs & selects */
input, select, textarea {
  font-family: 'Inter', sans-serif;
  font-size: 13px;
  padding: 8px 12px;
  border: 1.5px solid var(--bento-border);
  border-radius: var(--bento-radius-xs);
  background: var(--bento-card);
  color: var(--bento-text);
  transition: var(--bento-transition);
  outline: none;
}
input:focus, select:focus, textarea:focus {
  border-color: var(--bento-primary);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

/* Stat cards */
.stat-card, .stat, .metric-card, .stat-box, .overview-stat, .kpi-card {
  background: var(--bento-card);
  border: 1px solid var(--bento-border);
  border-radius: var(--bento-radius-sm);
  padding: 16px;
  transition: var(--bento-transition);
}
.stat-card:hover, .stat:hover, .metric-card:hover { box-shadow: var(--bento-shadow-md); transform: translateY(-1px); }
.stat-value, .metric-value, .stat-number { font-size: 28px; font-weight: 700; color: var(--bento-text); font-family: 'Inter', sans-serif; }
.stat-label, .metric-label, .stat-title { font-size: 12px; font-weight: 500; color: var(--bento-text-secondary); text-transform: uppercase; letter-spacing: 0.5px; }

/* Canvas override (prevent Bento CSS from distorting charts) */
canvas {
  max-width: 100% !important;
  height: auto !important;
  width: auto !important;
  border: none !important;
}

/* Pagination */
.pagination, .pag {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 8px;
  margin-top: 20px;
  padding: 16px 0;
  border-top: 1px solid var(--bento-border);
}
.pagination-btn, .pag-btn {
  padding: 8px 14px;
  border: 1.5px solid var(--bento-border);
  background: var(--bento-card);
  color: var(--bento-text);
  border-radius: var(--bento-radius-xs);
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  font-family: 'Inter', sans-serif;
  transition: var(--bento-transition);
}
.pagination-btn:hover:not(:disabled), .pag-btn:hover:not(:disabled) { background: var(--bento-primary); color: white; border-color: var(--bento-primary); }
.pagination-btn:disabled, .pag-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.pagination-info, .pag-info { font-size: 13px; color: var(--bento-text-secondary); font-weight: 500; padding: 0 8px; }
.page-size-select { padding: 6px 10px; border: 1.5px solid var(--bento-border); border-radius: var(--bento-radius-xs); font-size: 12px; font-family: 'Inter', sans-serif; }

/* Empty state */
.empty-state, .no-data, .no-results {
  text-align: center;
  padding: 48px 24px;
  color: var(--bento-text-secondary);
  font-size: 14px;
}

/* Scrollbar */
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--bento-border); border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: var(--bento-text-muted); }

/* ===== END BENTO LIGHT MODE ===== */

/* Compact mode styles */
.panel.compact .nav-item { padding: 6px 12px; font-size: 12px; }
.panel.compact .sidebar-header { padding: 14px; font-size: 16px; }
.panel.compact .toolbar { padding: 10px 16px; }
.panel.compact .content { padding: 12px; }
.panel.compact .tool-card { padding: 10px; }
.panel.compact .home-section-title { font-size: 14px; margin-bottom: 8px; }

${HAToolsPanel.CSS}</style>
      <div class="panel ${this._getSetting('compactMode', false) ? 'compact' : ''}">
        <div class="sidebar">
          <div class="sidebar-header">
            <span>\u{1F6E0}\uFE0F</span> HA Tools
            <span class="version">v2.5</span>
          </div>
          <div class="sidebar-scroll">
            <div class="nav-item active" data-view="home">
              <span class="nav-icon">\u{1F3E0}</span>
              <span>Home</span>
              <span class="nav-badge">${available.length}/${HAToolsPanel.TOOLS.length}</span>
            </div>

            <div class="nav-section nav-section-tools">NarzÄ™dzia (${available.length})</div>
            <div class="nav-tools-list">
              ${available.map(t => `
                <div class="nav-item" data-tool="${t.id}" data-tag="${t.tag}">
                  <span class="nav-icon">${t.icon}</span>
                  <span>${t.name}</span>
                </div>
              `).join('')}
            </div>

            <div class="nav-section nav-section-unavailable" ${unavailable.length === 0 ? 'style="display:none"' : ''}>NiedostÄ™pne (${unavailable.length})</div>
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
        <div class="sidebar-overlay" id="sidebarOverlay"></div>
        <div class="main">
          <div class="loading-bar" style="display:none"></div>
          <div class="toolbar">
            <button class="sidebar-toggle" id="sidebarToggle">&#9776;</button><div class="toolbar-title" id="title">\u{1F3E0} Home</div>
            <div class="toolbar-actions" id="toolbarActions" style="display:none">
              <button class="btn-icon" id="refreshBtn" title="OdĹ›wieĹĽ dane">&#x21bb;</button>
              <label class="ar-toggle" title="Auto-odĹ›wieĹĽanie co 30s">
                <input type="checkbox" id="autoRefreshCb">
                <span class="ar-track"><span class="ar-thumb"></span></span>
                <span class="ar-lbl">Auto</span>
              </label>
            </div>
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

    // Sidebar toggle (mobile)
    const sidebarToggle = this.shadowRoot.getElementById('sidebarToggle');
    const sidebar = this.shadowRoot.querySelector('.sidebar');
    const overlay = this.shadowRoot.getElementById('sidebarOverlay');
    if (sidebarToggle) {
      sidebarToggle.addEventListener('click', () => {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('visible');
      });
      overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('visible');
      });
    }

    // Close sidebar on mobile when tool selected
    this.shadowRoot.querySelectorAll('.nav-item').forEach(item => {
      item.addEventListener('click', () => {
        if (window.innerWidth <= 768) {
          sidebar.classList.remove('open');
          overlay.classList.remove('visible');
        }
      });
    });

    // Refresh button
    this.shadowRoot.getElementById('refreshBtn').addEventListener('click', () => {
      if (this._activeView === 'tool' && this._activeToolId) {
        const item = this.shadowRoot.querySelector(`.nav-item[data-tool="${this._activeToolId}"]`);
        if (item) this._loadTool(this._activeToolId, item.dataset.tag);
      }
    });

    // Auto-refresh toggle
    const arCb = this.shadowRoot.getElementById('autoRefreshCb');
    if (arCb) {
      arCb.checked = this._getSetting('autoRefresh', false);
      arCb.addEventListener('change', () => {
        this._setSetting('autoRefresh', arCb.checked);
        if (arCb.checked) this._startAutoRefresh();
        else this._stopAutoRefresh();
      });
    }
  }

  _startAutoRefresh() {
    if (this._autoRefreshTimer) clearInterval(this._autoRefreshTimer);
    this._autoRefreshTimer = setInterval(() => {
      if (this._activeView === 'tool' && this._activeToolId && this._cardInstance) {
        const item = this.shadowRoot.querySelector(`.nav-item[data-tool="${this._activeToolId}"]`);
        if (item) this._loadTool(this._activeToolId, item.dataset.tag);
      }
    }, 30000);
    const cb = this.shadowRoot ? this.shadowRoot.getElementById('autoRefreshCb') : null;
    if (cb) cb.checked = true;
  }

  _stopAutoRefresh() {
    if (this._autoRefreshTimer) { clearInterval(this._autoRefreshTimer); this._autoRefreshTimer = null; }
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
    this.shadowRoot.getElementById('toolbarActions').style.display = 'none'; this._stopAutoRefresh();

    const { available, unavailable } = this._getToolStatus();
    const cats = HAToolsPanel.CATEGORIES;
    const content = this.shadowRoot.getElementById('content');

    content.innerHTML = `
      <div class="home-view">
        <div class="home-section">
          <div class="home-section-title">
            \u2705 Zainstalowane narzÄ™dzia <span class="count">(${available.length} z ${HAToolsPanel.TOOLS.length})</span>
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
                    <span class="tool-card-status">(aktywne)</span>
                  </div>
                </div>
              `).join('')}
            </div>
          ` : '<div style="color:#64748B;font-size:13px;">Brak zainstalowanych narzÄ™dzi.</div>'}
        </div>

        ${unavailable.length > 0 ? `
          <div class="home-section">
            <div class="home-section-title">
              ${this._loading ? '\u23F3' : '\u{1F4E6}'} ${this._loading ? 'Ĺadowanie narzÄ™dzi...' : 'DostÄ™pne do instalacji'} <span class="count">(${unavailable.length})</span>
            </div>
            ${this._loading ? `
              <div class="uninstalled-list">
                ${unavailable.map(t => `
                  <div class="uninstalled-item loading-item">
                    <div class="ui-icon">${t.icon}</div>
                    <div class="ui-name">${t.name}</div>
                    <div class="ui-desc">Ĺadowanie...</div>
                  </div>
                `).join('')}
              </div>
            ` : `
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
            `}
          </div>
        ` : ''}

        <div class="home-section">
          <div class="donate-section">
            <div class="donate-text">
              <h3>\u2764\uFE0F Wesprzyj rozwĂłj HA Tools</h3>
              <p>JeĹ›li HA Tools uĹ‚atwia Ci ĹĽycie z Home Assistant, rozwaĹĽ wsparcie projektu. KaĹĽda kawa motywuje do dalszego rozwoju!</p>
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
    this.shadowRoot.getElementById('toolbarActions').style.display = 'none'; this._stopAutoRefresh();

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
            \u2699\uFE0F Ustawienia ogĂłlne
            <span class="chevron">\u25BC</span>
          </div>
          <div class="settings-group-body" data-body="general">
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">JÄ™zyk</div>
                <div class="setting-desc">JÄ™zyk interfejsu panelu</div>
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
                <div class="setting-label">DomyĹ›lny widok</div>
                <div class="setting-desc">Co pokazaÄ‡ po otwarciu HA Tools</div>
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
                <div class="setting-desc">WĹ‚Ä…cz animacje przejĹ›Ä‡</div>
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
                <div class="setting-desc">Mniejsze odstÄ™py, mniej miejsca na ekranie</div>
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

        <!-- Trace Viewer â€” Backend Settings -->
        <div class="settings-group">
          <div class="settings-group-header" data-group="trace-backend">
            \u{1F9EC} Trace Viewer â€” Przechowywanie
            <span class="chevron">\u25BC</span>
          </div>
          <div class="settings-group-body" data-body="trace-backend">
            <div class="trace-current-info">
              \u{1F4CA} Obecne ustawienie HA: <span class="val">stored_traces = 5</span> (domyĹ›lne per automatyzacja)
            </div>

            <div class="setting-subsection">IloĹ›Ä‡ traces</div>
            <div class="setting-row">
              <div class="setting-info">
                <div class="setting-label">Przechowuj N ostatnich traces</div>
                <div class="setting-desc">Ile trace'Ăłw HA ma przechowywaÄ‡ na automatyzacjÄ™ (domyĹ›lnie 5). Zmiana dotyczy WSZYSTKICH automatyzacji.</div>
              </div>
              <div class="setting-control">
                <select class="setting-select" id="storedTracesCount">
                  <option value="5" ${this._getSetting('trace.storedCount', 20) == 5 ? 'selected' : ''}>5 (domyĹ›lne)</option>
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
                <div class="setting-desc">Ukryj traces starsze niĹĽ wybrany okres (filtrowanie po stronie frontendu, nie usuwa danych z HA)</div>
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
          const isDataExporter = prefix === 'data-exporter';
          const snapEnabled = isDataExporter ? this._getSetting('data-exporter.snapshots.enabled', false) : false;
          const snapInterval = isDataExporter ? this._getSetting('data-exporter.snapshots.interval', 60) : 60;
          const snapMax = isDataExporter ? this._getSetting('data-exporter.snapshots.max', 50) : 50;
          return `
            <div class="settings-group">
              <div class="settings-group-header" data-group="${prefix}">
                ${t.icon} ${t.name}
                <span class="chevron">\u25BC</span>
              </div>
              <div class="settings-group-body" data-body="${prefix}">
                <div class="setting-subsection">Wy\u015Bwietlanie</div>
                <div class="setting-row">
                  <div class="setting-info">
                    <div class="setting-label">Pokazuj w dashboardzie</div>
                    <div class="setting-desc">WidocznoĹ›Ä‡ karty na stronie gĹ‚Ăłwnej</div>
                  </div>
                  <div class="setting-control">
                    <label class="setting-toggle">
                      <input type="checkbox" data-setting="${prefix}.dashboardCard" ${dashboardCard ? 'checked' : ''}>
                      <span class="slider"></span>
                    </label>
                  </div>
                </div>

                <div class="setting-subsection">Dzia\u0142anie</div>
                ${isTraceViewer ? `
                <div class="setting-row">
                  <div class="setting-info">
                    <div class="setting-label">WpisĂłw na stronÄ™</div>
                    <div class="setting-desc">Ile traces/automatyzacji wyĹ›wietlaÄ‡ na jednej stronie</div>
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
                ${isDataExporter ? `
                <div class="setting-subsection">Snapshoty</div>
                <div class="setting-row">
                  <div class="setting-info">
                    <div class="setting-label">Zbieranie snapshot\u00F3w</div>
                    <div class="setting-desc">Automatycznie zapisuj stany encji w localStorage</div>
                  </div>
                  <div class="setting-control">
                    <label class="setting-toggle">
                      <input type="checkbox" data-setting="data-exporter.snapshots.enabled" ${snapEnabled ? 'checked' : ''}>
                      <span class="slider"></span>
                    </label>
                  </div>
                </div>
                <div class="setting-row">
                  <div class="setting-info">
                    <div class="setting-label">Interwa\u0142 zbierania</div>
                    <div class="setting-desc">Co ile sekund zapisywa\u0107 snapshot</div>
                  </div>
                  <div class="setting-control">
                    <select class="setting-select" data-setting="data-exporter.snapshots.interval">
                      <option value="30" ${snapInterval == 30 ? 'selected' : ''}>30s</option>
                      <option value="60" ${snapInterval == 60 ? 'selected' : ''}>1 min</option>
                      <option value="300" ${snapInterval == 300 ? 'selected' : ''}>5 min</option>
                      <option value="900" ${snapInterval == 900 ? 'selected' : ''}>15 min</option>
                      <option value="3600" ${snapInterval == 3600 ? 'selected' : ''}>1h</option>
                    </select>
                  </div>
                </div>
                <div class="setting-row">
                  <div class="setting-info">
                    <div class="setting-label">Maksymalna ilo\u015B\u0107</div>
                    <div class="setting-desc">Ile snapshot\u00F3w przechowywa\u0107 w localStorage</div>
                  </div>
                  <div class="setting-control">
                    <select class="setting-select" data-setting="data-exporter.snapshots.max">
                      <option value="20" ${snapMax == 20 ? 'selected' : ''}>20</option>
                      <option value="50" ${snapMax == 50 ? 'selected' : ''}>50</option>
                      <option value="100" ${snapMax == 100 ? 'selected' : ''}>100</option>
                      <option value="200" ${snapMax == 200 ? 'selected' : ''}>200</option>
                    </select>
                  </div>
                </div>
                ` : ''}
                <div class="setting-subsection">Dzia\u0142anie</div>
                <div class="setting-row">
                  <div class="setting-info">
                    <div class="setting-label">Interwa\u0142 od\u015Bwie\u017Cania (sek)</div>
                    <div class="setting-desc">Jak cz\u0119sto od\u015Bwie\u017Ca\u0107 dane</div>
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
                    <div class="setting-desc">PokaĹĽ powiadomienia z tego narzÄ™dzia</div>
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

    // Trace storage â€” Apply button
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
      statusEl.textContent = '\u274C Brak poĹ‚Ä…czenia z Home Assistant';
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
        `<small style="opacity:0.8">\u{1F4DD} Ustaw <code>stored_traces: ${count}</code> w configuration.yaml pod sekcjÄ… <code>automation:</code> â€” API nie obsĹ‚uguje tego pola per-automatyzacja.</small>`;
      statusEl.className = 'status-msg visible success';
    } catch (e) {
      statusEl.textContent = `\u274C BĹ‚Ä…d: ${e.message}`;
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
    this.shadowRoot.getElementById('toolbarActions').style.display = '';
    // Sync auto-refresh checkbox with setting
    const arCb = this.shadowRoot.getElementById('autoRefreshCb');
    if (arCb) arCb.checked = this._getSetting('autoRefresh', false);

    const content = this.shadowRoot.getElementById('content');
    content.innerHTML = `<div class="empty"><div class="big">\u23F3</div><div>Ĺadowanie...</div></div>`;

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
        content.innerHTML = `<div class="empty"><div class="big">\u26A0\uFE0F</div><div>BĹ‚Ä…d: ${e.message}</div></div>`;
      }
    }, 150);
  }
}

if (!customElements.get('ha-tools-panel')) { customElements.define('ha-tools-panel', HAToolsPanel); }
// HA Tools Panel registered

