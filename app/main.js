/**
 * WAF Signage — appli Linux (Electron) pour le PC des écrans du club.
 *
 * Une fenêtre plein écran par écran branché (rangés de gauche à droite :
 * Écran 1, Écran 2…). Chaque fenêtre suit le même parcours que l'appli
 * Android : animation de lancement → écran déjà configuré (compte à rebours)
 * ou configuration (code d'association player/pair.php, ou écran existant)
 * → affichage /player/?screen=<slug>.
 *
 * Raccourcis clavier :
 *   F1 ou Ctrl+M      menu de l'écran sous la souris
 *   Ctrl+Alt+R        tout recharger
 *   Ctrl+Alt+Q        quitter
 * Souris : 5 clics dans le coin haut-gauche d'un écran → menu.
 */
const { app, BrowserWindow, screen, ipcMain, powerSaveBlocker, net, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');

const BASE = 'https://signage.waf-forme.fr';
const BOOT = path.join(__dirname, 'boot.html');

// ── Lecture vidéo sans clic, pas de traduction, GPU même sur vieux PC ──
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
app.commandLine.appendSwitch('disable-features', 'Translate,MediaSessionService');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('disable-pinch');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// ── Configuration (un écran WAF par sortie vidéo) ──
const CFG = () => path.join(app.getPath('userData'), 'config.json');
function loadCfg() { try { return JSON.parse(fs.readFileSync(CFG(), 'utf8')); } catch (e) { return { screens: {} }; } }
function saveCfg(c) { try { fs.mkdirSync(path.dirname(CFG()), { recursive: true }); fs.writeFileSync(CFG(), JSON.stringify(c, null, 2)); } catch (e) {} }
let cfg = { screens: {} };

// ── Démarrage automatique à l'ouverture de session ──
const AUTOSTART = path.join(os.homedir(), '.config', 'autostart', 'waf-signage.desktop');
function execPath() { return process.env.APPIMAGE || process.execPath; }
function autostartOk() { try { return fs.readFileSync(AUTOSTART, 'utf8').includes(execPath()); } catch (e) { return false; } }
function enableAutostart() {
  try {
    fs.mkdirSync(path.dirname(AUTOSTART), { recursive: true });
    fs.writeFileSync(AUTOSTART, [
      '[Desktop Entry]', 'Type=Application', 'Name=WAF Signage',
      'Comment=Affichage des écrans WAF Forme',
      `Exec="${execPath()}" --autostart`,
      'X-GNOME-Autostart-enabled=true', 'X-GNOME-Autostart-Delay=5', 'Terminal=false', ''
    ].join('\n'));
    return true;
  } catch (e) { return false; }
}

// ── Écran jamais en veille ──
function keepAwake() {
  powerSaveBlocker.start('prevent-display-sleep');
  for (const args of [['s', 'off'], ['-dpms'], ['s', 'noblank']]) execFile('xset', args, () => {});
}

// ── Fenêtres ──
const wins = new Map(); // key "ecran-1" → { win, key, num, mode: 'boot'|'pair'|'player' }

function sortedDisplays() {
  return screen.getAllDisplays().slice().sort((a, b) => a.bounds.x - b.bounds.x || a.bounds.y - b.bounds.y);
}

function buildWindows() {
  const displays = sortedDisplays();
  const keep = new Set();
  displays.forEach((d, i) => {
    const key = 'ecran-' + (i + 1);
    keep.add(key);
    let w = wins.get(key);
    if (w && !w.win.isDestroyed()) {
      w.win.setBounds(d.bounds);
      w.win.setFullScreen(true);
      return;
    }
    const win = new BrowserWindow({
      x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
      fullscreen: true, frame: false, kiosk: false, autoHideMenuBar: true,
      backgroundColor: '#0d0b0b', show: false, skipTaskbar: true,
      title: 'WAF Signage — Écran ' + (i + 1),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: false,
        backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required',
        additionalArguments: ['--waf-screen=' + key, '--waf-num=' + (i + 1), '--waf-size=' + d.size.width + 'x' + d.size.height]
      }
    });
    // Signature de l'appli (l'admin Monitoring affiche « PC Linux · appli x.y.z »)
    win.webContents.setUserAgent(win.webContents.getUserAgent() + ' WAFSignageApp/linux-' + app.getVersion());
    w = { win, key, num: i + 1, mode: 'boot', clicks: 0, firstClick: 0 };
    wins.set(key, w);
    wire(w);
    win.once('ready-to-show', () => { win.setBounds(d.bounds); win.setFullScreen(true); win.show(); });
    loadBoot(w, process.argv.includes('--autostart') ? '#boot' : '');
  });
  for (const [key, w] of wins) {
    if (!keep.has(key)) { try { w.win.destroy(); } catch (e) {} wins.delete(key); }
  }
}

