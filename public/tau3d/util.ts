// @ts-nocheck - TODO(types): remove once this module is typed


/* ============================================================ utils */
export const TAU = Math.PI * 2;
export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const hash = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
export const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a < 0 ? 0 : a > 1 ? 1 : a})`;
export const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const ease = (t) => t * t * (3 - 2 * t);
export const lin = (c, k = 1) => c.map((v) => Math.pow(clamp(v, 0, 255) / 255, 2.2) * k); // sRGB 0-255 -> linear (x intensity)
export const fmtTok = (n) => { n = +n || 0; return n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)); };
export const fmtWords = (n) => { n = +n || 0; return n >= 1e9 ? (n / 1e9).toFixed(2) + ' billion' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' million' : n >= 1e3 ? (n / 1e3).toFixed(1) + ' thousand' : String(Math.round(n)); };
export const fmtCost = (n) => { n = +n || 0; return n >= 1000 ? '$' + (n / 1000).toFixed(2) + 'K' : '$' + n.toFixed(2); };
export const fmtDur = (ms) => { const m = Math.round((ms || 0) / 60000); return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm'; };
export const base = (p) => String(p || '').split('/').filter(Boolean).pop() || '/';
export const trunc = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
export const ago = (iso) => { const s = (Date.now() - new Date(iso).getTime()) / 1000; return s < 90 ? Math.round(s) + 's ago' : s < 5400 ? Math.round(s / 60) + 'm ago' : s < 129600 ? Math.round(s / 3600) + 'h ago' : Math.round(s / 86400) + 'd ago'; };
export const shortModel = (m) => String(m || '').replace(/^claude-/, '');
