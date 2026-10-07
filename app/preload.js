// Expose window.WafApp — même API que l'appli Android, utilisée par boot.html
const { contextBridge, ipcRenderer } = require('electron');
const s = (fn, a, b) => ipcRenderer.sendSync('waf:sync', fn, a, b);
const d = (fn) => ipcRenderer.send('waf:do', fn);

contextBridge.exposeInMainWorld('WafApp', {
  platform: () => 'linux',
  baseUrl: () => s('baseUrl'),
  version: () => s('version'),
  device: () => s('device'),
  screenName: () => s('screenName'),
  slug: () => s('slug'),
  label: () => s('label'),
  setScreen: (slug, label) => s('setScreen', slug, label),
  clearScreen: () => s('clearScreen'),
  online: () => navigator.onLine,
  autostartOk: () => s('autostartOk'),
  isLauncher: () => true,
  start: () => d('start'),
  pair: () => d('pair'),
  restart: () => d('restart'),
  openAutostart: () => d('openAutostart'),
  openLauncherSettings: () => {},
  openSettings: () => d('openSettings'),
  http: (id, url) => ipcRenderer.send('waf:http', id, url)
});

// Clics dans le coin haut-gauche (sur l'affichage) → menu
window.addEventListener('mousedown', (e) => {
  if (e.clientX < 140 && e.clientY < 140) ipcRenderer.send('waf:corner-click');
}, true);