function loadBoot(w, hash) {
  w.mode = 'boot';
  sleepState.set(w.key, false);
  if (typeof applyScreenPower === 'function') setImmediate(applyScreenPower);
  w.win.loadFile(BOOT, { hash: (hash || '').replace(/^#/, '') });
}
function openPlayer(w) {
  const s = (cfg.screens[w.key] || {}).slug;
  if (!s) return loadBoot(w, '');
  w.mode = 'player';
  w.win.loadURL(BASE + '/player/?screen=' + encodeURIComponent(s) + '&app=linux-' + app.getVersion());
}
function openPairing(w) {
  w.mode = 'pair';
  w.win.loadURL(BASE + '/player/pair.php');
}

// Appairage : pair.php se redirige vers /player/?screen=<slug> une fois le code saisi dans l'admin
function catchPaired(w, url) {
  if (w.mode !== 'pair' || !url || !url.startsWith(BASE + '/player/')) return false;
  let slug = null;
  try { slug = new URL(url).searchParams.get('screen'); } catch (e) {}
  if (!slug) return false;
  cfg.screens[w.key] = { slug, label: '' };
  saveCfg(cfg);
  setImmediate(() => loadBoot(w, '#paired'));
  return true;
}

function wire(w) {
  const wc = w.win.webContents;
  wc.on('will-navigate', (e, url) => { if (catchPaired(w, url)) e.preventDefault(); });
  wc.on('did-start-navigation', (e, url, inPlace, isMain) => { if (isMain) catchPaired(w, url); });
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));

  wc.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;           // -3 = navigation annulée (normal)
    if (w.mode === 'player' || w.mode === 'pair') loadBoot(w, '#offline');
  });
  wc.on('render-process-gone', () => setTimeout(() => { if (!w.win.isDestroyed()) { w.mode === 'player' ? openPlayer(w) : loadBoot(w, ''); } }, 1500));
  wc.on('unresponsive', () => { if (!w.win.isDestroyed()) wc.reload(); });

  // Pas de curseur de souris sur l'affichage
  wc.on('did-finish-load', () => {
    if (w.mode === 'player') wc.insertCSS('*{cursor:none!important}').catch(() => {});
  });

  // Clavier : menu / recharger / quitter
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const k = (input.key || '').toLowerCase();
    if (input.control && input.alt && k === 'q') { e.preventDefault(); app.exit(0); }
    else if (input.control && input.alt && k === 'r') { e.preventDefault(); for (const x of wins.values()) x.mode === 'player' ? openPlayer(x) : loadBoot(x, ''); }
    else if ((k === 'f1' || (input.control && k === 'm')) && w.mode !== 'boot') { e.preventDefault(); loadBoot(w, '#menu'); }
    else if (k === 'escape' && w.mode === 'pair') { e.preventDefault(); loadBoot(w, '#setup'); }
    else if (k === 'f11' || k === 'f12' || (input.control && input.shift && k === 'i')) e.preventDefault();
  });
}

// Souris : 5 clics dans le coin haut-gauche → menu (le preload remonte les clics)
ipcMain.on('waf:corner-click', (e) => {
  const w = byEvent(e); if (!w || w.mode === 'boot') return;
  const now = Date.now();
  if (now - w.firstClick > 3000) { w.firstClick = now; w.clicks = 0; }
  if (++w.clicks >= 5) { w.clicks = 0; loadBoot(w, '#menu'); }
});

