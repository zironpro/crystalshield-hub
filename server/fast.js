// Faster page loads: serve the app's text files (JS, CSS, HTML, SVG) compressed (brotli / gzip, cached in
// memory per file version), answer "not changed" (304) by ETag, and add <link rel="modulepreload"> for every
// script to the page so the browser fetches all of them at once instead of discovering them level by level.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const TYPES = {
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
};

function listJs(dir, base) {
  const out = [];
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) out.push(...listJs(p, `${base}/${f.name}`));
    else if (f.name.endsWith('.js')) out.push(`${base}/${f.name}`);
  }
  return out;
}

// mounts: [{ prefix: '/vendor/preact', dir, cache: 'public, max-age=86400' }] — first match wins
function compressedStatic(mounts, { preload = [] } = {}) {
  const cache = new Map(); // file → { mtime, etag, raw, gz, br }
  const links = preload.map((href) => `<link rel="modulepreload" href="${href}" />`).join('\n  ');
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path === '/sw.js' || req.path.startsWith('/api/')) return next(); // service worker has its own headers
    const m = mounts.find((x) => req.path === x.prefix || req.path.startsWith(x.prefix === '/' ? '/' : `${x.prefix}/`));
    if (!m) return next();
    let rel = m.prefix === '/' ? req.path : req.path.slice(m.prefix.length);
    if (!rel || rel.endsWith('/')) rel += 'index.html';
    let file;
    try { file = path.join(m.dir, decodeURIComponent(rel)); } catch { return next(); }
    if (!file.startsWith(m.dir)) return next();
    const ext = path.extname(file);
    if (!TYPES[ext]) return next();
    let st;
    try { st = fs.statSync(file); } catch { return next(); }
    if (!st.isFile()) return next();
    let entry = cache.get(file);
    if (!entry || entry.mtime !== st.mtimeMs) {
      let raw = fs.readFileSync(file);
      if (ext === '.html' && links && /index\.html$/.test(file)) raw = Buffer.from(raw.toString('utf8').replace('</head>', `  ${links}\n</head>`));
      entry = {
        mtime: st.mtimeMs, raw, etag: `W/"${raw.length.toString(16)}-${Math.round(st.mtimeMs).toString(16)}"`,
        br: raw.length > 1024 ? zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9 } }) : null,
        gz: raw.length > 1024 ? zlib.gzipSync(raw, { level: 9 }) : null,
      };
      cache.set(file, entry);
    }
    res.setHeader('Content-Type', TYPES[ext]);
    res.setHeader('Cache-Control', m.cache);
    res.setHeader('ETag', entry.etag);
    res.setHeader('Vary', 'Accept-Encoding');
    if (req.headers['if-none-match'] === entry.etag) return res.status(304).end();
    const accept = String(req.headers['accept-encoding'] || '');
    let body = entry.raw;
    if (entry.br && /\bbr\b/.test(accept)) { body = entry.br; res.setHeader('Content-Encoding', 'br'); }
    else if (entry.gz && /\bgzip\b/.test(accept)) { body = entry.gz; res.setHeader('Content-Encoding', 'gzip'); }
    res.setHeader('Content-Length', body.length);
    return req.method === 'HEAD' ? res.end() : res.end(body);
  };
}

module.exports = { compressedStatic, listJs };
