/**
 * WAF Signage (Linux) — copie locale des vidéos de la playlist.
 *
 * Les vidéos de la bibliothèque (/media/…, /videos/…) sont téléchargées une
 * fois dans le dossier de l'appli ; ensuite le lecteur les lit directement
 * depuis le disque (adresse wafcache://…) → démarrage instantané, pas de
 * saccade liée au réseau, et lecture même si internet coupe.
 *
 * Limites : 300 Mo par vidéo, 2 Go au total (les moins récemment jouées
 * sont effacées d'abord). Une copie de plus de 3 jours est re-téléchargée.
 */
const { app, protocol, net } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_FILE = 300 * 1024 * 1024;
const MAX_TOTAL = 2 * 1024 * 1024 * 1024;
const MAX_AGE = 3 * 24 * 3600 * 1000;
const EXT = /\.(mp4|m4v|webm|mov)$/i;

let DIR = null;
const pending = new Set();
const queue = [];
let busy = false;

function dir() {
  if (!DIR) { DIR = path.join(app.getPath('userData'), 'videocache'); fs.mkdirSync(DIR, { recursive: true }); }
  return DIR;
}
function clean(url) { return String(url).split('#')[0].split('?')[0]; }
function key(url) {
  const u = clean(url);
  const ext = (u.match(EXT) || ['.mp4'])[0].toLowerCase();
  return crypto.createHash('sha1').update(u).digest('hex') + ext;
}
function fileFor(url) { return path.join(dir(), key(url)); }

/** Chemin local si la vidéo est déjà copiée, sinon null. */
function cached(url) {
  const f = fileFor(url);
  try {
    const st = fs.statSync(f);
    if (!st.size) return null;
    if (Date.now() - st.mtimeMs > MAX_AGE) prefetch(url, true);
    else fs.utimesSync(f, new Date(), new Date()); // « récemment jouée »
    return f;
  } catch (e) { return null; }
}

/** Copie en arrière-plan (une vidéo à la fois). */
function prefetch(url, refresh) {
  if (!url || !/^https?:/i.test(url) || !EXT.test(clean(url))) return;
  const f = fileFor(url);
  if (!refresh && fs.existsSync(f)) return;
  if (pending.has(url)) return;
  pending.add(url);
  queue.push(url);
  pump();
}

async function pump() {
  if (busy) return;
  busy = true;
  while (queue.length) {
    const url = queue.shift();
    const f = fileFor(url), part = f + '.part';
    try {
      const res = await net.fetch(url, { bypassCustomProtocolHandlers: true });
      const len = parseInt(res.headers.get('content-length') || '0', 10);
      if (res.status === 200 && !(len && len > MAX_FILE)) {
        trim(len);
        const out = fs.createWriteStream(part);
        let total = 0, tooBig = false;
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > MAX_FILE) { tooBig = true; try { await reader.cancel(); } catch (e) {} break; }
          if (!out.write(Buffer.from(value))) await new Promise(r => out.once('drain', r));
        }
        await new Promise(r => out.end(r));
        if (!tooBig && total > 0 && (!len || total === len)) fs.renameSync(part, f);
      }
    } catch (e) { /* réseau indisponible : on réessaiera au prochain passage */ }
    try { fs.unlinkSync(part); } catch (e) {}
    pending.delete(url);
  }
  busy = false;
}

function trim(incoming) {
  let files;
  try { files = fs.readdirSync(dir()).filter(n => EXT.test(n)).map(n => { const p = path.join(dir(), n); const st = fs.statSync(p); return { p, size: st.size, t: st.mtimeMs }; }); }
  catch (e) { return; }
  let total = (incoming || 0) + files.reduce((a, f) => a + f.size, 0);
  if (total <= MAX_TOTAL) return;
  files.sort((a, b) => a.t - b.t);
  for (const f of files) { if (total <= MAX_TOTAL) break; try { fs.unlinkSync(f.p); total -= f.size; } catch (e) {} }
}

const MIME = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime' };

/** Réponse (avec gestion des morceaux « Range » demandés par le lecteur). */
function serve(request) {
  const name = path.basename(new URL(request.url).pathname);
  const f = path.join(dir(), name);
  let st;
  try { st = fs.statSync(f); } catch (e) { return new Response('', { status: 404 }); }
  const size = st.size;
  const type = MIME[path.extname(f).toLowerCase()] || 'video/mp4';
  const range = request.headers.get('range');
  let start = 0, end = size - 1, status = 200;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (m) {
      if (m[1] === '' && m[2] !== '') { start = Math.max(0, size - parseInt(m[2], 10)); }
      else { start = m[1] ? parseInt(m[1], 10) : 0; if (m[2]) end = Math.min(parseInt(m[2], 10), size - 1); }
      if (start >= size) return new Response('', { status: 416, headers: { 'Content-Range': 'bytes */' + size } });
      status = 206;
    }
  }
  const { Readable } = require('stream');
  const body = Readable.toWeb(fs.createReadStream(f, { start, end }));
  const headers = { 'Content-Type': type, 'Content-Length': String(end - start + 1), 'Accept-Ranges': 'bytes', 'Access-Control-Allow-Origin': '*' };
  if (status === 206) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + size;
  return new Response(body, { status, headers });
}

/** À appeler AVANT app.whenReady(). */
function registerScheme() {
  protocol.registerSchemesAsPrivileged([{ scheme: 'wafcache', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true } }]);
}

/** À appeler une fois l'appli prête : redirige les vidéos déjà copiées vers le disque. */
function install(ses, base) {
  ses.protocol.handle('wafcache', serve);
  const filter = { urls: [base + '/media/*', base + '/videos/*'] };
  ses.webRequest.onBeforeRequest(filter, (d, cb) => {
    if (!EXT.test(clean(d.url))) return cb({});
    const f = cached(d.url);
    if (f) return cb({ redirectURL: 'wafcache://v/' + path.basename(f) });
    prefetch(d.url);
    cb({});
  });
}

module.exports = { registerScheme, install, prefetch };