function byEvent(e) {
  for (const w of wins.values()) if (!w.win.isDestroyed() && w.win.webContents === e.sender) return w;
  return null;
}

// ── Veille réelle : quand TOUS les écrans sont en mode veille (club fermé),
// on coupe le signal vidéo (DPMS) → les moniteurs passent en économie d'énergie.
// Rallumage automatique dès qu'un écran sort de veille. ──
const sleepState = new Map();
let screensOff = false;
function applyScreenPower() {
  const all = [...wins.values()].filter(w => !w.win.isDestroyed());
  const allSleeping = all.length > 0 && all.every(w => w.mode === 'player' && sleepState.get(w.key) === true);
  if (allSleeping && !screensOff) {
    screensOff = true;
    execFile('xset', ['+dpms'], () => execFile('xset', ['dpms', 'force', 'off'], () => {}));
  } else if (!allSleeping && screensOff) {
    screensOff = false;
    execFile('xset', ['dpms', 'force', 'on'], () => keepAwake());
  }
}
ipcMain.on('waf:sleep', (e, sleeping) => {
  const w = byEvent(e); if (!w) return;
  sleepState.set(w.key, !!sleeping);
  applyScreenPower();
});
// Certains écrans se rallument seuls : on ré-applique toutes les 10 min
setInterval(() => { if (screensOff) execFile('xset', ['dpms', 'force', 'off'], () => {}); }, 10 * 60 * 1000);

// ── Pont « WafApp » (même API que l'appli Android) ──
ipcMain.on('waf:sync', (e, fn, a, b) => {
  const w = byEvent(e);
  const sc = w ? (cfg.screens[w.key] || {}) : {};
  let r = null;
  switch (fn) {
    case 'baseUrl': r = BASE; break;
    case 'version': r = app.getVersion() + ' (Linux)'; break;
    case 'device': r = os.hostname() + ' · ' + (w ? 'Écran ' + w.num : '') + ' · ' + os.type() + ' ' + os.release(); break;
    case 'slug': r = sc.slug || ''; break;
    case 'label': r = sc.label || ''; break;
    case 'online': r = true; break;
    case 'autostartOk': r = autostartOk(); break;
    case 'isLauncher': r = true; break;
    case 'screenName': r = w ? 'Écran ' + w.num : ''; break;
    case 'updateInfo': r = JSON.stringify({ current: app.getVersion(), latest: latest.version || '',
                          newer: !!latest.version && cmpVer(latest.version, app.getVersion()) > 0,
                          auto: 'installation automatique chaque nuit' }); break;
    case 'setScreen': if (w) { cfg.screens[w.key] = { slug: a || '', label: b || '' }; saveCfg(cfg); } break;
    case 'clearScreen': if (w) { delete cfg.screens[w.key]; saveCfg(cfg); } break;
  }
  e.returnValue = r;
});
ipcMain.on('waf:do', (e, fn) => {
  const w = byEvent(e); if (!w) return;
  if (fn === 'start') openPlayer(w);
  else if (fn === 'pair') openPairing(w);
  else if (fn === 'restart') { w.win.webContents.session.clearCache().finally(() => openPlayer(w)); }
  else if (fn === 'openAutostart') { enableAutostart(); w.win.webContents.executeJavaScript('window.refreshChecks&&refreshChecks()').catch(() => {}); }
  else if (fn === 'checkUpdate') {
    // Le .deb installe un déclencheur systemd (waf-signage-update.path) : écrire
    // ce fichier lance tout de suite la mise à jour en root ; l'avancement est lu
    // dans /var/lib/waf-signage/status et affiché dans le menu.
    const send = (state, detail) => { if (!w.win.isDestroyed()) w.win.webContents.executeJavaScript('window.onUpdateState&&onUpdateState(' + JSON.stringify(state) + ',' + JSON.stringify(detail || '') + ')').catch(() => {}); };
    const t0 = Math.floor(Date.now() / 1000);
    try {
      fs.writeFileSync('/var/lib/waf-signage/request', String(Date.now()));
    } catch (err) {
      // Appli lancée hors .deb (test) : simple information
      fetchLatest().then(() => {
        const newer = latest.version && cmpVer(latest.version, app.getVersion()) > 0;
        send(newer ? 'linuxnight' : (latest.version ? 'uptodate' : 'none'), newer ? latest.version : app.getVersion());
      });
      return;
    }
    send('check', '');
    let n = 0;
    const timer = setInterval(() => {
      n++;
      let st = '';
      try { st = fs.readFileSync('/var/lib/waf-signage/status', 'utf8').trim(); } catch (e) {}
      const parts = st.split('|');
      if (+parts[0] >= t0 - 1 && parts[1]) {
        send(parts[1], parts.slice(2).join('|'));
        if (['uptodate', 'none', 'error', 'installed'].includes(parts[1])) {
          clearInterval(timer);
          if (parts[1] === 'installed') setTimeout(watchInstalledVersion, 3000);
        }
      }
      if (n > 150) { clearInterval(timer); send('error', 'pas de réponse du service de mise à jour'); }
    }, 2000);
  }
  else if (fn === 'openSettings') execFile('cinnamon-settings', [], (err) => { if (err) execFile('gnome-control-center', [], () => {}); });
});
// Requêtes HTTP par l'appli (pas de CORS / file://)
ipcMain.on('waf:http', async (e, id, url) => {
  const w = byEvent(e); if (!w) return;
  let code = 0, body = '';
  try {
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
    const r = await net.fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'WAFSignageApp/linux-' + app.getVersion() } });
    clearTimeout(t);
    code = r.status; body = await r.text();
  } catch (err) { code = 0; body = String(err && err.message || err); }
  if (!w.win.isDestroyed()) w.win.webContents.executeJavaScript('window.__http&&__http(' + JSON.stringify(id) + ',' + code + ',' + JSON.stringify(body) + ')').catch(() => {});
});

// ── Mises à jour ──
// L'installation est faite chaque nuit par le minuteur système
// waf-signage-update.timer (root, installé avec le .deb). L'appli se contente
// de redémarrer quand la version installée a changé.
let latest = {};
function cmpVer(a, b) {
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); }
  return 0;
}
async function fetchLatest() {
  try {
    const r = await net.fetch(BASE + '/api/app-version.php?platform=linux');
    const j = await r.json();
    if (j && j.success) latest = j.data || {};
  } catch (e) {}
}
function watchInstalledVersion() {
  if (!app.isPackaged || !process.execPath.startsWith('/opt/')) return;   // seulement l'appli installée (.deb)
  execFile('dpkg-query', ['-W', '-f=${Version}', 'waf-signage'], (err, out) => {
    const v = String(out || '').trim();
    if (!err && v && v !== app.getVersion()) { app.relaunch(); app.exit(0); }
  });
}

// ── Lancement ──
app.whenReady().then(() => {
  // Signature de l'appli pour toute la session (y compris le service worker du player)
  session.defaultSession.setUserAgent(session.defaultSession.getUserAgent() + ' WAFSignageApp/linux-' + app.getVersion());
  cfg = loadCfg();
  if (!cfg.autostartAsked) { enableAutostart(); cfg.autostartAsked = true; saveCfg(cfg); }
  keepAwake();
  buildWindows();
  fetchLatest();
  setInterval(fetchLatest, 6 * 3600 * 1000);
  setInterval(watchInstalledVersion, 5 * 60 * 1000);
  let t = null;
  const rebuild = () => { clearTimeout(t); t = setTimeout(buildWindows, 1500); };
  screen.on('display-added', rebuild);
  screen.on('display-removed', rebuild);
  screen.on('display-metrics-changed', rebuild);
});
app.on('second-instance', () => { for (const w of wins.values()) if (!w.win.isDestroyed()) w.win.show(); });
app.on('window-all-closed', () => {}); // on ne quitte jamais tout seul
