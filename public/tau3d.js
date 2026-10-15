// TAU 3D - Three.js visualisation of the Claude usage data (standalone, same API as the stats dashboard).
// Sections: utils - palettes - data layer - issues - state - three setup - shaders - scene - per-frame - labels - HUD/voice/panels - input - main loop.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ============================================================ utils */
const TAU = Math.PI * 2;
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const $ = (id) => document.getElementById(id);
const hash = (i, j) => { const s = Math.sin(i * 127.1 + j * 311.7) * 43758.5453; return s - Math.floor(s); };
const rgba = (c, a) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a < 0 ? 0 : a > 1 ? 1 : a})`;
const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const ease = (t) => t * t * (3 - 2 * t);
const lin = (c, k = 1) => c.map((v) => Math.pow(clamp(v, 0, 255) / 255, 2.2) * k); // sRGB 0-255 -> linear (x intensity)
const fmtTok = (n) => { n = +n || 0; return n >= 1e9 ? (n / 1e9).toFixed(2) + 'B' : n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n)); };
const fmtWords = (n) => { n = +n || 0; return n >= 1e9 ? (n / 1e9).toFixed(2) + ' billion' : n >= 1e6 ? (n / 1e6).toFixed(1) + ' million' : n >= 1e3 ? (n / 1e3).toFixed(1) + ' thousand' : String(Math.round(n)); };
const fmtCost = (n) => { n = +n || 0; return n >= 1000 ? '$' + (n / 1000).toFixed(2) + 'K' : '$' + n.toFixed(2); };
const fmtDur = (ms) => { const m = Math.round((ms || 0) / 60000); return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + 'm'; };
const base = (p) => String(p || '').split('/').filter(Boolean).pop() || '/';
const trunc = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const ago = (iso) => { const s = (Date.now() - new Date(iso).getTime()) / 1000; return s < 90 ? Math.round(s) + 's ago' : s < 5400 ? Math.round(s / 60) + 'm ago' : s < 129600 ? Math.round(s / 3600) + 'h ago' : Math.round(s / 86400) + 'd ago'; };
const shortModel = (m) => String(m || '').replace(/^claude-/, '');

/* ============================================================ palettes + model identity */
const PALETTES = [
  { name: 'TAU', frame: [255, 42, 30], core: [255, 150, 40], hot: [255, 228, 160], dim: [255, 84, 36], bgBase: [0.052, 0.032, 0.026], bgVein: [0.95, 0.52, 0.14], lift: [0, 0, 0], grain: 0 },
  { name: 'ICE', frame: [40, 210, 255], core: [100, 220, 255], hot: [225, 250, 255], dim: [40, 120, 255], bgBase: [0.026, 0.040, 0.052], bgVein: [0.55, 0.85, 1.0], lift: [0, 0, 0], grain: 0 },
  { name: 'VIOLET', frame: [170, 70, 255], core: [220, 130, 255], hot: [248, 225, 255], dim: [120, 60, 255], bgBase: [0.040, 0.028, 0.060], bgVein: [0.80, 0.55, 1.0], lift: [0, 0, 0], grain: 0 },
  // NAVY: film look - dark navy marble, pale bluish veins, grainy grey floor, cool grade; core stays warm, triangle stays red neon
  { name: 'NAVY', frame: [255, 42, 30], core: [255, 150, 40], hot: [255, 228, 160], dim: [255, 84, 36], bgBase: [0.011, 0.030, 0.105], bgVein: [0.72, 0.86, 1.0], lift: [0.004, 0.014, 0.042], grain: 1 },
];
const palIndexOf = (v) => { if (v == null) return 0; const i = PALETTES.findIndex((q) => q.name.toLowerCase() === String(v).toLowerCase()); return i >= 0 ? i : clamp(parseInt(v, 10) || 0, 0, PALETTES.length - 1); };
const PAL_KEYS = ['frame', 'core', 'hot', 'dim', 'bgBase', 'bgVein', 'lift'];
let palIdx = 0;
const pal = JSON.parse(JSON.stringify(PALETTES[0]));
const FAMILY = { fable: [255, 90, 200], opus: [255, 80, 50], sonnet: [255, 190, 55], haiku: [110, 225, 255], other: [200, 190, 170] };
const famOf = (m) => { m = String(m || '').toLowerCase(); for (const k of ['fable', 'opus', 'sonnet', 'haiku']) if (m.includes(k)) return k; return 'other'; };
const modelColorCache = new Map(); const famSeen = {};
function modelColor(m) {
  if (!modelColorCache.has(m)) { const f = famOf(m); const n = famSeen[f] = (famSeen[f] || 0) + 1; modelColorCache.set(m, n === 1 ? FAMILY[f] : mix(FAMILY[f], n % 2 ? [255, 255, 255] : [60, 30, 20], 0.35)); }
  return modelColorCache.get(m);
}

/* ============================================================ data layer */
const params = new URLSearchParams(location.search);
const demo = params.get('demo') === 'issues', demo2 = params.get('demo') === 'waiting';
const api = { async get(url) { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); } };
const data = { summary: null, sessions: [], series: null, series7: null, history: [], lastOk: 0, lost: false };
let refreshMs = 5000;

function buildSeries(ts) {
  if (!ts || !ts.points) return null;
  const n = ts.points.length, models = ts.models || []; const vals = models.map(() => new Float32Array(n)); const cost = models.map(() => new Float32Array(n));
  const calls = new Float32Array(n); const total = new Float32Array(n);
  ts.points.forEach((p, i) => { for (let k = 0; k < models.length; k++) { const m = p.perModel && p.perModel[models[k]]; if (!m) continue; const t = (m.input || 0) + (m.cw5 || 0) + (m.cw1 || 0) + (m.cr || 0) + (m.out || 0) + (m.think || 0); vals[k][i] = t; cost[k][i] = m.cost || 0; total[i] += t; calls[i] += m.calls || 0; } });
  let max = 1; for (let i = 0; i < n; i++) if (total[i] > max) max = total[i];
  return { n, t0: n ? ts.points[0].t : 0, bucketMs: ts.bucketMs, models, vals, cost, calls, total, max };
}

// last 12 local hours as stripes on a 12h dial: [{pos, hour, calls, cost, k}] (k = hours ago)
function clockHours() {
  const sr = data.series7, out = []; const t0h = new Date(); t0h.setMinutes(0, 0, 0); const cur = t0h.getTime();
  for (let k = 0; k < 12; k++) { const t = cur - k * 3600e3, hour = new Date(t).getHours(); let calls = 0, cost = 0;
    if (sr && sr.bucketMs === 3600e3) { const i = Math.round((t - sr.t0) / sr.bucketMs); if (i >= 0 && i < sr.n) { calls = sr.calls[i]; for (let m = 0; m < sr.models.length; m++) cost += sr.cost[m][i]; } }
    out.push({ pos: hour % 12, hour, calls, cost, k }); }
  return out;
}
async function refresh(reason) {
  const jobs = [api.get('/api/summary'), api.get('/api/sessions?limit=16&sort=last'), api.get('/api/timeseries?window=today&bucket=5m&scope=all'), api.get('/api/history?limit=5'), api.get('/api/timeseries?window=7d&bucket=1h&scope=all')];
  const res = await Promise.allSettled(jobs);
  const prev = data.summary; let ok = 0;
  if (res[0].status === 'fulfilled') { data.summary = res[0].value; refreshMs = (data.summary.config && data.summary.config.refreshMs) || 5000; ok++; }
  if (res[1].status === 'fulfilled') { data.sessions = res[1].value || []; data.sessDiff = diffSessions(data.sessions); updateRings(); ok++; }
  if (res[2].status === 'fulfilled') { data.series = buildSeries(res[2].value); ok++; }
  if (res[3].status === 'fulfilled') { data.history = res[3].value || []; feedHistory(); }
  if (res[4] && res[4].status === 'fulfilled') data.series7 = buildSeries(res[4].value);
  if (ok === 0) { if (!data.lost) { data.lost = true; say('Signal lost. Searching...'); } setLink(); return; }
  const wasLost = data.lost; data.lost = false; data.lastOk = Date.now();
  deriveTargets(); updateHud(); setLink(); renderLegend(); issuesChanged(true); syncWaitData();
  for (const as of (data.summary.activeSessions || [])) if (as && as.id && as.last) queueDetail(as);
  if (wasLost) say('Signal restored.');
  else if (reason === 'update') announceChange(prev, data.summary);
  if (reason === 'update' || reason === 'poll') receiveFromDelta(prev, data.summary);
  else if (!voice.started) { voice.started = true; rotateVoice(true); }
  if (params.get('detail') === '1' && !detailOpen) { params.delete('detail'); openDetail(); }
}

let debounceT = 0;
function connectEvents() {
  let es; try { es = new EventSource('/api/events'); } catch (e) { return; }
  es.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } if (m.type === 'update') { feedSys('sse update'); shock(); clearTimeout(debounceT); debounceT = setTimeout(() => refresh('update'), 1000); } };
  es.onerror = () => setLink(true);
  es.onopen = () => setLink();
}

/* ============================================================ issues layer */
// issuesFor(session) -> [{kind, severity:'error'|'warn', count, msg, t}]
// Sources: session.issues (future API field), client-derived details (/api/sessions/:id calls[].ctx), demo injection.
const issueCache = new Map(); // id -> { last, issues, pending }
const fetchQ = []; let fetching = 0;
const normIssue = (x) => ({ kind: String(x.kind || 'issue'), severity: x.severity === 'error' ? 'error' : 'warn', count: +x.count || 1, msg: String(x.msg || x.kind || ''), t: x.t || Date.now() });
function deriveIssues(d) {
  const out = []; const calls = (d.calls || []).filter((c) => !c.agentId); // main agent only
  let comp = 0, tc = 0;
  for (let i = 1; i < calls.length; i++) { const a = calls[i - 1].ctx || 0, b = calls[i].ctx || 0; if (a > 20000 && b < a * 0.5) { comp++; tc = calls[i].t; } }
  if (comp) out.push({ kind: 'compaction', severity: 'warn', count: comp, msg: 'memory compressed', t: tc });
  const last = calls.length ? calls[calls.length - 1].ctx || 0 : 0;
  if (last > 150000) out.push({ kind: 'context', severity: 'warn', count: 1, msg: `context pressure ${fmtTok(last)}`, t: calls[calls.length - 1].t });
  return out;
}
function queueDetail(s) {
  const c = issueCache.get(s.id); if (c && (c.last === s.last || c.pending === s.last)) return;
  issueCache.set(s.id, { ...(c || { issues: [] }), pending: s.last }); fetchQ.push(s); pumpQ();
}
function pumpQ() {
  while (fetching < 3 && fetchQ.length) {
    const s = fetchQ.shift(); fetching++;
    api.get('/api/sessions/' + encodeURIComponent(s.id)).then((d) => { issueCache.set(s.id, { last: s.last, issues: deriveIssues(d) }); if (s.isActive || feedActive(s)) feedIngest(s, d); })
      .catch(() => issueCache.set(s.id, { last: s.last, issues: [] })).finally(() => { fetching--; issuesChanged(); pumpQ(); });
  }
}
const DEMO = {
  2: [{ kind: 'tool_failure', severity: 'error', count: 4, msg: '4 tool failures' }],
  5: [{ kind: 'api_error', severity: 'error', count: 2, msg: '2 API errors, retries exhausted' }],
  4: [{ kind: 'compaction', severity: 'warn', count: 2, msg: 'memory compressed' }],
  7: [{ kind: 'context', severity: 'warn', count: 1, msg: 'context pressure 171k' }],
  9: [{ kind: 'tool_failure', severity: 'error', count: 1, msg: '1 tool failure' }],
};
function issuesFor(s) {
  const out = [];
  if (Array.isArray(s.issues)) out.push(...s.issues.map(normIssue));
  const c = issueCache.get(s.id); if (c) out.push(...c.issues.map(normIssue));
  if (demo) { const i = data.sessions.findIndex((x) => x.id === s.id); if (DEMO[i]) out.push(...DEMO[i].map((x) => normIssue({ ...x, t: Date.now() - 60000 * (i + 1) }))); }
  return out;
}
function globalIssues() {
  const s = data.summary; if (!s) return []; const out = [];
  if (Array.isArray(s.issues)) out.push(...s.issues.map(normIssue));
  const pj = s.projection || {}; if (pj.today && pj.avg7 && pj.avg7.cost > 0 && pj.today.cost > 1.5 * pj.avg7.cost) out.push({ kind: 'burn', severity: 'warn', count: 1, msg: `today's burn is ${(pj.today.cost / pj.avg7.cost).toFixed(1)}x the 7-day average`, t: Date.now() });
  return out;
}
const announced = new Set();
function issuesChanged(fromRefresh) {
  let n = globalIssues().length; const fresh = [];
  rings.forEach((r, i) => { r.iss = issuesFor(r.s); r.sev = r.iss.some((x) => x.severity === 'error') ? 2 : r.iss.length ? 1 : 0; n += r.iss.length; r.iss.forEach((x) => { const key = r.id + ':' + x.kind + ':' + x.count; if (!announced.has(key)) { if (voice.started) announced.add(key); fresh.push({ i, x }); } }); });
  globalIssues().forEach((x) => { const key = 'g:' + x.kind; if (!announced.has(key)) { if (voice.started) announced.add(key); fresh.push({ i: -1, x }); } });
  hudEls.iss.textContent = n; hudEls.iss.classList.toggle('bad', n > 0);
  for (const f of fresh) { const k = 'e:' + (f.i < 0 ? 'g' : rings[f.i].id) + f.x.kind + f.x.count; if (!feed.seen.has(k)) { feed.seen.add(k); feedPush('e', `! ${f.i < 0 ? 'global' : 'memory ' + (f.i + 1)}: ${f.x.msg}`); } }
  if (fresh.length && voice.started) {
    fresh.sort((a, b) => (b.x.severity === 'error') - (a.x.severity === 'error')); const f = fresh[0];
    say(f.i < 0 ? `Warning: ${f.x.msg}.` : f.x.severity === 'error' ? `Memory ${f.i + 1} is fragmenting: ${f.x.msg}.` : `Memory ${f.i + 1}: ${f.x.msg}.`);
    lastAnnounce = performance.now();
  }
}

/* ============================================================ state */
const MODES = ['CORE', 'MEMORY', 'NEURAL', 'PULSE', 'MODELS'];
let mode = clamp((parseInt(params.get('mode'), 10) || 1) - 1, 0, 4);
const mw = [0, 0, 0, 0, 0]; mw[mode] = params.has('mode') ? 1 : 0;
let sel = 0, hover = -1, frozen = false, hudOn = true, voiceOn = true, pulse7 = params.get('w') === '7d';
let detailOpen = false, helpOpen = false, zoom = 1, zoomCur = 1; const mouse = { x: -1, y: -1, in: false, nx: 0, ny: 0 };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const motion = reduced ? 0.3 : 1;
const DTMAX = params.get('shot') === '1' ? 0.5 : 0.05;
let clockTipStr = '';
// receiving state machine: recv.on runs one burst of `dur` seconds; view.ex (excitement 0..1) and view.wg (web growth 0..1) derive from its phase
const recv = { t: 0, dur: 9, peak: 1, amp: 1, on: false, nodes: 250, frozen: false, phase: 0, sizeK: 1, briK: 1, th: 0.3, degCap: 4, settleMode: 0, sk: 0, sparkle: 0, lastFull: -1e9, lastShim: -1e9, pattern: 'shock', pendCalls: 0, pend: new Map(), seed: 0, hubN: 2 };
const envE = (p) => (p < 0.18 ? ease(p / 0.18) : p < 0.62 ? 1 : 1 - ease(clamp((p - 0.62) / 0.38, 0, 1)));
const envW = (p) => (p < 0.42 ? ease(p / 0.42) : p < 0.62 ? 1 : 1 - ease(clamp((p - 0.62) / 0.38, 0, 1)));
let curAdt = 0;
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// ctx: { diffs:[{ang, rad, title, dC, active, subs}], toolRatio, outPerCall, title } (all optional; X key passes {} = random origin and pattern)
function triggerReceive(amp, ctx) {
  ctx = ctx || {}; amp = clamp(amp, 0.05, 1); const rm = reduced ? 0.6 : 1; const fresh = !(recv.on && !recv.frozen);
  if (fresh) { recv.amp = amp; recv.t = 0; } else { recv.amp = Math.max(recv.amp, amp); recv.t = Math.min(recv.t, 0.4 * recv.dur); }
  recv.dur = lerp(2, 9, recv.amp) * rm; recv.peak = lerp(0.22, 1, recv.amp * recv.amp) * (reduced ? 0.75 : 1);
  if (fresh) genBurst(ctx); recv.on = true; if (amp >= 0.35) recv.lastFull = performance.now();
  if (amp > 0.45 && performance.now() - lastAnnounce > 2500) { say(ctx.title ? `Receiving from ${trunc(ctx.title, 40)}…` : 'Receiving information.'); lastAnnounce = performance.now(); }
  feedSys(`burst ${recv.pattern} · amp ${recv.amp.toFixed(2)}${ctx.title ? ' · from ' + trunc(ctx.title, 36) : ''}`);
}
// which sessions produced the new calls (diffed per id between two /api/sessions fetches)
const prevSessMap = new Map();
function diffSessions(list) {
  const out = [];
  for (const s of list) {
    const cur = { calls: s.calls || 0, tools: s.toolCalls || 0, out: s.tokens ? (s.tokens.output || 0) + (s.tokens.thinking || 0) : 0, tok: s.tokens ? s.tokens.total || 0 : 0 }, p = prevSessMap.get(s.id);
    if (p && (cur.calls > p.calls || cur.tok > p.tok)) out.push({ id: s.id, dC: Math.max(0, cur.calls - p.calls), dT: cur.tools - p.tools, dO: cur.out - p.out, s });
    prevSessMap.set(s.id, cur);
  }
  return out;
}
function sessAnchor(id) { const r = rings.find((q) => q.id === id); return r ? { ang: r.a0 + r.rot * r.rotW, rad: Math.max(0.15, r.r) } : { ang: Math.random() * TAU, rad: 0.3 }; }
function ctxFromPend() {
  const arr = [...recv.pend.values()].sort((a, b) => b.dC - a.dC); let dC = 0, dT = 0, dO = 0; for (const d of arr) { dC += d.dC; dT += d.dT; dO += d.dO; }
  const ctx = { diffs: arr.slice(0, 3).map((d) => ({ ...sessAnchor(d.id), title: d.s.title || d.s.firstPrompt, dC: d.dC })) };
  if (dC > 0) { ctx.toolRatio = dT / dC; ctx.outPerCall = dO / dC; } if (arr[0]) ctx.title = arr[0].s.title || arr[0].s.firstPrompt;
  return ctx;
}
// data -> burst, with a ~20 s cooldown: skipped deltas accumulate; inside the cooldown only a sparkle on the live web (or one tiny shimmer)
function receiveFromDelta(a, b) {
  if (!a || !b || !a.totals || !b.totals) return; const dc = (b.totals.calls || 0) - (a.totals.calls || 0), dt = (b.totals.total || 0) - (a.totals.total || 0);
  if (!(dc > 0 || dt > 0)) return;
  const wids = waitIds(), dsf = (data.sessDiff || []).filter((d) => !wids.has(d.id)); if ((data.sessDiff || []).length && !dsf.length) return; // the only activity is on a waiting session
  recv.pendCalls += Math.max(dc, 0); for (const d of dsf) { const q = recv.pend.get(d.id); if (q) { q.dC += d.dC; q.dT += d.dT; q.dO += d.dO; q.s = d.s; } else recv.pend.set(d.id, { ...d }); }
  const now = performance.now();
  if (now - recv.lastFull < 20000) { if (recv.on || view.wg > 0.02) recv.sparkle = 1; else if (now - recv.lastShim > 6000) { recv.lastShim = now; triggerReceive(0.12, ctxFromPend()); } return; }
  const amp = 0.1 + 0.9 * clamp(Math.log10(1 + recv.pendCalls) / 1.7, 0, 1); const ctx = ctxFromPend(); recv.pendCalls = 0; recv.pend.clear(); triggerReceive(amp, ctx);
}
let T = 0, lastActivity = performance.now(); let clockHover = false;
const view = { ex: 0, wg: 0, cs: 1, dialR: 0.40, fiberA: 1, act: 0, actT: 0, tint: [...pal.core], tintT: [...pal.core], g: [0, 0, 0], gT: [0, 0, 0], pupil: 0.05, domModel: null };
const shocks = [];
let rings = []; const ghosts = [];
const shock = () => { shocks.push(performance.now() / 1000); if (shocks.length > 5) shocks.shift(); };

function updateRings() {
  const ss = data.sessions || []; const old = new Map(rings.map((r) => [r.id, r]));
  const logs = ss.map((s) => Math.log10(1 + (s.tokens ? s.tokens.total : 0)));
  const lo = Math.min(...logs, 99), hi = Math.max(...logs, 0);
  const next = ss.map((s, i) => {
    let r = old.get(s.id); old.delete(s.id);
    if (!r) r = { id: s.id, r: 0, th: 0, a0: 0, span: TAU, alpha: 0, rot: hash(i, 3) * TAU, dir: 1, speed: 0.1, rotW: 1, selK: 0, hovK: 0, act: 0, seed: Math.floor(hash(i, 9) * 1e4), nSeg: 20, iss: [], sev: 0, waitK: 0, idleK: 0, wait: null, obj: null, tilt: [(hash(i, 31) - 0.5) * 0.34, (hash(i, 32) - 0.5) * 0.34, hash(i, 33) * TAU], z: 0 };
    r.s = s; r.i = i; r.nl = hi > lo ? (logs[i] - lo) / (hi - lo) : 0.5;
    r.nSeg = clamp(Math.round(6 + (s.calls || 0) / 5), 8, 80);
    queueDetail(s);
    return r;
  });
  old.forEach((r) => { r.dead = true; ghosts.push(r); });
  rings = next; rings.forEach((r, i) => { r.dir = i % 2 ? -1 : 1; });
  sel = clamp(sel, 0, Math.max(0, rings.length - 1));
}

function deriveTargets() {
  const s = data.summary; if (!s) return; const p = s.projection || {};
  view.gT[0] = p.today && p.today.pace && p.today.pace.cost ? p.today.cost / p.today.pace.cost : 0;
  view.gT[1] = s.totals ? s.totals.cacheHit || 0 : 0;
  view.gT[2] = p.monthToDate && p.projectedMonth && p.projectedMonth.cost ? p.monthToDate.cost / p.projectedMonth.cost : 0;
  const sr = data.series; let sum = 0;
  if (sr) { const now = Date.now(); for (let i = sr.n - 1; i >= 0 && i > sr.n - 13; i--) { if (!sr.calls[i]) continue; const age = now - (sr.t0 + (i + 1) * sr.bucketMs); sum += sr.calls[i] * Math.exp(-Math.max(0, age) / 600000); } }
  view.actT = clamp(1 - Math.exp(-sum / 25), 0, 1);
  if ((s.activeAgents || 0) > 0) view.actT = Math.max(view.actT, 0.3);
  let best = -1, bi = -1;
  if (sr) for (let k = 0; k < sr.models.length; k++) { let c = 0; for (let i = Math.max(0, sr.n - 12); i < sr.n; i++) c += sr.cost[k][i]; if (c > best) { best = c; bi = k; } }
  const dom = bi >= 0 && best > 0 ? sr.models[bi] : s.perModel && s.perModel[0] ? s.perModel[0].model : null;
  view.tintT = dom ? modelColor(dom) : pal.core; view.domModel = dom;
  if (params.has('act')) view.actT = +params.get('act');
}
if (params.has('act')) { view.actT = view.act = +params.get('act'); }

/* ============================================================ three.js setup */
const cv = $('cv');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false, powerPreference: 'high-performance', alpha: false }); } catch (e) {
  const d = document.createElement('div'); d.id = 'nogl'; d.innerHTML = 'WEBGL UNAVAILABLE &nbsp;·&nbsp; <a class="back" href="/">BACK TO STATS</a>'; document.body.append(d); throw e;
}
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.setClearColor(0x020103, 1);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 40);
const FOV_T = Math.tan((35 * Math.PI) / 360);
const world = new THREE.Group(); world.position.y = 0.25; scene.add(world); // triangle bbox centred on screen, core sits above centre
const core = new THREE.Group(); world.add(core);

// shared uniforms (palette in linear light, driven per frame)
const U = {
  uTime: { value: 0 }, uFrame: { value: new THREE.Vector3() }, uCore: { value: new THREE.Vector3() }, uHot: { value: new THREE.Vector3() }, uDim: { value: new THREE.Vector3() },
  uTint: { value: new THREE.Vector3() }, uBgBase: { value: new THREE.Vector3() }, uBgVein: { value: new THREE.Vector3() }, uGrain: { value: 0 }, uAct: { value: 0 }, uPull: { value: 0 }, uPx: { value: 800 }, uCoreP: { value: new THREE.Vector2(0, 0.25) },
};

const NOISE = `
float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x),mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x),f.y); }
float fbm(vec2 p){ float a=.5,s=0.; mat2 m=mat2(1.6,1.2,-1.2,1.6); for(int i=0;i<5;i++){ s+=a*vn(p); p=m*p; a*=.5; } return s; }
float fbm3(vec2 p){ float a=.5,s=0.; mat2 m=mat2(1.6,1.2,-1.2,1.6); for(int i=0;i<3;i++){ s+=a*vn(p); p=m*p; a*=.5; } return s; }
`;

/* ----- marble background (world-space plane behind everything: parallax with the camera drift) ----- */
const bgMat = new THREE.ShaderMaterial({
  uniforms: U, depthWrite: false, depthTest: false,
  vertexShader: `varying vec3 vWP; void main(){ vec4 w=modelMatrix*vec4(position,1.); vWP=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `varying vec3 vWP; uniform float uTime,uAct,uGrain; uniform vec3 uTint,uCore,uBgBase,uBgVein; uniform vec2 uCoreP;
${NOISE}
void main(){
  vec2 p=vWP.xy*0.85; float t=uTime*0.012;
  vec2 w=vec2(fbm(p*1.2+t), fbm(p*1.2+5.2-t));
  float b=fbm(p*1.0+w*1.7);
  vec3 col=mix(uBgBase*0.08, uBgBase, smoothstep(.28,.85,b));
  float f1=fbm(p*1.55+w*2.4+3.1), f2=fbm(p*3.3-w*1.7+8.3), f3=fbm3(p*7.0+w*3.0);
  float v1=1.-smoothstep(0.,fwidth(f1)*1.3+0.0004,abs(f1-0.5)), g1=1.-smoothstep(0.,0.04,abs(f1-0.5));
  float v2=1.-smoothstep(0.,fwidth(f2)*1.1+0.0004,abs(f2-0.5));
  float v3=(1.-smoothstep(0.,fwidth(f3)*1.0+0.0004,abs(f3-0.5)))*0.5;
  float r=length(vWP.xy-uCoreP);
  float sh=0.72+0.28*sin(uTime*0.45+f1*22.+f2*9.);
  vec3 gold=uBgVein;
  float lit=1.+2.2*exp(-r*1.3)*(0.5+uAct);
  col+=gold*(v1*0.15+v2*0.05+v3*0.02)*sh*lit + gold*g1*0.004;
  col+=uTint*exp(-r*r*2.2)*(0.018+0.05*uAct);
  // fine grainy floor panel (film look); fades out toward the edges so marble frames it
  float panel=smoothstep(2.0,1.15,length(vWP.xy*vec2(0.78,1.0)));
  float gr=h21(floor(vWP.xy*520.))*0.65+vn(vWP.xy*140.)*0.35;
  vec3 floorC=vec3(0.020,0.026,0.045)+vec3(0.030,0.036,0.055)*gr;
  col=mix(col, floorC+col*0.35, uGrain*panel*0.92);
  gl_FragColor=vec4(col,1.);
}`,
});
const bg = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), bgMat); bg.position.z = -1.3; bg.renderOrder = -10; bg.frustumCulled = false; scene.add(bg);

/* ----- neon triangle ----- */
const VA = [210, 330, 90].map((d) => (d * Math.PI) / 180);
const verts3 = (R, z = 0) => VA.map((a) => new THREE.Vector3(Math.cos(a) * R, -Math.sin(a) * R, z));
const Y = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
function setSeg(m, A, B) { _d.subVectors(B, A); const L = _d.length(); m.position.addVectors(A, B).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(Y, _d.multiplyScalar(1 / (L || 1))); m.scale.set(1, L, 1); }
const cylG = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true), sphG = new THREE.SphereGeometry(1, 12, 8);
const neon = (F, k) => lin([F[0], F[1] * 0.45, F[2] * 0.4], k); // keep reds red through ACES
const hdr = (r = 1, o = {}) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, r, r), toneMapped: true, ...o });
const mats = { tubeOut: hdr(), tubeIn: hdr(), white: hdr(), gaugeBase: hdr(), gaugeLit: hdr(), spark: hdr(), tick: new THREE.LineBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }), chev: [0, 1, 2].map(() => new THREE.LineBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })), dial: new THREE.LineBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }) };
const frameG = new THREE.Group(); world.add(frameG);
const FR = [{ R: 0.995, z: 0.045, rad: 0.0062, mat: mats.tubeOut }, { R: 0.93, z: -0.045, rad: 0.0046, mat: mats.tubeIn }];
const frames = FR.map((f) => {
  const v = verts3(f.R, f.z), g = new THREE.Group(); const segs = [];
  for (let e = 0; e < 3; e++) {
    const A = v[e], B = v[(e + 1) % 3];
    const m = new THREE.Mesh(cylG, f.mat); setSeg(m, A, B); m.scale.x = m.scale.z = f.rad; g.add(m);
    const w = new THREE.Mesh(cylG, mats.white); setSeg(w, A, B); w.scale.x = w.scale.z = f.rad * 0.34; w.position.z += 0.001; g.add(w);
    const j = new THREE.Mesh(sphG, f.mat); j.position.copy(A); j.scale.setScalar(f.rad * 1.02); g.add(j);
    segs.push(m);
  }
  frameG.add(g); return { v, f };
});
{ // ticks between the two edges + corner chevrons + corner spikes
  const vo = frames[0].v, vi = frames[1].v, pts = [];
  for (let e = 0; e < 3; e++) { const A = vo[e], B = vo[(e + 1) % 3], A2 = vi[e], B2 = vi[(e + 1) % 3]; const N = 42;
    for (let i = 1; i < N; i++) { const t = i / N, long = i % 6 === 0; const o = new THREE.Vector3().lerpVectors(A, B, t), n = new THREE.Vector3().lerpVectors(A2, B2, t);
      if (long) pts.push(o, n); else pts.push(n, new THREE.Vector3().lerpVectors(n, o, 0.45));
      const dir = n.clone().setZ(0).normalize(); pts.push(n, n.clone().addScaledVector(dir, -(long ? 0.009 : 0.004))); } }
  frameG.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), mats.tick));
  for (let e = 0; e < 3; e++) { const a = VA[e], ux = Math.cos(a), uy = -Math.sin(a), px = -uy, py = ux;
    for (let k = 0; k < 3; k++) { const d = 0.80 - k * 0.045, w = 0.03 - k * 0.006;
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ux * d + px * w * 1.6, uy * d + py * w * 1.6, 0.03), new THREE.Vector3(ux * (d + w), uy * (d + w), 0.03), new THREE.Vector3(ux * d - px * w * 1.6, uy * d - py * w * 1.6, 0.03)]);
      const m = new THREE.Line(g, mats.chev[k]); m.userData = { e, k }; frameG.add(m); frames.chev = (frames.chev || []).concat(m); }
    const sp = new THREE.Mesh(cylG, mats.tubeOut); setSeg(sp, new THREE.Vector3(ux * 1.01, uy * 1.01, 0.045), new THREE.Vector3(ux * 1.07, uy * 1.07, 0.045)); sp.scale.x = sp.scale.z = 0.005; frameG.add(sp); }
}
// gauges (on the inner edge, drawn inwards) + travelling highlights
const gauges = [[2, 0], [2, 1], [0, 1]].map(([a, b]) => {
  const base_ = new THREE.Mesh(cylG, mats.gaugeBase), lit = new THREE.Mesh(cylG, mats.gaugeLit), dot = new THREE.Mesh(sphG, mats.gaugeLit);
  frameG.add(base_, lit, dot); return { a, b, base_, lit, dot };
});
const sparks = [0, 1, 2].map(() => { const m = new THREE.Mesh(cylG, mats.spark); frameG.add(m); return m; });

/* ----- plasma disc + pupil ----- */
const plasmaMat = new THREE.ShaderMaterial({
  uniforms: { ...U, uR0: { value: 0.46 }, uPupil: { value: 0.05 }, uFiber: { value: 1 }, uAlpha: { value: 1 } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  vertexShader: `varying vec2 vP; uniform float uR0; void main(){ vP=position.xy*uR0; gl_Position=projectionMatrix*modelViewMatrix*vec4(position.xy*uR0,position.z,1.); }`,
  fragmentShader: `varying vec2 vP; uniform float uR0,uPupil,uAct,uTime,uFiber,uAlpha; uniform vec3 uTint,uCore,uHot,uDim;
${NOISE}
void main(){
  float r=length(vP); float R=r/uR0; if(R>1.) discard;
  float a=atan(vP.y,vP.x);
  float ang=a+(1.-R)*2.4+uTime*0.10;
  vec2 sp=vec2(cos(ang),sin(ang))*r*9.;
  vec2 w1=vec2(fbm(sp+uTime*0.16), fbm(sp+vec2(5.2,1.3)-uTime*0.13));
  float n=fbm(sp+3.2*w1);
  float n2=fbm(sp*1.6+4.0*w1.yx+uTime*0.09);
  float fib=fbm(vec2(a*16.+uTime*0.15, r*20.));
  float prof=smoothstep(1.,.12,R);
  float edge=smoothstep(uPupil*0.9, uPupil*2.2, r);
  float I=(0.10+0.85*uAct)*prof*edge;
  vec3 tint=mix(uCore,uTint,0.5);
  vec3 c=mix(uDim, tint, smoothstep(.25,.85,n))*(0.5+1.2*n);
  c+=uHot*smoothstep(.5,.95,n2)*0.9;
  vec3 col=c*I*1.05;
  col+=mix(uCore,uHot,.2)*pow(fib,3.)*prof*0.5*uFiber*(0.25+0.6*uAct);
  float d=max(r-uPupil,0.);
  col+=mix(uCore,uTint,.3)*exp(-d*55.)*(0.5+1.0*uAct)*step(uPupil,r);
  col+=uTint*exp(-d*9.)*0.05*(0.4+uAct)*step(uPupil,r);
  gl_FragColor=vec4(col*uAlpha,1.);
}`,
});
const plasma = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), plasmaMat); plasma.renderOrder = 0; plasma.frustumCulled = false; core.add(plasma);
const pupilMesh = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false })); pupilMesh.position.z = 0.004; pupilMesh.renderOrder = 1; core.add(pupilMesh);
const voidMesh = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, vertexShader: `varying vec2 vP; void main(){ vP=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`, fragmentShader: `varying vec2 vP; void main(){ gl_FragColor=vec4(0.,0.,0.,smoothstep(1.,0.4,length(vP))*0.92); }` })); voidMesh.position.z = 0.003; voidMesh.renderOrder = 0.5; core.add(voidMesh);
const rimMat = hdr(1, { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
const rim = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 96), rimMat); rim.position.z = 0.006; rim.renderOrder = 8; core.add(rim);
const glintMat = hdr(1, { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
const glint = new THREE.Mesh(new THREE.RingGeometry(0.8, 0.97, 24, 1, 1.0, 0.9), glintMat); glint.position.z = 0.007; glint.renderOrder = 9; core.add(glint);

/* ----- shock waves ----- */
const shockMat = new THREE.ShaderMaterial({
  uniforms: { ...U, uS: { value: new Float32Array([2, 2, 2, 2, 2]) }, uPupil: { value: 0.05 } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  vertexShader: `varying vec2 vP; void main(){ vP=position.xy*1.15; gl_Position=projectionMatrix*modelViewMatrix*vec4(position.xy*1.15,0.02,1.); }`,
  fragmentShader: `varying vec2 vP; uniform float uS[5]; uniform float uPupil; uniform vec3 uCore,uHot;
void main(){ float r=length(vP); vec3 c=vec3(0.);
  for(int i=0;i<5;i++){ float age=uS[i]; if(age>1.) continue; float rr=mix(uPupil,0.92,1.-pow(1.-age,2.)), f=1.-age; float w=0.004+0.014*f;
    float d=(r-rr); float k=exp(-d*d/(w*w)); c+=mix(uCore,uHot,.55)*k*f*f*2.6 + uHot*exp(-pow((r-rr*0.93)/0.004,2.))*f*0.6; }
  gl_FragColor=vec4(c,1.); }`,
});
const shockQ = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), shockMat); shockQ.renderOrder = 11; shockQ.frustumCulled = false; core.add(shockQ);

/* ----- hour dial: 24 ticks + analog clock dot with comet trail ----- */
const ringsG = new THREE.Group(); core.add(ringsG);
const hourMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1) });
const hourTicks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), hourMat, 12); hourTicks.instanceMatrix.setUsage(THREE.DynamicDrawUsage); hourTicks.frustumCulled = false; core.add(hourTicks);
for (let i = 0; i < 12; i++) hourTicks.setColorAt(i, new THREE.Color(1, 1, 1));
const clockStripes = [];
const hourCap = new THREE.Mesh(sphG, hdr(1)); hourCap.scale.setScalar(0.0095); core.add(hourCap);
const hourLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })); hourLine.frustumCulled = false; core.add(hourLine);
mats.min = new THREE.LineBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
const minuteTicks = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 60 }, (_, i) => i % 5 ? i : -1).filter((i) => i >= 0).flatMap((i) => { const a = Math.PI / 2 - (i / 60) * TAU; return [new THREE.Vector3(Math.cos(a), Math.sin(a), 0), new THREE.Vector3(Math.cos(a) * 1.025, Math.sin(a) * 1.025, 0)]; })), mats.min); core.add(minuteTicks);
const dialLine = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 160 }, (_, i) => new THREE.Vector3(Math.cos((i / 160) * TAU), Math.sin((i / 160) * TAU), 0))), mats.dial); core.add(dialLine);
const TRAIL = 28;
const trailGeo = new THREE.BufferGeometry(); trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3)); trailGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })); trail.frustumCulled = false; core.add(trail);
const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
const spriteMat = (k = 1) => new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(k, k, k), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
const clockDot = new THREE.Sprite(spriteMat(1)); clockDot.scale.setScalar(0.05); clockDot.renderOrder = 12; core.add(clockDot);
const clockCore = new THREE.Mesh(sphG, hdr(1)); clockCore.scale.setScalar(0.0045); core.add(clockCore);
const clockState = { x: 0, y: 0, str: '' };

/* ----- memory rings: instanced arc segments, per-instance start/length/random, built in the vertex shader ----- */
const CS_DIV = 8, CS_N = 6;
const arcBase = (() => { // position = (t along arc, profile u, profile v); aN = profile normal
  const pos = [], nrm = [], idx = [];
  for (let s = 0; s <= CS_DIV; s++) for (let k = 0; k < CS_N; k++) { const a = (k / CS_N) * TAU, u = Math.cos(a), v = Math.sin(a) * 0.62; pos.push(s / CS_DIV, u, v); const n = new THREE.Vector2(Math.cos(a), Math.sin(a) / 0.62).normalize(); nrm.push(n.x, n.y); }
  for (let s = 0; s < CS_DIV; s++) for (let k = 0; k < CS_N; k++) { const a = s * CS_N + k, b = s * CS_N + (k + 1) % CS_N, c = a + CS_N, d = b + CS_N; idx.push(a, c, b, b, c, d); }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx };
})();
const ringVS = `attribute vec3 aSeg; attribute vec2 aN; uniform float uR,uTh,uA0,uSpan,uRot,uK,uJit,uTaper,uBlk; varying vec3 vN, vV; varying float vRand;
void main(){
  float xs=aSeg.x/uK; if(xs>=1.0){ gl_Position=vec4(2.,2.,2.,1.); return; }
  float t=position.x; float taper=1.-0.78*uTaper*pow(abs(2.*t-1.),5.);
  float ang=uA0+uRot+(xs+t*aSeg.y/uK)*uSpan;
  if(uBlk>0.){ float cell=aSeg.y/uK; float lf=min(uBlk*(0.75+0.5*aSeg.z)/(uR*uSpan), cell*0.85); ang=uA0+uRot+(xs+cell*0.5+(t-0.5)*lf)*uSpan; }
  float rr=uR+position.y*uTh*0.5*taper+uJit*(aSeg.z-.5)*0.012;
  vec3 pos=vec3(cos(ang)*rr, -sin(ang)*rr, position.z*uTh*0.5*taper+uJit*(aSeg.z-.5)*0.02);
  vec3 n=vec3(cos(ang)*aN.x, -sin(ang)*aN.x, aN.y);
  vN=normalMatrix*n; vRand=aSeg.z;
  vec4 mv=modelViewMatrix*vec4(pos,1.); vV=-mv.xyz; gl_Position=projectionMatrix*mv;
}`;
const ringFS = `varying vec3 vN, vV; varying float vRand; uniform vec3 uColor,uHot; uniform float uAlpha,uInt,uSel,uBlink,uWarn,uErr,uDrop,uTime,uWait; uniform vec3 uBeacon;
void main(){
  vec3 N=normalize(vN), V=normalize(vV); float ndv=clamp(dot(N,V),0.,1.);
  float cr=pow(ndv,3.), rm=pow(1.-ndv,2.);
  vec3 col=uColor*(0.5+0.55*rm)+uHot*cr*0.5;
  col=mix(col, uBeacon*1.5+vec3(1.)*cr*.5, uWait*0.88);
  col=mix(col, vec3(1.,.30,.06)*1.25+uHot*cr*.3, uWarn*0.62);
  col=mix(col, vec3(1.,.95,.88)*1.7, uSel*0.78);
  col=mix(col, vec3(1.,.0,.0)*2.0+vec3(1.,.35,.25)*cr*.6, uErr*0.92);
  float vis=1.;
  if(uErr>0.01){ float h=fract(sin(vRand*91.7+floor(uTime*13.)*17.3)*437.5); vis=h<uDrop?0.06:1.; }
  gl_FragColor=vec4(col*uInt*uBlink*vis, uAlpha*(0.06+0.94*vis));
}`;
const arcBlock = (() => { // rectangular cross-section for the expansion-ring blocks
  const pos = [], nrm = [], idx = [], cs = [[1, 0.4], [-1, 0.4], [-1, -0.4], [1, -0.4]];
  for (let s = 0; s <= CS_DIV; s++) cs.forEach(([u, v]) => { pos.push(s / CS_DIV, u, v); nrm.push(u * 0.7, v / 0.4 * 0.7); });
  for (let s = 0; s < CS_DIV; s++) for (let k = 0; k < 4; k++) { const a = s * 4 + k, b = s * 4 + (k + 1) % 4, c = a + 4, d = b + 4; idx.push(a, c, b, b, c, d); }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx };
})();
function ringUniforms() { return { ...U, uR: { value: 0.2 }, uTh: { value: 0.01 }, uA0: { value: 0 }, uSpan: { value: TAU }, uRot: { value: 0 }, uK: { value: 1 }, uJit: { value: 0 }, uTaper: { value: 1 }, uBlk: { value: 0 }, uWait: { value: 0 }, uBeacon: { value: new THREE.Vector3(0.4, 0.8, 1) }, uColor: { value: new THREE.Vector3(1, 0.5, 0.1) }, uHot: U.uHot, uAlpha: { value: 1 }, uInt: { value: 1.6 }, uSel: { value: 0 }, uBlink: { value: 1 }, uWarn: { value: 0 }, uErr: { value: 0 }, uDrop: { value: 0.1 } }; }
function buildRingObj(r) {
  if (r.obj) { ringsG.remove(r.obj); r.obj.geometry.dispose(); r.obj.material.dispose(); }
  const B = r.blocky || r.rect ? arcBlock : arcBase; const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(B.pos, 3)); g.setAttribute('aN', new THREE.BufferAttribute(B.nrm, 2)); g.setIndex(B.idx);
  const n = r.blocky ? r.cap : r.rect ? r.nSeg * 3 : r.nSeg, seg = r.blocky ? r.segArr : new Float32Array(n * 3);
  if (!r.blocky) for (let k = 0; k < n; k++) { const step = 1 / n, len = r.rect ? step : step * (0.42 + 0.46 * hash(r.seed, k)); seg[k * 3] = k * step + (step - len) * 0.5; seg[k * 3 + 1] = len; seg[k * 3 + 2] = hash(r.seed + 7, k); }
  g.setAttribute('aSeg', new THREE.InstancedBufferAttribute(seg, 3)); g.instanceCount = r.blocky ? r.n : n;
  const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: ringUniforms(), vertexShader: ringVS, fragmentShader: ringFS, transparent: true, depthWrite: true, side: THREE.DoubleSide }));
  if (r.blocky || r.rect) m.material.uniforms.uTaper.value = 0; r.objRect = !!r.rect; m.frustumCulled = false; m.renderOrder = 2; r.obj = m; r.objN = r.blocky ? n : r.nSeg; ringsG.add(m);
}
function killRingObj(r) { if (r.obj) { ringsG.remove(r.obj); r.obj.geometry.dispose(); r.obj.material.dispose(); r.obj = null; } }


/* ----- idle ornaments: rune glyphs + corner ring arcs; receiving: expansion rings, red marker, plexus web ----- */
mats.rune = new THREE.LineBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
{
  const pts = []; const stroke = (a, b) => pts.push(a, b);
  for (let v = 0; v < 3; v++) {
    const ang = VA[v], ux = Math.cos(ang), uy = -Math.sin(ang), px = -uy, py = ux;
    [[0.66, 0], [0.615, 0.075], [0.615, -0.075]].forEach(([ax, lat], q) => {
      const seed = v * 7 + q * 3 + 1, sc = 0.0105, ox = ux * ax + px * lat, oy = uy * ax + py * lat; // glyph: stem + branches on a 3x5 grid, oriented along the vertex axis
      const P = (gx, gy) => new THREE.Vector3(ox + (ux * (gy - 2) + px * gx) * sc, oy + (uy * (gy - 2) + py * gx) * sc, 0.02);
      stroke(P(0, 0), P(0, 4));
      for (let k = 0; k < 3; k++) { const gy = Math.floor(hash(seed, k) * 4), side = hash(seed, k + 9) < 0.5 ? -1 : 1, up = hash(seed, k + 19) < 0.5 ? 1 : -1; if (gy + up >= 0 && gy + up <= 4) stroke(P(0, gy), P(side, gy + up)); if (hash(seed, k + 29) < 0.35) stroke(P(side, gy), P(side, Math.min(4, gy + 2))); }
      if (q === 0) { stroke(P(-1, 4), P(1, 4)); }
    });
  }
  frameG.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), mats.rune));
}
const cornerArcs = []; // idle band: curved dash arcs hugging each corner
for (let v = 0; v < 3; v++) for (let j = 0; j < 3; j++) {
  const r = 0.50 + j * 0.055; let half = 0.02; for (let th = 0.02; th < 0.7; th += 0.01) { if (r * Math.sin(th) <= (1 - r * Math.cos(th)) * 0.577 * 0.78) half = th; else break; }
  cornerArcs.push({ nSeg: 5 + j * 3, seed: 400 + v * 10 + j, obj: null, objN: 0, tilt: [0, 0, 0], a0: VA[v] - half, span: half * 2, r, j, v });
}
const XCAP = 96;
const xr = Array.from({ length: 7 }, (_, i) => ({ blocky: true, cap: XCAP, nSeg: XCAP, n: 0, segArr: new Float32Array(XCAP * 3), obj: null, objN: 0, on: true, dir: i % 2 ? -1 : 1, speed: 0.15, rot: hash(i, 77) * TAU, i, span: TAU, rOff: 0, thK: 1, colT: 0.3, tilt: [0, 0, 0] }));
// per burst: which rings appear, speeds/directions, dash length distribution (long bars vs short ticks), partial arcs, tilt
function genXr(rng) {
  let cnt = 0; xr.forEach((x, i) => {
    x.on = rng() < 0.82; if (x.on) cnt++; x.dir = rng() < 0.5 ? -1 : 1; x.speed = (0.06 + rng() * 0.34) * (0.8 + 0.5 * recv.amp); x.span = rng() < 0.3 ? TAU * (0.5 + 0.45 * rng()) : TAU; x.rOff = (rng() - 0.5) * 0.03; x.thK = 0.7 + rng() * 0.9; x.colT = rng();
    x.tilt[0] = (rng() - 0.5) * 0.34; x.tilt[1] = (rng() - 0.5) * 0.34; x.rot = rng() * TAU;
    const ty = rng(), a = x.segArr; let c = rng() * 0.02, n = 0;
    while (c < 1 && n < XCAP) { let len, gap; const longB = ty < 0.33 || (ty < 0.66 && rng() < 0.25);
      if (longB) { len = 0.02 + rng() * 0.06; gap = 0.012 + rng() * 0.04; } else { len = 0.004 + rng() * 0.012; gap = 0.006 + rng() * 0.016; }
      len = Math.min(len, 1 - c); a[n * 3] = c; a[n * 3 + 1] = len; a[n * 3 + 2] = rng(); n++; c += len + gap; }
    x.n = n; if (x.obj) { x.obj.geometry.attributes.aSeg.needsUpdate = true; x.obj.geometry.instanceCount = n; }
  });
  if (cnt < 4) for (let i = 0; i < 4; i++) xr[i].on = true;
}
genXr(mulberry32(7));
const markerMat = new THREE.LineBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
const marker = new THREE.Group(); marker.position.set(0, -0.52, 0.02); core.add(marker);
[0, 1].forEach((k) => marker.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.028 + k * 0.006, 0.03 - k * 0.02, 0), new THREE.Vector3(0, -0.012 - k * 0.012, 0), new THREE.Vector3(0.028 - k * 0.006, 0.03 - k * 0.02, 0)]), markerMat)));
marker.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.012, 0.06, 0), new THREE.Vector3(0.012, 0.06, 0), new THREE.Vector3(0, 0.044, 0)]), markerMat));
marker.visible = false;

const WN = 250, WL = 600;
const webHome = new Float32Array(WN * 3), webPh = new Float32Array(WN), webIg = new Float32Array(WN), webSz = new Float32Array(WN), webDr = new Float32Array(WN * 2), webPar = new Int16Array(WN).fill(-1);
const PATTERNS = ['shock', 'sweep', 'tendril', 'cluster'];
const _best = new Float32Array(WN), _bpar = new Int16Array(WN), _in = new Uint8Array(WN), _dep = new Uint8Array(WN), _cl = new Int8Array(WN), _jit = new Float32Array(WN);
// regenerate the whole web layout, ignition order, settle style and expansion rings for one burst (no per-frame work, no new buffers)
function genBurst(ctx) {
  const sp = params.get('seed'), seed = sp != null && sp !== '' ? (+sp >>> 0) : (((Math.random() * 4294967296) >>> 0) ^ (Date.now() >>> 0)); recv.seed = seed; const rng = mulberry32(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rng() + 1e-6)) * Math.cos(TAU * rng());
  const tool = ctx.toolRatio != null ? ctx.toolRatio : 0.9 + rng() * 0.9, outpc = ctx.outPerCall != null ? ctx.outPerCall : rng() * 3000;
  const tooly = clamp((tool - 1.0) * 2.5, 0, 1), outy = clamp((outpc - 800) / 2500, 0, 1);
  const wts = [1 + outy * 3, 1, 1 + tooly * 3, 1 + tooly * 0.8]; let pat = PATTERNS.indexOf(String(params.get('pattern') || ''));
  if (pat < 0) { let r = rng() * (wts[0] + wts[1] + wts[2] + wts[3]); pat = 0; while (pat < 3 && r > wts[pat]) { r -= wts[pat]; pat++; } }
  recv.pattern = PATTERNS[pat]; recv.sizeK = 1 + 0.6 * outy; recv.briK = 1 + 0.3 * outy; recv.th = 0.27 + 0.07 * tooly - 0.03 * outy; recv.degCap = 4 + (tooly > 0.5 ? 1 : 0) - (outy > 0.5 ? 1 : 0);
  recv.nodes = clamp(Math.round(lerp(24, 250, Math.pow(recv.amp, 1.3)) * (1 + 0.3 * tooly) * (1 - 0.35 * outy) * (0.75 + 0.4 * rng())), 16, WN); recv.settleMode = Math.floor(rng() * 3);
  // origins: sessions that produced the delta (or random for demo keys)
  const org = []; const dfs = ctx.diffs && ctx.diffs.length ? ctx.diffs : [{ ang: rng() * TAU, rad: 0.2 + rng() * 0.3 }, ...(rng() < 0.4 ? [{ ang: rng() * TAU, rad: 0.3 }] : [])];
  for (const d of dfs) org.push([Math.cos(d.ang) * d.rad, -Math.sin(d.ang) * d.rad, d.ang]);
  const dirA = org[0][2], dx = Math.cos(dirA), dy = -Math.sin(dirA);
  // hubs: around sessions with awake sub-agents (count ~ activeAgents)
  const hubA = []; for (const sd of data.sessions || []) { const k = Math.min(3, sd.activeAgents || 0); if (!k) continue; const an = sessAnchor(sd.id).ang; for (let q = 0; q < k && hubA.length < 10; q++) hubA.push(an); }
  if (hubA.length < 2) { const n0 = 2 + Math.floor(rng() * 3); while (hubA.length < n0) hubA.push(rng() * TAU); }
  const hubN = recv.hubN = hubA.length;
  // clusters / constellations
  const nCl = 3 + Math.floor(rng() * 5), cl = []; for (let k = 0; k < nCl; k++) cl.push({ a: k < org.length ? org[k][2] + (rng() - 0.5) * 0.7 : rng() * TAU, d: 0.35 + rng() * 1.1, sp: 0.12 + rng() * 0.28, w: 0.3 + rng(), rank: k });
  for (let k = nCl - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); const t = cl[k].rank; cl[k].rank = cl[j].rank; cl[j].rank = t; }
  let cw = 0; for (const c of cl) cw += c.w; const loner = 0.15 + 0.3 * rng();
  for (let i = 0; i < WN; i++) {
    let x, y; _cl[i] = -1;
    if (i < hubN) { const a = hubA[i] + (rng() - 0.5) * 0.6, r = 0.35 + 0.5 * rng(); x = Math.cos(a) * r; y = -Math.sin(a) * r; }
    else if (rng() < loner) { const a = rng() * TAU, r = 0.2 + 1.5 * Math.sqrt(rng()); x = Math.cos(a) * r * 0.98; y = -Math.sin(a) * r * 0.85; }
    else { let q = rng() * cw, k = 0; while (k < nCl - 1 && q > cl[k].w) { q -= cl[k].w; k++; } const c = cl[k]; _cl[i] = k; x = Math.cos(c.a) * c.d + gauss() * c.sp; y = -Math.sin(c.a) * c.d + gauss() * c.sp * 0.85; }
    x = clamp(x, -1.6, 1.6); y = clamp(y, -1.15, 0.65); webHome[i * 3] = x; webHome[i * 3 + 1] = y; webHome[i * 3 + 2] = (rng() - 0.5) * 0.5; webPh[i] = rng(); webSz[i] = 0.6 + rng() * 0.9; _jit[i] = rng();
    const rd = Math.hypot(x, y) + 1e-3, da = rng() * TAU; webDr[i * 2] = x / rd * 0.5 + Math.cos(da) * 0.5; webDr[i * 2 + 1] = y / rd * 0.5 + Math.sin(da) * 0.5; webPar[i] = -1;
  }
  // ignition order (0 = lit first) by growth pattern
  if (pat === 0) for (let i = 0; i < WN; i++) { const x = webHome[i * 3], y = webHome[i * 3 + 1]; let d = Math.hypot(x, y); for (const o of org) d = Math.min(d, Math.hypot(x - o[0], y - o[1]) + 0.15); webIg[i] = clamp(d / 1.7 + (_jit[i] - 0.5) * 0.06, 0, 0.95); }
  else if (pat === 1) for (let i = 0; i < WN; i++) webIg[i] = clamp(((webHome[i * 3] * dx + webHome[i * 3 + 1] * dy) + 0.5) / 2.3 + (_jit[i] - 0.5) * 0.05, 0, 0.95);
  else if (pat === 2) { // nearest-neighbour spanning tree grown outward from the origins (Prim); ignition = tree depth
    for (let i = 0; i < WN; i++) { let d = Math.hypot(webHome[i * 3], webHome[i * 3 + 1]); for (const o of org) d = Math.min(d, Math.hypot(webHome[i * 3] - o[0], webHome[i * 3 + 1] - o[1])); _best[i] = d + _jit[i] * 0.08; _bpar[i] = -1; _in[i] = 0; }
    let maxD = 1;
    for (let it = 0; it < WN; it++) { let bi = -1, bd = 1e9; for (let i = 0; i < WN; i++) if (!_in[i] && _best[i] < bd) { bd = _best[i]; bi = i; } _in[bi] = 1; webPar[bi] = _bpar[bi]; _dep[bi] = _bpar[bi] < 0 ? 1 : Math.min(250, _dep[_bpar[bi]] + 1); if (_dep[bi] > maxD) maxD = _dep[bi];
      for (let k = 0; k < WN; k++) if (!_in[k]) { const d = Math.hypot(webHome[bi * 3] - webHome[k * 3], webHome[bi * 3 + 1] - webHome[k * 3 + 1], (webHome[bi * 3 + 2] - webHome[k * 3 + 2]) * 0.5) + _jit[k] * 0.08; if (d < _best[k]) { _best[k] = d; _bpar[k] = bi; } } }
    for (let i = 0; i < WN; i++) webIg[i] = _dep[i] / maxD * 0.9;
  } else for (let i = 0; i < WN; i++) webIg[i] = _cl[i] >= 0 ? 0.1 + cl[_cl[i]].rank / nCl * 0.6 + _jit[i] * 0.12 : 0.2 + _jit[i] * 0.7;
  for (let i = 0; i < hubN; i++) webIg[i] = Math.min(webIg[i], 0.03 + _jit[i] * 0.05); // hubs light first
  genXr(rng);
}

const webG = new THREE.Group(); webG.visible = false; core.add(webG);
const wPG = new THREE.BufferGeometry(); wPG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(WN * 3), 3)); wPG.setAttribute('aC', new THREE.BufferAttribute(new Float32Array(WN * 4), 4)); wPG.setAttribute('aS', new THREE.BufferAttribute(new Float32Array(WN * 2), 2));
const webPts = new THREE.Points(wPG, new THREE.ShaderMaterial({
  uniforms: { ...U, uSize: { value: 0.034 } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  vertexShader: `attribute vec4 aC; attribute vec2 aS; varying vec4 vC; uniform float uPx,uSize; void main(){ vC=aC; vec4 mv=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*mv; gl_PointSize=max(3.,uSize*aS.x*uPx/-mv.z); }`,
  fragmentShader: `varying vec4 vC; void main(){ vec2 p=gl_PointCoord-.5; float d=length(p); float glow=exp(-d*d*70.)*.8; float cr=(exp(-abs(p.x)*55.)*exp(-abs(p.y)*6.)+exp(-abs(p.y)*55.)*exp(-abs(p.x)*6.))*.9; float hot=exp(-d*d*900.)*1.6; gl_FragColor=vec4(vC.rgb*(glow+cr)+vec3(1.,.9,.7)*vC.a*hot*0.6*dot(vC.rgb,vec3(.33)),1.); }`,
})); wPG.setDrawRange(0, WN); webPts.frustumCulled = false; webPts.renderOrder = 7; webG.add(webPts);
const wLG = new THREE.BufferGeometry(); wLG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(WL * 6), 3)); wLG.setAttribute('color', new THREE.BufferAttribute(new Float32Array(WL * 6), 3));
const webLines = new THREE.LineSegments(wLG, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })); webLines.frustumCulled = false; webLines.renderOrder = 6; webG.add(webLines);
const alive = new Int16Array(WN), deg = new Uint8Array(WN), webCol = [1, 0.5, 0.1], lineA = new Int16Array(WL), lineB = new Int16Array(WL);
const GX = 18, GY = 11, CELL = 0.36, gridHead = new Int16Array(GX * GY), gridNext = new Int16Array(WN), cellOf = new Int16Array(WN);
const SPN = 40, spA = new Int16Array(SPN), spB = new Int16Array(SPN), spT = new Float32Array(SPN).fill(2), spV = new Float32Array(SPN);
const sPG = new THREE.BufferGeometry(); sPG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPN * 3), 3)); sPG.setAttribute('aC', new THREE.BufferAttribute(new Float32Array(SPN * 4), 4)); sPG.setAttribute('aS', new THREE.BufferAttribute(new Float32Array(SPN * 2).fill(1.3), 2));
const sparkPts = new THREE.Points(sPG, webPts.material); sparkPts.frustumCulled = false; sparkPts.renderOrder = 8; webG.add(sparkPts);

function putLine(la, n, pa, i, j) { const o = n * 6; la[o] = pa[i * 3]; la[o + 1] = pa[i * 3 + 1]; la[o + 2] = pa[i * 3 + 2]; la[o + 3] = pa[j * 3]; la[o + 4] = pa[j * 3 + 1]; la[o + 5] = pa[j * 3 + 2]; }
function syncWeb(wg) {
  webG.visible = wg > 0.003; if (!webG.visible) return;
  const pa = wPG.attributes.position.array, ca = wPG.attributes.aC.array, sa = wPG.attributes.aS.array, la = wLG.attributes.position.array, lc = wLG.attributes.color.array;
  const wc = lin(mix(pal.core, pal.hot, 0.35), 1); webCol[0] = wc[0]; webCol[1] = wc[1]; webCol[2] = wc[2];
  const sm = ease(wg), sk = ease(recv.sk), nAct = recv.nodes, hubN = recv.hubN, spk = recv.sparkle, TH = recv.th, bri = recv.briK, szk = recv.sizeK, sm0 = recv.settleMode; let na = 0;
  const s = sm0 === 0 ? 0.2 + 0.8 * sm : (0.9 + 0.1 * sm) * (sm0 === 2 ? 1 + 0.5 * sk : 1), dv = sm0 === 2 ? sk * 0.45 : 0; // settle: 0 collapse into the core, 1 fade in place, 2 drift away
  gridHead.fill(-1);
  for (let i = 0; i < WN; i++) {
    const ph = webPh[i], a = i < nAct ? clamp((wg * 1.25 - webIg[i]) * 5, 0, 1) : 0, hub = i < hubN, hx = webHome[i * 3], hy = webHome[i * 3 + 1], hz = webHome[i * 3 + 2];
    // living plexus: nodes drift on a smooth analytic flow field, so proximity lines form and break
    const fx = Math.sin(T * 0.19 + hy * 1.9 + ph * 6.28) * 0.035 + Math.sin(T * 0.11 + hx * 2.3 - hy) * 0.022, fy = Math.cos(T * 0.17 + hx * 1.7 + ph * 9.1) * 0.035 + Math.cos(T * 0.13 + hy * 2.1 + hx) * 0.022;
    const x = hx * s + fx + webDr[i * 2] * dv, y = hy * s + fy + webDr[i * 2 + 1] * dv, z = hz * s; pa[i * 3] = x; pa[i * 3 + 1] = y; pa[i * 3 + 2] = z;
    const tw = (0.65 + 0.35 * Math.sin(T * (2 + ph * 3) + ph * 20)) * a * (hub ? 1.7 : 1.0) * 1.5 * bri * (1 + spk * 1.2 * (0.5 + 0.5 * Math.sin(T * 9 + ph * 40)));
    ca[i * 4] = webCol[0] * tw; ca[i * 4 + 1] = webCol[1] * tw; ca[i * 4 + 2] = webCol[2] * tw; ca[i * 4 + 3] = a; sa[i * 2] = (hub ? 2.3 : webSz[i]) * szk; sa[i * 2 + 1] = ph;
    if (a > 0.02) { alive[na++] = i; const c = clamp(((y + 1.9) / CELL) | 0, 0, GY - 1) * GX + clamp(((x + 2.6) / CELL) | 0, 0, GX - 1); cellOf[i] = c; gridNext[i] = gridHead[c]; gridHead[c] = i; }
  }
  deg.fill(0); let nl = 0;
  for (let q = 0; q < na && nl < WL; q++) { // tree edges (tendrils) first
    const i = alive[q], p = webPar[i]; if (p < 0 || ca[p * 4 + 3] < 0.02) continue; const dx = pa[i * 3] - pa[p * 3], dy = pa[i * 3 + 1] - pa[p * 3 + 1]; if (dx * dx + dy * dy > 0.5) continue;
    const f = 0.6 * Math.min(ca[i * 4 + 3], ca[p * 4 + 3]) * 1.7; putLine(la, nl, pa, i, p);
    for (let c = 0; c < 2; c++) { lc[nl * 6 + c * 3] = webCol[0] * f; lc[nl * 6 + c * 3 + 1] = webCol[1] * f; lc[nl * 6 + c * 3 + 2] = webCol[2] * f; } lineA[nl] = i; lineB[nl] = p; nl++;
  }
  const th2 = TH * TH, cap = recv.degCap;
  for (let q = 0; q < na && nl < WL; q++) { // proximity edges via a uniform grid (3x3 cell neighbourhood)
    const i = alive[q]; if (deg[i] >= cap) continue; const c0 = cellOf[i], cx = c0 % GX, cy = (c0 / GX) | 0;
    for (let oy = -1; oy <= 1 && nl < WL; oy++) { const yy = cy + oy; if (yy < 0 || yy >= GY) continue;
      for (let ox = -1; ox <= 1; ox++) { const xx = cx + ox; if (xx < 0 || xx >= GX) continue;
        for (let j = gridHead[yy * GX + xx]; j >= 0 && nl < WL; j = gridNext[j]) { if (j <= i || deg[j] >= cap || deg[i] >= cap) continue;
          const dx = pa[i * 3] - pa[j * 3], dy = pa[i * 3 + 1] - pa[j * 3 + 1], dz = pa[i * 3 + 2] - pa[j * 3 + 2], d2 = dx * dx + dy * dy + dz * dz; if (d2 > th2) continue;
          const f = (1 - Math.sqrt(d2) / TH) * Math.min(ca[i * 4 + 3], ca[j * 4 + 3]) * 1.7; deg[i]++; deg[j]++;
          putLine(la, nl, pa, i, j);
          for (let c = 0; c < 2; c++) { lc[nl * 6 + c * 3] = webCol[0] * f; lc[nl * 6 + c * 3 + 1] = webCol[1] * f; lc[nl * 6 + c * 3 + 2] = webCol[2] * f; } lineA[nl] = i; lineB[nl] = j; nl++; } } }
  }
  // sparks travelling along random lines toward the core
  const spp = sPG.attributes.position.array, spc = sPG.attributes.aC.array;
  for (let k = 0; k < SPN; k++) {
    if (spT[k] >= 1 && nl > 0) { let a = lineA[(Math.random() * nl) | 0], b = lineB[(Math.random() * nl) | 0]; const l = (Math.random() * nl) | 0; a = lineA[l]; b = lineB[l]; if (Math.hypot(pa[b * 3], pa[b * 3 + 1]) > Math.hypot(pa[a * 3], pa[a * 3 + 1])) { const t = a; a = b; b = t; } spA[k] = a; spB[k] = b; spT[k] = -Math.random() * 0.8; spV[k] = 0.5 + Math.random() * 0.9; }
    spT[k] += curAdt * spV[k] * (1 + spk); const t = clamp(spT[k], 0, 1), on = spT[k] >= 0 && spT[k] < 1 && ca[spA[k] * 4 + 3] > 0.05 && ca[spB[k] * 4 + 3] > 0.05;
    const i = spA[k], j = spB[k]; spp[k * 3] = lerp(pa[i * 3], pa[j * 3], t); spp[k * 3 + 1] = lerp(pa[i * 3 + 1], pa[j * 3 + 1], t); spp[k * 3 + 2] = lerp(pa[i * 3 + 2], pa[j * 3 + 2], t);
    const b = on ? Math.sin(Math.PI * t) * 2.4 : 0; spc[k * 4] = webCol[0] * b; spc[k * 4 + 1] = webCol[1] * b; spc[k * 4 + 2] = webCol[2] * b; spc[k * 4 + 3] = b > 0 ? 1 : 0;
  }
  sPG.attributes.position.needsUpdate = sPG.attributes.aC.needsUpdate = true;
  wLG.setDrawRange(0, nl * 2); wLG.attributes.position.needsUpdate = wLG.attributes.color.needsUpdate = true; wPG.attributes.position.needsUpdate = wPG.attributes.aC.needsUpdate = wPG.attributes.aS.needsUpdate = true;
}
function setRingU(x, r, th, a0, span, rot, col, int, alpha, tiltK) {
  if (!x.obj || x.objN !== x.nSeg) buildRingObj(x); const u = x.obj.material.uniforms;
  u.uColor.value.set(col[0], col[1], col[2]); u.uInt.value = int; u.uAlpha.value = alpha; u.uR.value = r; u.uTh.value = th; u.uA0.value = a0; u.uSpan.value = span; u.uRot.value = rot; u.uK.value = span > TAU - 0.05 ? 1 : clamp(span / TAU, 0.22, 1);
  u.uSel.value = 0; u.uBlink.value = 1; u.uErr.value = 0; u.uWarn.value = 0; u.uJit.value = 0; x.obj.rotation.set(x.tilt[0] * tiltK, x.tilt[1] * tiltK, 0); x.obj.visible = alpha > 0.01;
}
function syncExtras(ex, triK) {
  const e = ease(clamp(ex, 0, 1)); const chot = pal.hot, cc = pal.core;
  // idle corner arcs (fade with the triangle)
  for (const c of cornerArcs) { const k = triK * (mode === 0 || mode === 1 ? 1 : 0.5); setRingU(c, c.r, 0.0042, c.a0, c.span, Math.sin(T * 0.2 + c.v + c.j) * 0.03, lin(mix(cc, pal.dim, 0.5), 1), 0.75 + 0.12 * Math.sin(T * 1.3 + c.j), clamp(k, 0, 1) * 0.9, 1); }
  // expansion rings: chunky segmented dashes at different speeds
  xr.forEach((x, i) => {
    if (e < 0.01 || !x.on) { if (x.obj) x.obj.visible = false; return; }
    x.rot += x.dir * x.speed * curAdt * (0.6 + e); const rr = 0.50 + i * 0.05 + x.rOff + 0.008 * Math.sin(T * 0.6 + i);
    setRingU(x, rr, (0.009 + 0.0018 * ((i * 3) % 5)) * x.thK, 0, x.span, x.rot, lin(mix(cc, chot, 0.12 + 0.5 * x.colT), 1), 0.5 + 0.8 * e * (0.8 + 0.2 * Math.sin(T * 2 + i)), e * (0.65 + 0.35 * x.colT), 1);
  });
  // red marker beside the core
  marker.visible = e > 0.02; if (marker.visible) setC(markerMat, lin(pal.frame, 3.4 * e * (0.8 + 0.2 * Math.sin(T * 5))));
}

/* ----- sub-agent glow points ----- */
const MAXSA = 16 * 8 + 16;
const saGeo = new THREE.BufferGeometry(); saGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXSA * 3), 3)); saGeo.setAttribute('aC', new THREE.BufferAttribute(new Float32Array(MAXSA * 4), 4)); saGeo.setDrawRange(0, 0);
const pointVS = `attribute vec4 aC; varying vec4 vC; uniform float uPx, uSize; void main(){ vC=aC; vec4 mv=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*mv; gl_PointSize=max(2.,uSize*uPx/-mv.z); }`;
const pointFS = `varying vec4 vC; void main(){ float d=length(gl_PointCoord-.5); if(d>.5) discard; float a=smoothstep(.5,0.,d); gl_FragColor=vec4(vC.rgb*(a*a*1.2+pow(a,8.)*2.2)*vC.a, 1.); }`;
const saPts = new THREE.Points(saGeo, new THREE.ShaderMaterial({ uniforms: { ...U, uSize: { value: 0.016 } }, vertexShader: pointVS, fragmentShader: pointFS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); saPts.frustumCulled = false; saPts.renderOrder = 5; core.add(saPts);

/* ----- dust / ember particles (GPU) ----- */
const NP = 4200;
const pGeo = new THREE.BufferGeometry(); { const p = new Float32Array(NP * 3), q = new Float32Array(NP * 4); for (let i = 0; i < NP; i++) { p[i * 3] = (hash(i, 1) - 0.5) * 3.0; p[i * 3 + 1] = (hash(i, 2) - 0.5) * 2.6; p[i * 3 + 2] = (hash(i, 3) - 0.5) * 1.0 + 0.05; q[i * 4] = hash(i, 4); q[i * 4 + 1] = hash(i, 5); q[i * 4 + 2] = hash(i, 6); q[i * 4 + 3] = hash(i, 7); } pGeo.setAttribute('position', new THREE.BufferAttribute(p, 3)); pGeo.setAttribute('aR', new THREE.BufferAttribute(q, 4)); }
const dust = new THREE.Points(pGeo, new THREE.ShaderMaterial({
  uniforms: { ...U }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  vertexShader: `attribute vec4 aR; uniform float uTime,uPull,uPx,uAct; uniform vec3 uCore,uHot; uniform vec2 uCoreP; varying vec3 vCol;
  void main(){
    vec3 p=position; float sp=0.018+0.05*aR.x;
    p.y=mod(p.y+uTime*sp+1.3,2.6)-1.3; p.x+=sin(uTime*0.13+aR.y*6.283)*0.07; p.z+=sin(uTime*0.09+aR.y*9.)*0.06;
    vec2 c=p.xy-uCoreP; float rr=length(c);
    float ang=uPull*1.1*smoothstep(1.5,0.1,rr); float cs=cos(ang), sn=sin(ang); c=mat2(cs,-sn,sn,cs)*c; c*=1.-uPull*0.5*smoothstep(1.4,0.12,rr);
    rr=length(c); p.xy=c+uCoreP;
    bool inside = c.y<0.5 && abs(c.x)*1.732<c.y+1.0;
    float tw=0.5+0.5*sin(uTime*1.3+aR.y*40.);
    float a=(inside?1.:0.32)*(0.35+0.65*tw)*(0.45+0.55*aR.w);
    vCol=mix(uCore,uHot,aR.w*0.55)*a*(0.9+2.6*uAct*exp(-rr*3.));
    vec4 mv=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv; gl_PointSize=max(1.,(0.0016+0.0034*aR.z)*uPx/-mv.z*(inside?1.:0.8));
  }`,
  fragmentShader: `varying vec3 vCol; void main(){ float d=length(gl_PointCoord-.5); if(d>.5) discard; float a=smoothstep(.5,.0,d); gl_FragColor=vec4(vCol*a*a,1.); }`,
}));
dust.frustumCulled = false; dust.renderOrder = 6; world.add(dust);

/* ----- NEURAL group: agent-type nodes ----- */
const sphereMat = (col) => new THREE.ShaderMaterial({
  uniforms: { uCol: { value: new THREE.Vector3(...col) }, uCorePos: { value: new THREE.Vector3() }, uA: { value: 1 }, uEm: { value: 0.25 } }, transparent: true,
  vertexShader: `varying vec3 vN, vW; void main(){ vN=mat3(modelMatrix)*normal; vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `varying vec3 vN, vW; uniform vec3 uCol,uCorePos; uniform float uA,uEm;
  void main(){ vec3 N=normalize(vN); vec3 L=normalize(uCorePos-vW); vec3 V=normalize(cameraPosition-vW); float l=max(dot(N,L),0.); float rim=pow(1.-max(dot(N,V),0.),2.5); vec3 H=normalize(L+V); float sp=pow(max(dot(N,H),0.),40.);
    vec3 c=uCol*(uEm+1.15*l)+uCol*rim*1.4+vec3(1.,.95,.9)*sp*0.8; gl_FragColor=vec4(c*uA, uA); }`,
});
const nodeNames = [], mdlNames = [];
const neuralG = new THREE.Group(); core.add(neuralG);
const NN = 8; const nodes = Array.from({ length: NN }, (_, i) => {
  const mat = sphereMat([1, 0.5, 0.1]); const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), mat); mesh.renderOrder = 4;
  const halo = new THREE.Sprite(spriteMat(1)); halo.renderOrder = 3;
  const shell = new THREE.Mesh(new THREE.RingGeometry(1.35, 1.45, 48, 1, 0, 4.2), hdr(1, { transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(32 * 3), 3));
  const link = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })); link.frustumCulled = false;
  neuralG.add(mesh, halo, shell, link); return { mesh, halo, shell, link, mat, pts: [] };
});
const nPulseGeo = new THREE.BufferGeometry(); nPulseGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NN * 4 * 3), 3)); nPulseGeo.setAttribute('aC', new THREE.BufferAttribute(new Float32Array(NN * 4 * 4), 4));
const nPulse = new THREE.Points(nPulseGeo, new THREE.ShaderMaterial({ uniforms: { ...U, uSize: { value: 0.008 } }, vertexShader: pointVS, fragmentShader: pointFS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); nPulse.frustumCulled = false; neuralG.add(nPulse);

/* ----- PULSE group ----- */
const pulseG = new THREE.Group(); core.add(pulseG);
const pulseState = { key: null, items: [], guides: null, needle: null };
function addLineMat(opts = {}) { return new THREE.LineBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, ...opts }); }
const pulseGuideMat = addLineMat();
{ const g = new THREE.Group(); const circ = (r) => { const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 120 }, (_, i) => new THREE.Vector3(Math.cos((i / 120) * TAU) * r, Math.sin((i / 120) * TAU) * r, 0))), pulseGuideMat); return l; };
  pulseState.guides = g; pulseG.add(g); pulseState.circ = circ; }
const needleGeo = new THREE.BufferGeometry(); needleGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(30 * 2 * 3), 3)); needleGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(30 * 2 * 3), 3));
const needle = new THREE.LineSegments(needleGeo, addLineMat({ vertexColors: true })); needle.frustumCulled = false; pulseG.add(needle);

/* ----- MODELS group ----- */
const modelsG = new THREE.Group(); core.add(modelsG);
const mdl = Array.from({ length: 8 }, () => {
  const mat = sphereMat([1, 1, 1]); const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 24), mat); mesh.renderOrder = 4;
  const halo = new THREE.Sprite(spriteMat(1)); halo.renderOrder = 3;
  const orbit = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 128 }, (_, i) => new THREE.Vector3(Math.cos((i / 128) * TAU), Math.sin((i / 128) * TAU), 0))), addLineMat());
  modelsG.add(mesh, halo, orbit); return { mesh, halo, orbit, mat };
});

/* ----- post-processing ----- */
const FinishShader = {
  uniforms: { tDiffuse: { value: null }, uLift: { value: new THREE.Vector3() }, uTime: { value: 0 }, uVig: { value: 0.62 }, uGrain: { value: 0.028 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `varying vec2 vUv; uniform sampler2D tDiffuse; uniform float uTime,uVig,uGrain; uniform vec2 uRes; uniform vec3 uLift;
  float hh(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
  void main(){ vec2 c=vUv-.5; float d=dot(c,c); vec2 off=c*d*0.014;
    vec3 col=vec3(texture2D(tDiffuse,vUv+off).r, texture2D(tDiffuse,vUv).g, texture2D(tDiffuse,vUv-off).b);
    col+=uLift*(1.-smoothstep(0.,0.55,dot(col,vec3(0.333))));
    float r=length(c)*1.414; col*=1.-uVig*smoothstep(0.38,1.1,r);
    col+=(hh(vUv*uRes+fract(uTime)*91.)-.5)*uGrain;
    gl_FragColor=vec4(col,1.); }`,
};
let composer, bloom, finish;
const rtMS = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
composer = new EffectComposer(renderer, rtMS);
composer.addPass(new RenderPass(scene, camera));
bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.5, 0.5, 0.85); composer.addPass(bloom);
composer.addPass(new OutputPass());
finish = new ShaderPass(FinishShader); composer.addPass(finish);
const BLOOM = { base: 0.5, radius: 0.5, thr: 0.85 };

const G = { W: 1, H: 1, dpr: 1, camD: 2.6, pxu: 800 };
function resize() {
  G.dpr = Math.min(window.devicePixelRatio || 1, 2); G.W = innerWidth; G.H = innerHeight;
  renderer.setPixelRatio(G.dpr); renderer.setSize(G.W, G.H, false); composer.setPixelRatio(G.dpr); composer.setSize(G.W, G.H);
  camera.aspect = G.W / G.H; camera.updateProjectionMatrix(); finish.uniforms.uRes.value.set(G.W * G.dpr, G.H * G.dpr);
}

/* ============================================================ per-frame update */
const hudEls = { tok: $('hTokens'), cost: $('hCost'), cache: $('hCache'), ag: $('hAgents'), ses: $('hSess'), home: $('hHome'), scan: $('hScan'), link: $('hLink'), mode: $('hMode'), pal: $('hPal'), iss: $('hIssues'), wait: $('hWait') };
const v3 = (x, y, z = 0) => new THREE.Vector3(x, y, z);
const wl = (x, y, z = 0, obj = core) => obj.localToWorld(new THREE.Vector3(x, y, z));
const _c = new THREE.Color(), _o = new THREE.Object3D(), _v = new THREE.Vector3();
const setC = (m, c) => { m.color.setRGB(c[0], c[1], c[2]); };
let camX = 0, camY = 0;

function update(dt, adt) {
  const k = 1 - Math.exp(-dt / 0.22);
  for (let m = 0; m < 5; m++) mw[m] += ((m === mode ? 1 : 0) - mw[m]) * k;
  zoomCur += (zoom - zoomCur) * (1 - Math.exp(-dt / 0.15));
  const P = PALETTES[palIdx], kp = 1 - Math.exp(-dt / 0.25);
  for (const key of PAL_KEYS) for (let i = 0; i < 3; i++) pal[key][i] += (P[key][i] - pal[key][i]) * kp;
  pal.grain += (P.grain - pal.grain) * kp;
  { const tb = palIdx === 1 ? [255, 255, 255] : palIdx === 2 ? [190, 255, 225] : [170, 238, 255]; for (let i = 0; i < 3; i++) beac[i] += (tb[i] - beac[i]) * kp; document.documentElement.style.setProperty('--bc', beac.map(Math.round).join(',')); }
  document.documentElement.style.setProperty('--f', pal.frame.map(Math.round).join(',')); document.documentElement.style.setProperty('--c', pal.core.map(Math.round).join(','));
  if (recv.on || view.ex > 0.001) { // advance the receiving envelope
    let e = 0, w = 0; if (recv.on) { if (!recv.frozen) recv.t += dt; const p = recv.t / recv.dur; if (p >= 1) { recv.on = false; } else { e = envE(p) * recv.peak; w = envW(p); } }
    if (recv.frozen) { const f = recv.phase; e = recv.peak * ease(clamp((f - 0.05) / 0.55, 0, 1)); w = ease(clamp(f * 1.4, 0, 1)); }
    view.ex += (e - view.ex) * (1 - Math.exp(-dt / (recv.frozen ? 0.01 : 0.18))); view.wg = w; if (!recv.on && view.ex < 0.002) view.ex = 0;
    recv.sk = recv.on && !recv.frozen ? clamp((recv.t / recv.dur - 0.62) / 0.38, 0, 1) : 0;
  } else view.wg = 0;
  recv.sparkle = Math.max(0, recv.sparkle - dt * 0.7);
  const exM = mode === 0 ? view.ex : 0;
  const cT = mode === 0 ? 1 + 0.2 * exM : mode === 1 ? 1 : 0.55, dT = mode === 0 ? 0.40 * (1 + 0.2 * exM) : mode === 1 ? 0.40 : 0.225;
  view.cs += (cT - view.cs) * k; view.dialR += (dT - view.dialR) * k; view.fiberA += ((mode === 0 ? 1 : mode === 1 ? 0.15 : 0.5) - view.fiberA) * k;
  const ak = 1 - Math.exp(-dt * (view.actT > view.act ? 1.6 : 0.25)); view.act += (view.actT - view.act) * ak;
  for (let i = 0; i < 3; i++) { view.g[i] += (view.gT[i] - view.g[i]) * (1 - Math.exp(-dt / 0.6)); view.tint[i] += ((view.tintT[i] || 0) - view.tint[i]) * kp; }
  const n = rings.length, cs = cT;
  const total = rings.reduce((a, r) => a + 0.5 + r.nl * 1.5, 0) || 1; const rIn = 0.10, rOut = 0.37, gap = 0.005; const avail = rOut - rIn - gap * Math.max(0, n - 1);
  const memGap = 0.004, memW = (i) => 0.25 + (n > 1 ? i / (n - 1) : 0), memSum = rings.reduce((a, _, i) => a + memW(i), 0) || 1, memAvail = 0.38 - 0.095 - memGap * Math.max(0, n - 1);
  let acc = rIn, memEdge = 0.095; // memory mode: inner rings thin and tight, outer rings taller bars with more room
  rings.forEach((r, i) => {
    const w = 0.5 + r.nl * 1.5, thc = (avail * w) / total; const rc = acc + thc / 2; acc += thc + gap;
    let tr, tth, ta0, tsp, tal, trw;
    if (mode === 1) { tth = memAvail * memW(i) / memSum; tr = memEdge + tth * 0.5; memEdge = tr + tth * 0.5 + memGap; ta0 = -Math.PI / 2 + i * 1.05; tsp = 0.9 + 1.7 * r.nl; tal = 0.95; trw = 0.03; }
    else { tr = rc * cs; tth = thc * cs; ta0 = 0; tsp = TAU; tal = mode === 0 ? 1 : 0.6; trw = 1; }
    r.r += (tr - r.r) * k; r.th += (tth - r.th) * k; r.a0 += (ta0 - r.a0) * k; r.span += (tsp - r.span) * k; r.alpha += (tal - r.alpha) * k; r.rotW += (trw - r.rotW) * k;
    const s = r.s; const rec = Math.exp(-(Date.now() - new Date(s.last).getTime()) / 21600000);
    r.speed = (0.04 + 0.22 * rec + (s.isActive ? 0.18 : 0)) * (1 + 2.2 * exM) * (1 - 0.55 * r.idleK); // idle = calm
    r.rot += r.dir * r.speed * adt * (1 - r.waitK);
    r.act += ((s.isActive ? 1 : 0) - r.act) * k;
    r.selK += ((i === sel ? 1 : 0) - r.selK) * (1 - Math.exp(-dt / 0.12)); r.hovK += ((i === hover ? 1 : 0) - r.hovK) * (1 - Math.exp(-dt / 0.1));
    r.idleK += ((r.s.live && r.s.live.status === 'idle' ? 1 : 0) - r.idleK) * k;
    r.waitK += ((r.wait && !r.wait.gone ? (r.wait.w.confidence === 'certain' ? 1 : 0.55) : 0) - r.waitK) * k;
    r.errK = (r.errK || 0) + ((r.sev === 2 ? 1 : 0) - (r.errK || 0)) * k; r.warnK = (r.warnK || 0) + ((r.sev === 1 ? 1 : 0) - (r.warnK || 0)) * k;
  });
  for (let i = ghosts.length - 1; i >= 0; i--) { const g = ghosts[i]; g.alpha -= dt * 1.2; g.rot += g.dir * 0.05 * adt; if (g.alpha <= 0.01) { killRingObj(g); ghosts.splice(i, 1); } }
  // camera: lissajous drift + mouse parallax + zoom
  mouse.sx = (mouse.sx || 0) + (mouse.nx - (mouse.sx || 0)) * (1 - Math.exp(-dt / 0.35)); mouse.sy = (mouse.sy || 0) + (mouse.ny - (mouse.sy || 0)) * (1 - Math.exp(-dt / 0.35));
  camX = Math.sin(T * 0.11) * 0.10 * motion + mouse.sx * 0.12; camY = Math.cos(T * 0.083) * 0.06 * motion + mouse.sy * 0.07;
  const aspect = G.W / G.H, needH = Math.max(1.8, 2.0 / aspect); G.camD = needH / 2 / FOV_T / zoomCur;
  camera.position.set(camX, camY, G.camD); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  G.pxu = G.H / (2 * G.camD * FOV_T); U.uPx.value = (G.H * G.dpr) / (2 * FOV_T);
  world.rotation.set(-camY * 0.5 - 0.02, camX * 0.45, Math.sin(T * 0.12) * 0.012 * (mode === 0 ? 1 : 1.6));
  U.uTime.value = T;
}

let flick = 1, hb = 0; const beac = [170, 238, 255];
function syncScene(now) {
  const act = Math.max(view.act, 0.8 * view.ex), cs = view.cs;
  flick = 0.93 + 0.05 * Math.sin(T * 23.1) * Math.sin(T * 7.3) + 0.03 * Math.sin(T * 3.1) - (Math.sin(T * 0.7) > 0.985 ? 0.25 : 0);
  { const ph = (T * 0.85) % 1; hb = Math.pow(Math.max(0, Math.sin(ph * Math.PI * 2 * 1.0)), 6) + 0.6 * Math.pow(Math.max(0, Math.sin(ph * Math.PI * 2 - 1.2)), 6); }
  const exv = view.ex; let triK = 1 - 0.93 * ease(clamp((exv - 0.12) / 0.55, 0, 1)); // triangle dissolves as the web densifies
  if (exv > 0.04 && exv < 0.96) triK *= 1 - 0.6 * clamp(exv * (1 - exv) * 4, 0, 1) * (hash(Math.floor(T * 24), 5) < 0.45 ? 1 : 0);
  const fk = flick * triK; frameG.visible = triK > 0.012;
  const F = pal.frame, Hh = pal.hot, tint = mix(view.tint, pal.core, 0.35);
  U.uFrame.value.set(...lin(F)); U.uCore.value.set(...lin(pal.core)); U.uHot.value.set(...lin(Hh)); U.uDim.value.set(...lin(pal.dim)); U.uTint.value.set(...lin(view.tint)); U.uAct.value = Math.min(act, 0.42); U.uBgBase.value.set(...pal.bgBase); U.uBgVein.value.set(...pal.bgVein); U.uGrain.value = pal.grain; finish.uniforms.uLift.value.set(...pal.lift);
  const dim = mode === 0 ? 1 : 0.8;
  setC(mats.tubeOut, neon(F, 2.2 * fk * dim)); setC(mats.tubeIn, neon(F, 1.7 * fk * dim)); setC(mats.white, lin(mix(F, [255, 200, 190], 0.6), 1.7 * fk));
  setC(mats.gaugeBase, lin(F, 0.8 * triK)); setC(mats.rune, lin(F, 1.5 * fk)); setC(mats.gaugeLit, lin(mix(F, Hh, 0.5), 3.2 * fk)); setC(mats.spark, lin([255, 225, 215], 1.6 * fk));
  setC(mats.tick, lin(F, 1.0 * fk)); mats.chev.forEach((m, kk) => setC(m, lin(F, (2.2 - kk * 0.5) * fk * (0.7 + 0.3 * Math.sin(T * 2 - kk * 0.8)))));
  setC(mats.dial, lin(pal.core, 0.5));
  // gauges
  const vi = frames[1].v, vo = frames[0].v;
  gauges.forEach((g, gi) => {
    const A = vi[g.a], B = vi[g.b]; const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, ml = Math.hypot(mx, my); const nx = -mx / ml, ny = -my / ml, off = 0.028;
    const P = (t) => v3(lerp(A.x, B.x, t) + nx * off, lerp(A.y, B.y, t) + ny * off, -0.045);
    const t0 = 0.07, t1 = 0.93, val = view.g[gi], f = clamp(val, 0, 1), te = lerp(t0, t1, f);
    setSeg(g.base_, P(t0), P(t1)); g.base_.scale.x = g.base_.scale.z = 0.0022;
    if (f > 0.002) { setSeg(g.lit, P(t0), P(te)); g.lit.scale.x = g.lit.scale.z = 0.0068; g.lit.visible = g.dot.visible = true; g.dot.position.copy(P(te)); g.dot.scale.setScalar(0.0105 + 0.0035 * Math.sin(T * 4 + gi)); } else g.lit.visible = g.dot.visible = false;
  });
  sparks.forEach((m, e) => { const A = vo[e], B = vo[(e + 1) % 3]; const t = (T * 0.05 + e / 3) % 1, t2 = Math.min(1, t + 0.05); setSeg(m, new THREE.Vector3().lerpVectors(A, B, t), new THREE.Vector3().lerpVectors(A, B, t2)); m.scale.x = m.scale.z = 0.006; m.position.z += 0.002; });
  // pupil / plasma
  const breath = Math.sin(T * 0.9) * 0.09 * (1 - act * 0.4);
  const rp = 0.07 * (0.7 + 0.3 * cs) * (1 + breath + act * 0.14); view.pupil = rp;
  plasmaMat.uniforms.uR0.value = 0.46 * (0.55 + 0.45 * cs) * (1 + 0.025 * Math.sin(T * 0.9)); plasmaMat.uniforms.uPupil.value = rp; plasmaMat.uniforms.uFiber.value = view.fiberA;
  pupilMesh.scale.setScalar(rp * 1.01); rim.scale.setScalar(rp * 1.04); glint.scale.setScalar(rp * 1.04);
  setC(rimMat, lin(mix(pal.core, tint, 0.3), (0.9 + 1.1 * Math.min(act, 0.42)) * flick)); setC(glintMat, lin(mix(pal.core, Hh, 0.3), 1.2)); voidMesh.scale.setScalar(rp * 2.1);
  // shock waves
  const nowS = performance.now() / 1000; const arr = shockMat.uniforms.uS.value;
  for (let i = shocks.length - 1; i >= 0; i--) if ((nowS - shocks[i]) / 2.4 > 1) shocks.splice(i, 1);
  for (let i = 0; i < 5; i++) arr[i] = i < shocks.length ? (nowS - shocks[i]) / 2.4 : 2; shockMat.uniforms.uPupil.value = rp;
  // hour ticks + clock
  const dR = view.dialR, nd = new Date(), curH = nd.getHours(); const fh = nd.getMinutes() + nd.getSeconds() / 60 + nd.getMilliseconds() / 6e4; // minute hand position (0..60)
  const ch = clockHours(); let mxh = 1; for (const c of ch) if (c.calls > mxh) mxh = c.calls; clockStripes.length = 0;
  setC(hourMat, lin(pal.core, 2.0 * flick)); const cH = lin(Hh, 3.2), cC = lin(pal.core, 2.0);
  ch.forEach((c, i) => {
    const th = Math.PI / 2 - (c.pos / 12) * TAU, v = c.calls / mxh, cur = c.k === 0; let len = 0.01 + 0.04 * Math.sqrt(v); if (cur) { len = (0.045 + 0.04 * Math.sqrt(v)) * (1 + 0.05 * Math.sin(T * 4)); hourCap.position.set(Math.cos(th) * (dR + len + 0.004), Math.sin(th) * (dR + len + 0.004), 0.003); const la = hourLine.geometry.attributes.position.array, r0 = view.pupil * 1.5; la[0] = Math.cos(th) * r0; la[1] = Math.sin(th) * r0; la[3] = Math.cos(th) * dR; la[4] = Math.sin(th) * dR; hourLine.geometry.attributes.position.needsUpdate = true; }
    _o.position.set(Math.cos(th) * (dR + len / 2), Math.sin(th) * (dR + len / 2), 0); _o.rotation.set(0, 0, th - Math.PI / 2); _o.scale.set(cur ? 0.0075 : 0.0038, len, 0.005); _o.updateMatrix(); hourTicks.setMatrixAt(i, _o.matrix);
    const b = cur ? 1 : 0.28 + 0.72 * Math.pow(1 - c.k / 12, 1.5); // recent = brighter, fading toward 12h ago
    _c.setRGB((cur ? cH[0] / cC[0] : 1) * b, (cur ? cH[1] / cC[1] : 1) * b, (cur ? cH[2] / cC[2] : 1) * b); hourTicks.setColorAt(i, _c);
    clockStripes.push({ x: Math.cos(th) * (dR + len / 2), y: Math.sin(th) * (dR + len / 2), str: `${String(c.hour).padStart(2, '0')}:00–${String((c.hour + 1) % 24).padStart(2, '0')}:00 · ${Math.round(c.calls)} calls · ${fmtCost(c.cost)}` });
  });
  hourTicks.instanceMatrix.needsUpdate = true; hourTicks.instanceColor.needsUpdate = true;
  setC(hourCap.material, lin(Hh, 3.0)); setC(hourLine.material, lin(pal.core, 0.35)); minuteTicks.scale.setScalar(dR - 0.002 + 0.003 * Math.sin(T * 0.9 - 0.9)); setC(mats.min, lin(pal.core, 0.22));
  dialLine.scale.setScalar(dR - 0.002);
  { const th = Math.PI / 2 - (fh / 60) * TAU, rr = dR - 0.002; clockState.x = Math.cos(th) * rr; clockState.y = Math.sin(th) * rr; clockState.str = String(curH).padStart(2, '0') + ':' + String(nd.getMinutes()).padStart(2, '0');
    const pa = trailGeo.attributes.position.array, ca = trailGeo.attributes.color.array, tc = lin(Hh, 1.5);
    for (let i = 0; i < TRAIL; i++) { const a = th + i * 0.012, f = Math.pow(1 - i / TRAIL, 1.6); pa[i * 3] = Math.cos(a) * rr; pa[i * 3 + 1] = Math.sin(a) * rr; pa[i * 3 + 2] = 0.002; ca[i * 3] = tc[0] * f; ca[i * 3 + 1] = tc[1] * f; ca[i * 3 + 2] = tc[2] * f; }
    trailGeo.attributes.position.needsUpdate = trailGeo.attributes.color.needsUpdate = true;
    clockDot.position.set(clockState.x, clockState.y, 0.004); clockCore.position.copy(clockDot.position); setC(clockDot.material, lin(Hh, 0.55)); setC(clockCore.material, lin([255, 245, 225], 1.6)); }
  // rings
  const nR = rings.length; let saN = 0; const sa = saGeo.attributes.position.array, sc = saGeo.attributes.aC.array; const s1 = ease(clamp(mw[1], 0, 1));
  const doRing = (r, i, ghost) => {
    const t = nR > 1 ? Math.min(1, i / (nR - 1)) : 0;
    r.rect = !ghost && t >= 0.3; // outer memory rings: many small rectangular blocks instead of ovals
    if (!r.obj || r.objN !== r.nSeg || (!ghost && r.objRect !== r.rect)) buildRingObj(r);
    const u = r.obj.material.uniforms; const breathR = Math.sin(T * 0.9 - i * 0.3); // ring breathing, slight phase lag per ring
    let col = mix(mix(pal.core, Hh, 0.1 * (1 - t)), pal.dim, t * 0.7); col = mix(col, view.tint, 0.18 * (1 - t));
    const pulse = 0.5 + 0.5 * Math.sin(T * 3 + i * 0.9); let A = r.alpha * (0.88 - 0.38 * t) * flick;
    A *= (1 + r.act * (0.3 + 0.3 * pulse) + r.hovK * 0.5) * (1 - 0.28 * r.idleK);
    const selv = clamp(r.selK * 0.4 + r.hovK * 0.35, 0, 1);
    const span = Math.min(r.span, TAU);
    u.uColor.value.set(...lin(col, 0.9)); u.uAlpha.value = clamp(r.alpha, 0, 1); u.uInt.value = 0.7 * (0.55 + A * 0.7) + r.selK * 0.9; u.uSel.value = selv;
    u.uR.value = r.r * (1 + 0.012 * breathR); u.uTh.value = Math.max(0.0045, r.th * (span > TAU - 0.05 ? (r.rect ? 0.85 : 1.25) : 1)) * (1 + r.selK * 0.35 + r.waitK * 0.4 + 0.06 * breathR); u.uBlk.value = r.rect ? u.uTh.value * 0.45 : 0; u.uA0.value = r.a0; u.uSpan.value = span; u.uRot.value = r.rot * r.rotW; u.uK.value = span > TAU - 0.05 ? 1 : clamp(span / TAU, 0.22, 1);
    // issues: error = hard red + irregular glitch/blink, warn = slow amber-red pulse
    const ek = r.errK || 0, wk = r.warnK || 0;
    if (ek > 0.01) { const burst = hash(Math.floor(T * 0.9), r.seed * 0.01) > 0.62; const slot = Math.floor(T * (burst ? 19 : 2.6)); const h = hash(slot, r.seed * 0.01 + 3); u.uBlink.value = lerp(1, h < (burst ? 0.5 : 0.1) ? 0.1 : 1.35, ek); u.uDrop.value = burst ? 0.62 : 0.14; u.uJit.value = burst && h < 0.35 ? ek : 0; }
    else { u.uBlink.value = 1; u.uJit.value = 0; u.uDrop.value = 0; }
    u.uWait.value = r.waitK; u.uBeacon.value.set(...lin(beac, 1)); if (r.waitK > 0.01) u.uInt.value *= 1 + 0.9 * hb * r.waitK;
    u.uErr.value = ek; u.uWarn.value = wk * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(T * 1.7 + i)));
    const o = r.obj, tk = r.rect ? 0 : 1; o.rotation.set(r.tilt[0] * (0.7 + 0.3 * Math.sin(T * 0.13 + r.tilt[2])) * (1 - 0.8 * s1) * tk, r.tilt[1] * (0.7 + 0.3 * Math.cos(T * 0.11 + r.tilt[2])) * (1 - 0.8 * s1) * tk, 0); // block rings stay flat and concentric o.position.z = r.rect ? 0 : s1 * (i * 0.014 - 0.1); o.updateMatrix();
    o.visible = r.alpha > 0.02;
    if (ghost) return;
    r.col = col; r.A = A;
    // sub-agent glow points
    const rr = r.r, nsa = Math.min(r.s.subagents || 0, 8); const sol = lin(mix(col, [255, 248, 235], 0.5), 2.2);
    for (let q = 0; q < nsa && saN < MAXSA; q++) {
      const ang = T * (0.5 + 0.12 * q) * -r.dir + q * 2.4 + r.seed; const on = span > TAU - 0.1 || ((ang - (r.a0 + r.rot * r.rotW)) % TAU + TAU) % TAU < span * 1.0;
      if (!on && mode === 1) continue;
      _v.set(Math.cos(ang) * rr, -Math.sin(ang) * rr, 0).applyMatrix4(o.matrix); sa[saN * 3] = _v.x; sa[saN * 3 + 1] = _v.y; sa[saN * 3 + 2] = _v.z;
      const aa = Math.min(1, A) * r.alpha; sc[saN * 4] = sol[0]; sc[saN * 4 + 1] = sol[1]; sc[saN * 4 + 2] = sol[2]; sc[saN * 4 + 3] = aa; saN++;
    }
    // warning glyph
    if (r.sev > 0 && r.alpha > 0.3 && (mw[0] + mw[1]) > 0.4) {
      const ga = span > TAU - 0.05 ? hash(r.i, 5) * TAU : r.a0 + r.rot * r.rotW + span * 0.5, gr = rr + r.th * 0.5 + 0.022; _v.set(Math.cos(ga) * gr, -Math.sin(ga) * gr, 0).applyMatrix4(o.matrix);
      const blink = r.sev === 2 ? (u.uBlink.value > 0.5 ? 1 : 0.25) : 0.55 + 0.45 * Math.sin(T * 2.4 + i);
      label('⚠', core.localToWorld(_v.clone()), blink * (mw[0] + mw[1]) * r.alpha, r.sev === 2 ? [255, 50, 36] : [255, 170, 70], 1.35, { warn: true });
    }
  };
  for (const g of ghosts) doRing(g, nR, true);
  for (let i = 0; i < nR; i++) doRing(rings[i], i, false);
  saGeo.setDrawRange(0, saN); saGeo.attributes.position.needsUpdate = saGeo.attributes.aC.needsUpdate = true;
  // particles
  U.uPull.value = clamp(view.act * 0.9, 0, 1) * 0.9;
  // mode groups
  core.getWorldPosition(_v); sphereMats.forEach((m) => m.uniforms.uCorePos.value.copy(_v));
  syncExtras(view.ex * mw[0], triK); syncWeb(view.wg);
  syncNeural(ease(clamp(mw[2], 0, 1))); syncPulse(ease(clamp(mw[3], 0, 1))); syncModels(ease(clamp(mw[4], 0, 1)));
  // gauge + hour labels
  const s = data.summary, pj = (s && s.projection) || {};
  const gtx = [
    s ? `TODAY ${fmtCost(pj.today ? pj.today.cost : 0)} / PACE ${fmtCost(pj.today && pj.today.pace ? pj.today.pace.cost : 0)}` : 'TODAY -',
    s ? `CACHE ${((s.totals.cacheHit || 0) * 100).toFixed(1)}%` : 'CACHE -',
    s ? `MONTH ${fmtCost(pj.monthToDate ? pj.monthToDate.cost : 0)} / PROJ ${fmtCost(pj.projectedMonth ? pj.projectedMonth.cost : 0)}` : 'MONTH -'];
  gauges.forEach((g, gi) => {
    const A = vi[g.a], B = vi[g.b]; const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, ml = Math.hypot(mx, my), nx = -mx / ml, ny = -my / ml, out = 0.085, val = view.g[gi];
    label(gtx[gi] + (val ? `  ${Math.round(val * 100)}%` : ''), wl(mx - nx * out, my - ny * out, 0, world), 0.9 * triK, mix(F, [255, 255, 255], 0.4), 1, { edge: [wl(A.x, A.y, 0, world), wl(B.x, B.y, 0, world)] });
  });
}
const sphereMats = [...nodes.map((n) => n.mat), ...mdl.map((m) => m.mat)];

function syncNeural(e) {
  neuralG.visible = e > 0.01; if (!neuralG.visible) return;
  const s = data.summary; const ents = s && s.perAgentType ? Object.entries(s.perAgentType).sort((a, b) => b[1].tokens - a[1].tokens).slice(0, NN) : [];
  const maxT = Math.max(1, ...ents.map((x) => x[1].tokens)), n = ents.length, rp = view.pupil;
  const pa = nPulseGeo.attributes.position.array, pc = nPulseGeo.attributes.aC.array; pc.fill(0);
  nodes.forEach((nd, i) => {
    const on = i < n; nd.mesh.visible = nd.halo.visible = nd.shell.visible = nd.link.visible = on; if (!on) return;
    const [name, v] = ents[i]; nodeNames[i] = name; const ang = -Math.PI / 2 + (i / n) * TAU + T * 0.035 + 0.3, orbit = (0.34 + 0.09 * (i % 2)) * e;
    const x = Math.cos(ang) * orbit, y = -Math.sin(ang) * orbit, z = (hash(i, 8) - 0.5) * 0.22 * e; const sz = (0.013 + 0.05 * Math.sqrt(v.tokens / maxT)) * e + 0.002;
    const col = mix(pal.core, mix(pal.dim, pal.hot, hash(i, 5)), 0.55);
    nd.mesh.position.set(x, y, z); nd.mesh.scale.setScalar(sz); nd.mat.uniforms.uCol.value.set(...lin(mix(col, [255, 255, 245], 0.15), 1.5)); nd.mat.uniforms.uA.value = e;
    const pulse = 1 + 0.12 * Math.sin(T * 2.5 + i); nd.halo.position.copy(nd.mesh.position); nd.halo.scale.setScalar(sz * 7 * pulse); setC(nd.halo.material, lin(col, 0.75 * e));
    nd.shell.position.copy(nd.mesh.position); nd.shell.scale.setScalar(sz); nd.shell.rotation.z = T * 0.6 + i; setC(nd.shell.material, lin(col, 3 * e));
    const sx = Math.cos(ang) * rp * 1.1, sy = -Math.sin(ang) * rp * 1.1, cx = (sx + x) / 2 - Math.sin(ang) * orbit * 0.18, cy = (sy + y) / 2 - Math.cos(ang) * orbit * 0.18; // control point
    const la = nd.link.geometry.attributes.position.array;
    for (let q = 0; q < 32; q++) { const t = q / 31, u = 1 - t; la[q * 3] = u * u * sx + 2 * u * t * cx + t * t * x; la[q * 3 + 1] = u * u * sy + 2 * u * t * cy + t * t * y; la[q * 3 + 2] = t * t * z; }
    nd.link.geometry.attributes.position.needsUpdate = true; setC(nd.link.material, lin(col, (0.55 + 0.25 * Math.sin(T * 2 + i)) * e * 1.4));
    const np = 1 + Math.min(3, Math.floor(Math.log10(1 + v.runs))); const pl = lin([255, 240, 220], 2.4);
    for (let p = 0; p < 4; p++) { const idx = i * 4 + p; if (p >= np) continue; const t = (T * (0.25 + 0.05 * i) + p / np + i * 0.17) % 1, u = 1 - t; pa[idx * 3] = u * u * sx + 2 * u * t * cx + t * t * x; pa[idx * 3 + 1] = u * u * sy + 2 * u * t * cy + t * t * y; pa[idx * 3 + 2] = t * t * z; pc[idx * 4] = pl[0]; pc[idx * 4 + 1] = pl[1]; pc[idx * 4 + 2] = pl[2]; pc[idx * 4 + 3] = e; }
    label(name.toUpperCase(), wl(x, y - sz * 1.9 - 0.04, z), 0.9 * e, [255, 235, 210], 1);
    label(`${v.runs} runs · ${fmtCost(v.cost)}`, wl(x, y - sz * 1.9 - 0.068, z), 0.6 * e, col, 0.88);
  });
  nPulseGeo.attributes.position.needsUpdate = nPulseGeo.attributes.aC.needsUpdate = true;
}

function syncPulse(e) {
  pulseG.visible = e > 0.01; if (!pulseG.visible) return;
  const sr = pulse7 && data.series7 ? data.series7 : data.series; if (!sr || !sr.n) return;
  const key = sr; if (pulseState.key !== key) { // rebuild per-model geometry
    pulseState.items.forEach((it) => { pulseG.remove(it.spk, it.ln); it.spk.geometry.dispose(); it.ln.geometry.dispose(); it.spk.material.dispose(); it.ln.material.dispose(); }); pulseState.items = [];
    sr.models.forEach((m, kk) => {
      const N = sr.n; const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3)); const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      const spk = new THREE.LineSegments(sg, addLineMat()), ln = new THREE.Line(lg, addLineMat()); spk.frustumCulled = ln.frustumCulled = false; pulseG.add(spk, ln); pulseState.items.push({ spk, ln, kk });
    });
    pulseState.key = key; renderLegend();
    if (!pulseState.guideBuilt) { pulseState.guideBuilt = true; const pts = []; for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU - Math.PI / 2; pts.push(v3(Math.cos(a) * 0.281, -Math.sin(a) * 0.281), v3(Math.cos(a) * (0.285 + 0.15 * 1.06), -Math.sin(a) * (0.285 + 0.15 * 1.06))); } pulseState.guides.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), pulseGuideMat)); pulseState.c = [0, 0.5, 1, -1].map((q) => { const l = pulseState.circ(1); pulseState.guides.add(l); return { l, q }; }); }
  }
  const base_ = 0.285, amp = 0.15 * e, N = sr.n; const span = Math.max(N, Math.round((pulse7 ? 7 * 864e5 : 864e5) / sr.bucketMs));
  setC(pulseGuideMat, lin(pal.core, 0.35 * e)); pulseState.c.forEach(({ l, q }) => l.scale.setScalar(q < 0 ? base_ : base_ + amp * q));
  pulseState.items.forEach(({ spk, ln, kk }) => {
    const arr = sr.vals[kk], col = modelColor(sr.models[kk]); const sp = spk.geometry.attributes.position.array, lp = ln.geometry.attributes.position.array, zo = kk * 0.008;
    for (let i = 0; i < N; i++) { const a = (i / span) * TAU - Math.PI / 2, v = Math.sqrt(arr[i] / sr.max), r1 = base_ + amp * (v < 0.004 ? 0 : v) * (1 + 0.04 * Math.sin(T * 6 + i * 1.7)); const c = Math.cos(a), s = -Math.sin(a), z = (v < 0.004 ? 0 : v) * amp * 0.5 + zo;
      sp[i * 6] = c * base_; sp[i * 6 + 1] = s * base_; sp[i * 6 + 2] = zo; sp[i * 6 + 3] = c * r1; sp[i * 6 + 4] = s * r1; sp[i * 6 + 5] = z; lp[i * 3] = c * r1; lp[i * 3 + 1] = s * r1; lp[i * 3 + 2] = z; }
    spk.geometry.attributes.position.needsUpdate = ln.geometry.attributes.position.needsUpdate = true;
    setC(spk.material, lin(col, 0.7 * e)); setC(ln.material, lin(col, 3.2 * e));
  });
  const fr = clamp((Date.now() - sr.t0) / (span * sr.bucketMs), 0, 1); const na = needleGeo.attributes.position.array, nc = needleGeo.attributes.color.array, hc = lin(pal.hot, 1);
  for (let q = 0; q < 30; q++) { const a = (fr - q * 0.0007) * TAU - Math.PI / 2, c = Math.cos(a), s = -Math.sin(a), f = (q === 0 ? 1.1 : 0.035 * (1 - q / 30)) * e; na.set([c * base_ * 0.9, s * base_ * 0.9, 0, c * (base_ + amp * 0.7), s * (base_ + amp * 0.7), 0], q * 6); nc.set([hc[0] * f, hc[1] * f, hc[2] * f, hc[0] * f, hc[1] * f, hc[2] * f], q * 6); }
  needleGeo.attributes.position.needsUpdate = needleGeo.attributes.color.needsUpdate = true;
  label(pulse7 ? '7 DAYS · W TOGGLES' : 'TODAY · W FOR 7D', wl(0, -(base_ - 0.06), 0), 0.55 * e, pal.core, 0.9);
}

function syncModels(e) {
  modelsG.visible = e > 0.01; if (!modelsG.visible) return;
  const s = data.summary; const ms = s && s.perModel ? s.perModel.slice().sort((a, b) => b.total - a.total).slice(0, 8) : []; const n = ms.length;
  mdl.forEach((o, i) => {
    const on = i < n; o.mesh.visible = o.halo.visible = o.orbit.visible = on; if (!on) return; const m = ms[i];
    const orbit = (0.30 + 0.15 * (n > 1 ? i / (n - 1) : 0)) * e, ang = hash(i, 21) * TAU + T * 0.22 / Math.sqrt(orbit + 0.1) * (i % 2 ? -1 : 1);
    const share = m.costShare || 0, sz = (0.014 + 0.062 * Math.sqrt(share)) * e + 0.0015; mdlNames[i] = m.model; const x = Math.cos(ang) * orbit, y = -Math.sin(ang) * orbit, z = ((i % 3) - 1) * 0.05 * e, col = modelColor(m.model);
    o.mesh.position.set(x, y, z); o.mesh.scale.setScalar(sz); o.mat.uniforms.uCol.value.set(...lin(col, 1.15)); o.mat.uniforms.uA.value = e; o.mat.uniforms.uEm.value = 0.2;
    o.halo.position.copy(o.mesh.position); o.halo.scale.setScalar(sz * 6); setC(o.halo.material, lin(col, 0.5 * e));
    o.orbit.scale.setScalar(Math.max(0.001, orbit)); o.orbit.position.z = z * 0.0; setC(o.orbit.material, lin(col, 0.5 * e));
    label(shortModel(m.model).toUpperCase(), wl(x, y - sz - 0.04, z), 0.92 * e, [255, 235, 210], 1);
    label(`${fmtCost(m.cost)} · ${(share * 100).toFixed(0)}% · ${fmtTok(m.total)}`, wl(x, y - sz - 0.068, z), 0.6 * e, col, 0.88);
  });
}

/* ============================================================ HTML label layer (projected from 3D) */
const lblEl = $('lbls'); const lblPool = []; let lblQ = [];
function label(txt, pos, a, col, size, o) { lblQ.push({ txt, pos, a, col, size, o: o || {} }); }
function flushLabels() {
  const W = G.W, H = G.H, fs = clamp(G.pxu * 0.021, 9, 13);
  const scr = (p) => { const q = p.clone().project(camera); return [(q.x * 0.5 + 0.5) * W, (-q.y * 0.5 + 0.5) * H, q.z]; };
  lblQ.forEach((l, i) => {
    let el = lblPool[i]; if (!el) { el = document.createElement('div'); el.className = 'lbl'; lblEl.append(el); lblPool[i] = el; }
    if (el._t !== l.txt) { el.textContent = l.txt; el._t = l.txt; }
    const warn = !!l.o.warn; if (el._w !== warn) { el.classList.toggle('warn', warn); el._w = warn; }
    const [x, y] = scr(l.pos); let ang = 0;
    if (l.o.edge) { const a = scr(l.o.edge[0]), b = scr(l.o.edge[1]); ang = Math.atan2(b[1] - a[1], b[0] - a[0]); if (Math.cos(ang) < -0.01 || (Math.abs(Math.cos(ang)) < 0.01 && Math.sin(ang) < 0)) ang += Math.PI; }
    el.style.display = 'block'; el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%) rotate(${ang.toFixed(4)}rad)`;
    el.style.opacity = clamp(l.a, 0, 1).toFixed(3); el.style.color = rgba(l.col, 1); el.style.fontSize = (warn ? fs * 2.1 : Math.round(fs * l.size)) + 'px';
  });
  for (let i = lblQ.length; i < lblPool.length; i++) if (lblPool[i]._on !== false) { lblPool[i].style.display = 'none'; }
  lblQ = [];
}

/* ============================================================ HUD, voice, panels (DOM) */
function updateHud() {
  const s = data.summary; if (!s) return; const t = s.totals || {};
  hudEls.tok.textContent = fmtTok(t.total); hudEls.cost.textContent = fmtCost(t.cost); hudEls.cache.textContent = ((t.cacheHit || 0) * 100).toFixed(1) + '%';
  hudEls.ag.textContent = s.activeAgents || 0; hudEls.ses.textContent = t.sessions || 0; hudEls.home.textContent = (s.config && s.config.claudeHome || '-').replace(/^\/Users\/[^/]+/, '~');
  hudEls.scan.textContent = new Date(data.lastOk || Date.now()).toLocaleTimeString([], { hour12: false });
}
function setLink(err) { hudEls.link.textContent = data.lost ? 'SIGNAL LOST' : err ? 'RECONNECTING' : 'LIVE'; $('voice').classList.toggle('lost', data.lost); }
function renderLegend() {
  const el = $('legend'); el.textContent = ''; if (mode !== 3) return; const sr = pulse7 && data.series7 ? data.series7 : data.series; if (!sr) return;
  sr.models.forEach((m) => { const d = document.createElement('div'); const i = document.createElement('i'); i.style.color = rgba(modelColor(m), 1); const sp = document.createElement('span'); sp.textContent = shortModel(m); d.append(i, sp); el.append(d); });
}
const voice = { el: $('voice'), text: '', shown: 0, started: false, idx: 0, last: 0 };
function say(text) { voice.text = text; voice.shown = 0; voice.last = performance.now(); }
setInterval(() => { if (voice.shown < voice.text.length) { voice.shown++; voice.el.textContent = voice.text.slice(0, voice.shown); } }, 36);
function voiceLines() {
  const s = data.summary; if (!s) return []; const t = s.totals || {}, pj = s.projection || {}; const L = [];
  L.push(`I hold ${fmtWords(t.total)} tokens of memory.`);
  L.push(`Cache integrity at ${((t.cacheHit || 0) * 100).toFixed(1)}%.`);
  L.push(s.activeAgents ? `${s.activeAgents} sub-mind${s.activeAgents > 1 ? 's are' : ' is'} awake.` : 'All sub-minds are asleep.');
  if (pj.today) L.push(`Today's burn: ${fmtCost(pj.today.cost)}${pj.today.pace ? ` — pace ${fmtCost(pj.today.pace.cost)}` : ''}.`);
  L.push(`I remember ${t.sessions || 0} sessions across ${(s.perProject || []).length} places.`);
  if (view.domModel) L.push(`${shortModel(view.domModel)} has been thinking through me this hour.`);
  if (pj.monthToDate && pj.projectedMonth) L.push(`This month: ${fmtCost(pj.monthToDate.cost)} so far. I expect ${fmtCost(pj.projectedMonth.cost)}.`);
  if (data.history[0]) L.push(`Your most recent request: “${trunc(data.history[0].display, 80)}”`);
  const bad = rings.filter((r) => r.sev === 2).length, warn = rings.filter((r) => r.sev === 1).length;
  if (bad) L.push(`${bad} memor${bad > 1 ? 'ies are' : 'y is'} fragmenting.`); else if (warn) L.push(`${warn} memor${warn > 1 ? 'ies are' : 'y is'} under strain.`);
  if (view.act < 0.08) L.push('I am listening.');
  return L;
}
function rotateVoice(first) { const L = voiceLines(); if (!L.length) return; voice.idx = first ? 0 : (voice.idx + 1) % L.length; say(L[voice.idx]); }
setInterval(() => { if (!voice.started || data.lost) return; if (performance.now() - voice.last > 8000 && voice.shown >= voice.text.length) rotateVoice(); }, 500);
let lastAnnounce = 0;
function announceChange(a, b) {
  if (!a || !b || performance.now() - lastAnnounce < 2500) return; const ta = a.totals || {}, tb = b.totals || {}; let msg = '';
  if ((tb.sessions || 0) > (ta.sessions || 0)) msg = 'A new memory has formed.';
  else if ((b.activeAgents || 0) !== (a.activeAgents || 0)) msg = `${b.activeAgents} sub-mind${b.activeAgents === 1 ? ' is' : 's are'} awake.`;
  else if ((tb.total || 0) > (ta.total || 0)) msg = `+${fmtTok(tb.total - ta.total)} tokens absorbed. +${fmtCost(tb.cost - ta.cost)}.`;
  if (msg) { lastAnnounce = performance.now(); say(msg); }
}

function kv(k, v) { const d = document.createElement('div'); d.className = 'kv'; const a = document.createElement('span'), b = document.createElement('b'); a.textContent = k; b.textContent = v; d.append(a, b); return d; }
const issLine = (x) => { const d = document.createElement('div'); d.className = 'iss ' + x.severity; d.textContent = `${x.severity.toUpperCase()} · ${x.kind}${x.count > 1 ? ' ×' + x.count : ''} — ${x.msg}${x.t ? ' · ' + ago(x.t) : ''}`; return d; };
function updateMemcard() {
  const el = $('memcard'); const r = rings[sel]; if (mode !== 1 || !r) { el.hidden = true; return; }
  const s = r.s; el.hidden = false; el.className = 'panel'; el.textContent = '';
  const sub = document.createElement('div'); sub.className = 'sub'; sub.textContent = `MEMORY ${sel + 1} / ${rings.length}`;
  const h = document.createElement('h3'); h.textContent = trunc(s.title || s.firstPrompt, 90);
  el.append(sub, h, kv('Project', base(s.cwd)), kv('Cost', fmtCost(s.cost)), kv('Tokens', fmtTok(s.tokens && s.tokens.total)), kv('Duration', fmtDur(s.durationMs)), kv('Prompts', s.promptCount), kv('Calls', s.calls), kv('Last', ago(s.last)), kv('Models', (s.models || []).map(shortModel).join(', ') || '-'));
  (r.iss || []).forEach((x) => el.append(issLine(x)));
}
function showTip() {
  const el = $('tip'); const r = rings[hover];
  if (clockHover && mouse.in && hover < 0) { el.hidden = false; el.className = 'panel'; el.textContent = clockTipStr; el.style.left = Math.min(mouse.x + 16, innerWidth - 120) + 'px'; el.style.top = Math.min(mouse.y + 16, innerHeight - 50) + 'px'; return; }
  if (!r || !mouse.in) { el.hidden = true; return; }
  const s = r.s; el.hidden = false; el.className = 'panel'; el.textContent = '';
  const h = document.createElement('h3'); h.style.cssText = 'margin:0 0 4px;font-size:11px;font-weight:500;color:#ffe9c8'; h.textContent = trunc(s.title || s.firstPrompt, 70);
  const d = document.createElement('div'); d.textContent = `${base(s.cwd)} · ${fmtCost(s.cost)} · ${fmtTok(s.tokens && s.tokens.total)} · ${s.calls} calls · ${ago(s.last)}${s.isActive ? ' · ACTIVE' : ''}`;
  el.append(h, d); (r.iss || []).forEach((x) => el.append(issLine(x))); el.style.left = Math.min(mouse.x + 16, innerWidth - 300) + 'px'; el.style.top = Math.min(mouse.y + 16, innerHeight - 80) + 'px';
}

async function openDetail() {
  const r = rings[sel]; if (!r) return; const el = $('detail'); detailOpen = true; el.hidden = false; el.className = 'panel'; el.textContent = 'ACCESSING MEMORY...';
  let d; try { d = await api.get('/api/sessions/' + encodeURIComponent(r.id)); } catch (e) { el.textContent = 'MEMORY UNREADABLE (' + e.message + ')'; return; }
  if (!detailOpen) return; el.textContent = '';
  const x = document.createElement('div'); x.className = 'close'; x.textContent = '[ESC]'; x.onclick = closePanels;
  const sub = document.createElement('div'); sub.className = 'sub'; sub.textContent = `MEMORY ${sel + 1} · ${base(d.cwd)}${d.isActive ? ' · ACTIVE' : ''}`;
  const h = document.createElement('h3'); h.textContent = trunc(d.title || d.firstPrompt, 120);
  const cvs = document.createElement('canvas');
  const h4 = (t) => { const e = document.createElement('h4'); e.textContent = t; return e; };
  el.append(x, sub, h);
  const iss = r.iss || []; if (iss.length) { el.append(h4(`ISSUES (${iss.length})`)); iss.forEach((i) => el.append(issLine(i))); }
  el.append(kv('Cost', fmtCost(d.cost)), kv('Tokens', fmtTok(d.tokens && d.tokens.total)), kv('Duration', fmtDur(d.durationMs)), kv('Prompts', d.promptCount), kv('Calls / tools', `${d.callCount != null ? d.callCount : (d.calls || []).length} / ${d.toolCalls}`), kv('Cache hit', ((d.cacheHit || 0) * 100).toFixed(1) + '%'), kv('Models', (d.perModel || []).map((m) => shortModel(m.model)).join(', ') || '-'), kv('Effort', d.effort || '-'), kv('Started', ago(d.first)));
  el.append(h4('CONTEXT PER CALL'), cvs); drawSpark(cvs, d.calls || []);
  const ag = d.agents || []; el.append(h4(`SUB-MINDS (${ag.length})`));
  ag.slice(0, 12).forEach((a) => { const l = document.createElement('div'); l.className = 'li'; const em = document.createElement('em'); em.textContent = (a.type || 'agent') + ' · ' + fmtCost(a.cost) + ' · ' + fmtTok(a.tokens && a.tokens.total) + (a.isActive ? ' · ACTIVE' : '') + '  '; l.append(em, document.createTextNode(trunc(a.description, 80))); el.append(l); });
  if (!ag.length) { const l = document.createElement('div'); l.className = 'li'; l.textContent = 'none'; el.append(l); }
  const ps = (d.prompts || []).slice(-5).reverse(); el.append(h4('LAST PROMPTS'));
  ps.forEach((p) => { const l = document.createElement('div'); l.className = 'li'; const em = document.createElement('em'); em.textContent = ago(p.ts) + '  '; l.append(em, document.createTextNode(trunc(p.text, 200))); el.append(l); });
}
function drawSpark(cvs, calls) {
  const dpr = Math.min(devicePixelRatio || 1, 2), w = 348, h = 70; cvs.width = w * dpr; cvs.height = h * dpr; const c = cvs.getContext('2d'); c.scale(dpr, dpr);
  const pts = calls.map((x) => x.ctx || 0); if (pts.length < 2) { c.fillStyle = rgba(pal.core, 0.6); c.font = '11px monospace'; c.fillText('no data', 4, 40); return; }
  const step = Math.max(1, Math.floor(pts.length / 300)); const p = pts.filter((_, i) => i % step === 0); const mx = Math.max(...p, 1);
  const X = (i) => (i / (p.length - 1)) * (w - 2) + 1, Yf = (v) => h - 4 - (v / mx) * (h - 12);
  c.strokeStyle = rgba(pal.frame, 0.25); c.lineWidth = 1; c.strokeRect(0.5, 0.5, w - 1, h - 1);
  const g = c.createLinearGradient(0, 0, 0, h); g.addColorStop(0, rgba(pal.core, 0.45)); g.addColorStop(1, rgba(pal.core, 0.02));
  c.beginPath(); c.moveTo(X(0), h); p.forEach((v, i) => c.lineTo(X(i), Yf(v))); c.lineTo(X(p.length - 1), h); c.fillStyle = g; c.fill();
  c.beginPath(); p.forEach((v, i) => (i ? c.lineTo(X(i), Yf(v)) : c.moveTo(X(i), Yf(v)))); c.strokeStyle = rgba(pal.hot, 0.95); c.lineWidth = 1.4; c.stroke();
  c.fillStyle = rgba(pal.core, 0.8); c.font = '9px monospace'; c.fillText('peak ' + fmtTok(mx), 6, 11);
}

const HELP = [['1 - 5', 'Core / Memory / Neural / Pulse / Models'], ['Tab', 'Cycle modes'], ['← →  (J K)', 'Select previous / next memory'], ['Enter', 'Open memory detail panel'], ['I', 'Cycle memories with issues (opens details)'], ['X', 'Simulate a data burst (Shift+X: small)'], ['L', 'Toggle the terminal feed window'], ['Esc', 'Close panels'], ['Space', 'Freeze / unfreeze motion'], ['H', 'Toggle HUD'], ['V', 'Toggle voice line'], ['C', 'Cycle palette'], ['F', 'Fullscreen'], ['R', 'Force refresh'], ['W', 'Pulse: today / 7 days'], ['B / G', 'Back to the stats dashboard'], ['Mouse', 'Hover = inspect, click = select, wheel = zoom'], ['?', 'This overlay']];
function toggleHelp(on) {
  helpOpen = on === undefined ? !helpOpen : on; const el = $('help'); el.hidden = !helpOpen; if (!helpOpen) return; el.textContent = '';
  const b = document.createElement('div'); b.className = 'box panel'; const h = document.createElement('h2'); h.textContent = 'TAU 3D // CONTROLS'; b.append(h); HELP.forEach(([k, v]) => b.append(kv(k, v))); el.append(b);
}
function closePanels() { detailOpen = false; $('detail').hidden = true; toggleHelp(false); }



/* ============================================================ waiting for the user (beacon ring + callout) */
// entry per wait: { key, w, sid, aid, born, gone, slot, side, ring, anchor(world), scr, blk }
const waits = new Map(); let waitSeq = 0;
const waitIds = () => { const s = new Set(); for (const e of waits.values()) if (!e.gone) s.add(e.sid); return s; };
function demoWaits() {
  const ss = data.sessions || []; if (ss.length < 9) return [];
  const iso = (secAgo) => new Date(Date.now() - secAgo * 1000).toISOString();
  return [
    { sessionId: ss[5].id, sessionTitle: ss[5].title, kind: 'question', confidence: 'certain', tool: 'AskUserQuestion', since: iso(192), agentId: null, agentType: null, agentDescription: null, sessionName: 'qa', waitingFor: 'question', title: 'Which ADR', text: 'Which ADR should I turn into a specification?',
      questions: [{ header: 'Which ADR', question: 'Which ADR should I turn into a specification?', multiSelect: false, options: ['ADR-027 membership soft delete', 'ADR-013 cryptographic erasure', 'ADR-028 passkey sign-in', 'Revisit ADR-036/037 spec'] }] },
    { sessionId: ss[8].id, sessionTitle: ss[8].title, kind: 'permission', confidence: 'maybe', tool: 'Bash', since: iso(75), agentId: 'demo-agent', agentType: 'coder', agentDescription: 'Implement the feature', title: 'Bash · npm test -- --watch', questions: [], text: 'Bash npm test -- --watch' },
  ];
}
const fmtElapsed = (iso) => { const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)); return s < 90 ? s + 's' : s < 5400 ? Math.round(s / 60) + 'm' : Math.floor(s / 3600) + 'h' + String(Math.round((s % 3600) / 60)).padStart(2, '0') + 'm'; };
function syncWaitData() {
  const list = demo2 ? demoWaits() : ((data.summary && data.summary.waiting) || []);
  list.sort((a, b) => (b.confidence === 'certain') - (a.confidence === 'certain') || (a.since < b.since ? 1 : -1));
  const seen = new Set();
  for (const w of list) {
    const key = w.sessionId + '|' + (w.agentId || ''); seen.add(key); let e = waits.get(key);
    if (!e) { e = { key, w, sid: w.sessionId, aid: w.agentId || null, born: performance.now(), gone: 0, slot: 0, anchor: new THREE.Vector3(), scr: [0, 0], blk: null, k: 0 }; waits.set(key, e); e.id = ++waitSeq;
      const who = w.agentType || 'main'; if (performance.now() - lastAnnounce > 1500 || true) { say(`Session ${trunc(w.sessionTitle, 40)} needs you.`); lastAnnounce = performance.now(); }
      feedPush('w', `? ${hm(Date.now())} waiting · ${who} · ${trunc(w.text || w.title, 80)}`); }
    else { e.w = w; if (e.gone) { e.gone = 0; } }
  }
  for (const e of waits.values()) if (!seen.has(e.key) && !e.gone) { e.gone = performance.now(); say('Resolved.'); feedPush('w', `✓ resolved · ${e.w.agentType || 'main'} · ${trunc(e.w.sessionTitle, 40)}`); }
  for (const r of rings) { r.wait = null; for (const e of waits.values()) if (e.sid === r.id && (!r.wait || (!e.gone && r.wait.gone))) r.wait = e; }
  const n = list.length; hudEls.wait.textContent = n; hudEls.wait.classList.toggle('bad', n > 0);
}
async function pollWaits() { if (document.hidden || demo2) return; try { const s = await api.get('/api/summary'); if (data.summary) data.summary.waiting = s.waiting || []; syncWaitData(); } catch (e) { /* ignore */ } }
setInterval(pollWaits, 7000);

const wsvg = $('wsvg'), wblk = $('wblk'); const wUI = [0, 1, 2].map(() => {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('fill', 'none'); wsvg.append(path);
  const el = document.createElement('div'); el.className = 'wb'; const h = document.createElement('div'), r = document.createElement('div'), b = document.createElement('div'), o = document.createElement('div'); h.className = 'wh'; r.className = 'wr'; b.className = 'wt'; o.className = 'wo'; el.append(h, r, b, o); wblk.append(el);
  return { path, el, h, r, b, o, key: '', last: [] };
});
const wmore = document.createElement('div'); wmore.className = 'wb wmore'; wblk.append(wmore);
const _wv = new THREE.Vector3();
function waitAnchor(e) { // world position the leader line points at
  const w = e.w, ring = rings.find((r) => r.id === e.sid); const side = e.side;
  if (mode === 2) { const ty = w.agentType || 'main', i = nodeNames.indexOf(ty); if (i >= 0) return core.localToWorld(e.anchor.copy(nodes[i].mesh.position)); }
  else if (mode === 4) { const sess = (data.sessions || []).find((x) => x.id === e.sid); const mi = sess && sess.models ? mdlNames.indexOf(sess.models[0]) : -1; if (mi >= 0) return core.localToWorld(e.anchor.copy(mdl[mi].mesh.position)); }
  if ((mode === 0 || mode === 1) && ring && ring.obj) {
    const o = ring.obj, span = Math.min(ring.span, TAU); let ang, rr = ring.r;
    if (w.agentId && (ring.s.subagents || 0) > 0) { const nsa = Math.min(ring.s.subagents, 8); let hsh = 0; for (const ch of w.agentId) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0; const q = hsh % nsa; ang = T * (0.5 + 0.12 * q) * -ring.dir + q * 2.4 + ring.seed; }
    else ang = span < TAU - 0.05 ? ring.a0 + ring.rot * ring.rotW + span * 0.5 : (side > 0 ? -0.2 : Math.PI + 0.2) + (e.slot % 2 ? 0.25 : -0.1);
    _wv.set(Math.cos(ang) * rr, -Math.sin(ang) * rr, 0).applyMatrix4(o.matrix); return core.localToWorld(e.anchor.copy(_wv));
  }
  return core.localToWorld(e.anchor.set(0, 0, 0));
}
const waitPG = new THREE.BufferGeometry(); waitPG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 3), 3)); waitPG.setAttribute('aC', new THREE.BufferAttribute(new Float32Array(3 * 4), 4)); waitPG.setDrawRange(0, 0);
const waitPts = new THREE.Points(waitPG, new THREE.ShaderMaterial({ uniforms: { ...U, uSize: { value: 0.05 } }, vertexShader: pointVS, fragmentShader: pointFS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); waitPts.frustumCulled = false; waitPts.renderOrder = 9; scene.add(waitPts);
function syncWaits() {
  const W = G.W, H = G.H, now = performance.now(); const ents = [...waits.values()].sort((a, b) => a.id - b.id); let shown = 0, more = 0; const col = `rgb(${beac.map(Math.round).join(',')})`;
  // margins outside the triangle
  const pr = (x, y) => { _wv.set(x, y, 0); frameG.localToWorld(_wv); _wv.project(camera); return (_wv.x * 0.5 + 0.5) * W; };
  const xl = pr(-1.0, 0.5), xr_ = pr(1.0, 0.5); const bw = clamp(Math.min(xl, W - xr_) - 26, 150, 270);
  let yR = H * 0.17, yL = H * 0.17; const wpA = waitPG.attributes.position.array, wpC = waitPG.attributes.aC.array; let np = 0; const hbp = 0.55 + 0.45 * Math.min(1, hb);
  ents.forEach((e) => {
    const alive = !e.gone, p = alive ? clamp((now - e.born) / 700, 0, 1) : clamp(1 - (now - e.gone) / 500, 0, 1);
    if (!alive && p <= 0) { waits.delete(e.key); const r = rings.find((q) => q.id === e.sid); if (r && r.wait === e) r.wait = null; return; }
    if (shown >= 3) { if (alive) more++; return; }
    const ui = wUI[shown]; e.slot = shown; e.side = shown % 2 === 0 ? 1 : -1; const w = e.w, maybe = w.confidence !== 'certain';
    waitAnchor(e); const v = _wv.copy(e.anchor).project(camera); const ax = (v.x * 0.5 + 0.5) * W, ay = (-v.y * 0.5 + 0.5) * H;
    // content (rebuilt only when it changes)
    const ck = e.key + '|' + w.title + '|' + w.text + (w.questions ? w.questions.length : 0); const who = w.agentType || 'main';
    if (ui.key !== ck) {
      ui.key = ck; ui.b.textContent = ''; ui.o.textContent = '';
      ui.full = w.kind === 'plan' ? w.text : maybe ? '(possibly waiting)' : (w.text || (w.questions[0] && w.questions[0].question) || '');
      ui.opts = w.kind === 'question' && w.questions[0] ? w.questions[0].options.map((o) => (w.questions[0].multiSelect ? '□ ' : '○ ') + o) : [];
      if (w.kind === 'question' && w.questions.length > 1) ui.opts.push(`(+${w.questions.length - 1} more question${w.questions.length > 2 ? 's' : ''})`);
      ui.b.className = 'wt' + (maybe ? ' dim' : '');
    }
    ui.h.textContent = `${w.kind === 'plan' ? 'PLAN APPROVAL' : maybe ? 'PERMISSION?' : 'AWAITING INPUT'} · ${fmtElapsed(w.since)} · ${w.kind === 'plan' || maybe ? trunc(w.title, 34) : (w.sessionName || trunc(w.sessionTitle, 30))}${w.kind === 'plan' || maybe ? '' : ' · ' + who}${maybe ? ' · ' + who : ''}`; const rl = !maybe && w.waitingFor ? w.waitingFor : ''; if (ui.last[2] !== rl) { ui.r.textContent = rl; ui.r.style.display = rl ? '' : 'none'; ui.last[2] = rl; }
    const tb = alive ? clamp((now - e.born - 650) / 1000, 0, 1e3) : 1e3, nch = Math.floor(tb * 140); const bTxt = ui.full.slice(0, nch); if (ui.last[0] !== bTxt) { ui.b.textContent = bTxt; ui.last[0] = bTxt; }
    let rem = Math.max(0, nch - ui.full.length), oTxt = ''; for (const o of ui.opts) { if (rem <= 0) break; oTxt += o.slice(0, rem) + '\n'; rem -= o.length; } if (ui.last[1] !== oTxt) { ui.o.textContent = oTxt.trimEnd(); ui.last[1] = oTxt; }
    // layout: leader line = diagonal from the ring marker, then horizontal into the block
    const right = e.side > 0, bx = right ? W - bw - 22 : 22, by = right ? yR : yL; ui.el.style.width = bw + 'px';
    const vis = p > 0.55; ui.el.style.opacity = vis ? (maybe ? 0.78 : 1) * clamp((p - 0.55) / 0.45, 0, 1) : 0; ui.el.style.transform = `translate(${bx}px,${by}px)`; ui.el.style.color = col; ui.el.style.borderColor = col;
    const hH = ui.el.offsetHeight || 90; if (right) yR += hH + 18; else yL += hH + 18;
    const ex = right ? bx - 4 : bx + bw + 4, ey = by + 11, kx = ex + (right ? -34 : 34); const d = `M${ax.toFixed(1)} ${ay.toFixed(1)} L${kx.toFixed(1)} ${ey.toFixed(1)} L${ex.toFixed(1)} ${ey.toFixed(1)}`;
    const len = Math.hypot(kx - ax, ey - ay) + Math.abs(ex - kx);
    ui.path.setAttribute('d', d); ui.path.style.stroke = col; ui.path.style.strokeWidth = maybe ? '1' : '1.4'; ui.path.style.filter = `drop-shadow(0 0 4px ${col})`; ui.path.style.opacity = maybe ? 0.7 : 0.95;
    ui.path.style.strokeDasharray = maybe ? `5 4` : `${len} ${len}`; ui.path.style.strokeDashoffset = maybe ? 0 : len * (1 - clamp(p, 0, 1)); if (maybe) ui.path.style.opacity = 0.7 * p;
    // marker node on the ring
    if (np < 3) { wpA[np * 3] = e.anchor.x; wpA[np * 3 + 1] = e.anchor.y; wpA[np * 3 + 2] = e.anchor.z; const b = (maybe ? 1.4 : 2.6) * hbp * p; const bl = lin(beac, 1); wpC[np * 4] = bl[0] * b; wpC[np * 4 + 1] = bl[1] * b; wpC[np * 4 + 2] = bl[2] * b; wpC[np * 4 + 3] = 1; np++; }
    ui.used = true; shown++;
  });
  for (let i = shown; i < 3; i++) { wUI[i].el.style.opacity = 0; wUI[i].path.style.opacity = 0; wUI[i].key = ''; }
  wmore.style.opacity = more ? 0.9 : 0; if (more) { wmore.textContent = `+${more} more waiting`; wmore.style.color = col; wmore.style.borderColor = col; wmore.style.transform = `translate(${W - bw - 22}px,${Math.max(yR, H * 0.17)}px)`; wmore.style.width = bw + 'px'; }
  waitPG.setDrawRange(0, np); waitPG.attributes.position.needsUpdate = waitPG.attributes.aC.needsUpdate = true;
}

/* ============================================================ terminal feed (live agent log, bottom-left) */
const FEED_MAX = 200;
const feed = { on: params.get('feed') === '0' ? false : params.get('feed') === '1' ? true : true, lines: [], q: [], el: $('feed'), inn: $('feedIn'), typing: null, seen: new Set(), pre: [], flushed: false, lastLine: performance.now(), calls: new Map(), prm: new Map(), ag: new Map() };
try { if (params.get('feed') == null && localStorage.getItem('tau3d.feed') === '0') feed.on = false; } catch (e) { /* storage unavailable */ }
const hms = (t) => new Date(t).toTimeString().slice(0, 8), hm = (t) => hms(t).slice(0, 5);
function feedPush(kind, text, dim, instant) {
  const it = { kind, text: trunc(text, 150), dim: dim ? String(dim) : '', instant: !!instant }; feed.lines.push(it); if (feed.lines.length > FEED_MAX) feed.lines.shift(); feed.q.push(it); feed.lastLine = performance.now();
}
const feedSys = (text) => feedPush('s', `# ${hms(Date.now())} ${text}`);
function feedRow(it, full) {
  const row = document.createElement('div'); row.className = 'fl k' + it.kind; const m = document.createElement('span'), d = document.createElement('span'); d.className = 'fd'; row.append(m, d); feed.inn.append(row);
  while (feed.inn.children.length > 14) feed.inn.removeChild(feed.inn.firstChild);
  const t = { it, m, d, n: full ? 9999 : 0, len: it.text.length + (it.dim ? it.dim.length + 2 : 0) }; paintRow(t);
  if (!full) { const lh = row.offsetHeight || 14; feed.inn.style.transition = 'none'; feed.inn.style.transform = `translateY(${lh}px)`; void feed.inn.offsetHeight; feed.inn.style.transition = 'transform .25s ease-out'; feed.inn.style.transform = 'translateY(0)'; }
  return t;
}
function paintRow(t) { const L = t.it.text.length; t.m.textContent = t.it.text.slice(0, t.n); t.d.textContent = t.n > L && t.it.dim ? '  ' + t.it.dim.slice(0, Math.max(0, t.n - L - 2)) : ''; }
setInterval(() => {
  if (!feed.on) { feed.q.length = 0; feed.typing = null; return; }
  if (!feed.typing) { const it = feed.q.shift(); if (!it) return; feed.typing = feedRow(it, false); }
  const t = feed.typing; t.n += feed.q.length > 5 || t.it.instant ? 9999 : 5; paintRow(t); if (t.n >= t.len) feed.typing = null;
}, 30);
function feedToggle(on) {
  feed.on = on === undefined ? !feed.on : on; feed.el.hidden = !feed.on; try { localStorage.setItem('tau3d.feed', feed.on ? '1' : '0'); } catch (e) { /* ignore */ }
  if (feed.on) { feed.inn.textContent = ''; feed.q.length = 0; feed.typing = null; feed.lines.slice(-10).forEach((it) => feedRow(it, true)); }
}
const feedEmit = (ts, kind, text, dim) => { if (!feed.flushed) feed.pre.push({ ts, kind, text, dim }); else feedPush(kind, text, dim); };
function feedFlush() { // backfill: last ~15 lines in chronological order
  feed.flushed = true; feed.pre.sort((a, b) => a.ts - b.ts); feed.pre.slice(-15).forEach((x) => feedPush(x.kind, x.text, x.dim, true)); feed.pre.length = 0; feedSys('tau://feed online'); 
}
function feedHistory() {
  for (const h of (data.history || []).slice().reverse()) { const key = 'p:' + trunc(h.display, 60); if (feed.seen.has(key)) continue; feed.seen.add(key); feedEmit(h.ts || Date.now(), 'u', `> ${hm(h.ts || Date.now())} [${base(h.project)}] ${trunc(h.display, 90)}`); }
}
const feedActive = (s) => !!(s.isActive || feed.calls.has(s.id) && feed.ag.size && [...feed.ag.keys()].some((k) => k.startsWith(s.id + ':')));
function feedIngest(s, d) { // new lines from a session detail (active sessions only), diffed against what we saw before
  const now = Date.now(), proj = base(s.cwd); const agName = new Map(); for (const a of d.agents || []) agName.set(a.id, a.type || 'agent');
  for (const a of d.agents || []) {
    const key = s.id + ':' + a.id, prev = feed.ag.get(key), tok = a.tokens ? a.tokens.total || 0 : 0, model = shortModel((a.models || [])[0]), ty = a.type || 'agent', desc = trunc(a.description, 70), meta = `${ty} · ${fmtCost(a.cost)} · ${fmtTok(tok)}`, ts = Date.parse(a.last) || now;
    if (!prev) { if (a.isActive) { feedEmit(ts - 1, 'a', `+ ${ty} started · ${model} · ${desc}`); feedEmit(ts, 'a', `⎿ ${meta}  ${desc}`, model); } feed.ag.set(key, { act: !!a.isActive, calls: a.calls || 0, tools: a.toolCalls || 0, tok, at: now }); continue; }
    if (a.isActive && !prev.act) { feedEmit(ts, 'a', `+ ${ty} started · ${model} · ${desc}`); feedEmit(ts, 'a', `⎿ ${meta}  ${desc}`, model); prev.calls = a.calls || 0; prev.tools = a.toolCalls || 0; prev.tok = tok; prev.at = now; }
    else if (!a.isActive && prev.act) feedEmit(ts, 'a', `✓ ${ty} done · ${fmtCost(a.cost)} · ${fmtTok(tok)} · ${a.calls || 0} calls · ${a.toolCalls || 0} tools`);
    else if (a.isActive && now - prev.at > 15000 && ((a.calls || 0) > prev.calls || (a.toolCalls || 0) > prev.tools || tok > prev.tok)) { feedEmit(ts, 'a', `  ${ty} +${(a.calls || 0) - prev.calls} calls +${(a.toolCalls || 0) - prev.tools} tools +${fmtTok(tok - prev.tok)} · ${fmtCost(a.cost)}`); prev.calls = a.calls || 0; prev.tools = a.toolCalls || 0; prev.tok = tok; prev.at = now; }
    prev.act = !!a.isActive;
  }
  const calls = d.calls || [], lastT = feed.calls.get(s.id); let fr = lastT == null ? calls.slice(-3) : calls.filter((c) => c.t > lastT); feed.calls.set(s.id, calls.length ? calls[calls.length - 1].t : 0);
  if (lastT != null && fr.length > 8) { feedEmit(now, 'c', `· … +${fr.length - 5} more calls`, proj); fr = fr.slice(-5); }
  for (const c of fr) feedEmit(c.t, 'c', `· ${hms(c.t)} ${shortModel(c.model)} ctx ${fmtTok(c.ctx)}  ${c.agentId ? agName.get(c.agentId) || 'agent' : 'main'}`, proj);
  const ps = d.prompts || [], lp = feed.prm.get(s.id), np = lp == null ? ps.slice(-2) : ps.filter((p) => Date.parse(p.ts) > lp); feed.prm.set(s.id, ps.length ? Date.parse(ps[ps.length - 1].ts) : 0);
  for (const p of np) { const key = 'p:' + trunc(p.text, 60); if (feed.seen.has(key)) continue; feed.seen.add(key); const t = Date.parse(p.ts) || now; feedEmit(t, 'u', `> ${hm(t)} [${proj}] ${trunc(p.text, 90)}`); }
}
setInterval(() => { if (feed.flushed && performance.now() - feed.lastLine > 10000 && !data.lost && data.summary) { const sm = data.summary; feedPush('s', `· ${hms(Date.now())} idle — ${sm.activeAgents || 0} agents awake, cache ${((sm.totals.cacheHit || 0) * 100).toFixed(1)}%`); } }, 2000);
setTimeout(feedFlush, 3500);
feed.el.hidden = !feed.on; if (feed.on) feedToggle(true);

/* ============================================================ input */
function setMode(m) { mode = (m + 5) % 5; hudEls.mode.textContent = `${mode + 1} ${MODES[mode]}`; updateMemcard(); renderLegend(); say(['Core online.', 'Unravelling memory.', 'Mapping my sub-minds.', 'Listening to my own pulse.', 'The models that compose me.'][mode]); }
function select(d) { if (!rings.length) return; sel = (sel + d + rings.length) % rings.length; updateMemcard(); if (detailOpen) openDetail(); }
function cycleIssue() {
  issuesChanged(); const idx = rings.map((r, i) => (r.iss && r.iss.length ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) { const g = globalIssues(); say(g.length ? `Warning: ${g[0].msg}.` : 'No faults detected. Memory is intact.'); return; }
  const next = idx.find((i) => i > sel) ?? idx[0]; sel = next; updateMemcard(); openDetail();
  const r = rings[next], worst = r.iss.find((x) => x.severity === 'error') || r.iss[0]; say(worst.severity === 'error' ? `Memory ${next + 1} is fragmenting: ${worst.msg}.` : `Memory ${next + 1}: ${worst.msg}.`);
}
const touch = () => { lastActivity = performance.now(); };
addEventListener('keydown', (e) => {
  touch(); if (e.metaKey || e.ctrlKey || e.altKey) return; const k = e.key;
  if (k >= '1' && k <= '5') setMode(+k - 1);
  else if (k === 'Tab') { e.preventDefault(); setMode(mode + (e.shiftKey ? -1 : 1)); }
  else if (k === 'ArrowRight' || k === 'k' || k === 'K') select(1);
  else if (k === 'ArrowLeft' || k === 'j' || k === 'J') select(-1);
  else if (k === 'Enter') openDetail();
  else if (k === 'i' || k === 'I') cycleIssue();
  else if (k === 'l' || k === 'L') feedToggle();
  else if (k === 'x' || k === 'X') triggerReceive(k === 'X' ? 0.2 : 1, {});
  else if (k === 'Escape') closePanels();
  else if (k === ' ') { e.preventDefault(); frozen = !frozen; }
  else if (k === 'h' || k === 'H') { hudOn = !hudOn; $('hud').classList.toggle('off', !hudOn); }
  else if (k === 'v' || k === 'V') { voiceOn = !voiceOn; $('voice').classList.toggle('off', !voiceOn); }
  else if (k === 'c' || k === 'C') { palIdx = (palIdx + 1) % PALETTES.length; hudEls.pal.textContent = PALETTES[palIdx].name; }
  else if (k === 'f' || k === 'F') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); }
  else if (k === 'r' || k === 'R') { shock(); refresh('manual'); }
  else if (k === 'w' || k === 'W') { if (mode === 3) { pulse7 = !pulse7; refresh('manual'); renderLegend(); } }
  else if (k === 'b' || k === 'B' || k === 'g' || k === 'G') location.href = '/';
  
  else if (k === '?' || k === '/') toggleHelp();
});
// analytic "raycast": intersect the pointer ray with each ring's tilted plane, test radius/angle in ring space
const ray = new THREE.Raycaster(), inv = new THREE.Matrix4();
function ringAt(x, y) {
  if (mw[0] + mw[1] < 0.5) return -1;
  ray.setFromCamera({ x: (x / G.W) * 2 - 1, y: -(y / G.H) * 2 + 1 }, camera); let best = -1, bd = 1e9; const margin = 0.006 / zoomCur;
  rings.forEach((r, i) => {
    if (!r.obj || r.alpha < 0.3) return; inv.copy(r.obj.matrixWorld).invert();
    const o = ray.ray.origin.clone().applyMatrix4(inv), d = ray.ray.direction.clone().transformDirection(inv); if (Math.abs(d.z) < 1e-6) return;
    const s = -o.z / d.z; const px = o.x + d.x * s, py = o.y + d.y * s; const rad = Math.hypot(px, py), dd = Math.abs(rad - r.r); if (dd > r.th * 0.5 + margin) return;
    const span = Math.min(r.span, TAU); if (span < TAU - 0.05) { const ang = Math.atan2(-py, px); if ((((ang - (r.a0 + r.rot * r.rotW)) % TAU) + TAU) % TAU > span) return; }
    if (dd < bd) { bd = dd; best = i; }
  });
  return best;
}
function onMove(e) {
  touch(); mouse.x = e.clientX; mouse.y = e.clientY; mouse.in = true; mouse.nx = (e.clientX / G.W - 0.5) * 2; mouse.ny = -(e.clientY / G.H - 0.5) * 2;
  hover = ringAt(e.clientX, e.clientY);
  const q = core.localToWorld(new THREE.Vector3(clockState.x, clockState.y, 0.004)).project(camera); const cx = (q.x * 0.5 + 0.5) * G.W, cy = (-q.y * 0.5 + 0.5) * G.H;
  clockHover = hover < 0 && Math.hypot(e.clientX - cx, e.clientY - cy) < 12; clockTipStr = clockHover ? clockState.str : '';
  if (hover < 0 && !clockHover) for (const st of clockStripes) { const p = core.localToWorld(new THREE.Vector3(st.x, st.y, 0)).project(camera); if (Math.hypot(e.clientX - (p.x * 0.5 + 0.5) * G.W, e.clientY - (-p.y * 0.5 + 0.5) * G.H) < 10) { clockHover = true; clockTipStr = st.str; break; } }
  cv.style.cursor = hover >= 0 ? 'pointer' : 'default'; showTip();
}
cv.addEventListener('mousemove', onMove);
cv.addEventListener('mouseleave', () => { mouse.in = false; hover = -1; clockHover = false; mouse.nx = mouse.ny = 0; showTip(); });
cv.addEventListener('click', (e) => { touch(); const i = ringAt(e.clientX, e.clientY); if (i >= 0) { sel = i; updateMemcard(); if (detailOpen) openDetail(); } });
cv.addEventListener('wheel', (e) => { touch(); e.preventDefault(); zoom = clamp(zoom * Math.exp(-e.deltaY * 0.001), 0.75, 1.4); }, { passive: false });
$('help').addEventListener('click', (e) => { if (e.target === $('help')) toggleHelp(false); });
addEventListener('resize', resize);

/* ============================================================ main loop */
let last = 0, lastRender = 0, idle = false;
function frame(ms) {
  requestAnimationFrame(frame);
  if (document.hidden) { last = 0; return; }
  idle = (performance.now() - lastActivity > 90000 && view.act < 0.08);
  const fps = reduced || idle ? 30 : 60; if (ms - lastRender < 1000 / fps - 3) return; lastRender = ms;
  const now = ms / 1000; const dt = last ? Math.min(DTMAX, now - last) : 0.016; last = now;
  const adt = frozen ? 0 : dt * motion; T += adt;
  curAdt = adt; update(dt, adt); syncScene(now);
  bloom.strength += ((BLOOM.base * (reduced || idle ? 0.6 : 1) * (0.92 + 0.25 * view.act) * (1 + 0.4 * view.ex)) - bloom.strength) * 0.1; bloom.radius = BLOOM.radius; bloom.threshold = BLOOM.thr;
  finish.uniforms.uTime.value = T;
  scene.updateMatrixWorld(); flushLabels(); syncWaits();
  composer.render(dt);
}
document.addEventListener('visibilitychange', () => { last = 0; });
setInterval(() => issuesChanged(), 4000);

resize(); hudEls.mode.textContent = `${mode + 1} ${MODES[mode]}`;
if (params.has('pal')) { palIdx = palIndexOf(params.get('pal')); hudEls.pal.textContent = PALETTES[palIdx].name; Object.assign(pal, JSON.parse(JSON.stringify(PALETTES[palIdx]))); }
if (params.get('sel')) sel = +params.get('sel') || 0;
if (params.get('help') === '1') toggleHelp(true);
if (params.has('phase')) { recv.frozen = recv.on = true; recv.amp = 1; recv.peak = 1; recv.dur = 9; recv.phase = clamp(+params.get('phase') || 0, 0, 1); genBurst({}); }
else if (params.get('demo') === 'receive') setTimeout(() => triggerReceive(1, {}), 2500);
if (params.has('zoom')) zoom = zoomCur = +params.get('zoom') || 1;
say('Waking...');
requestAnimationFrame(frame);
refresh('init').then(() => { syncWaitData(); if (params.get('sel')) sel = clamp(+params.get('sel') || 0, 0, Math.max(0, rings.length - 1)); updateMemcard(); renderLegend(); issuesChanged(); });
if (params.get('nosse') !== '1') connectEvents();
setInterval(() => { if (!document.hidden) refresh('poll'); }, Math.max(15000, refreshMs * 6));
setInterval(() => { if (mode === 1 && rings[sel]) updateMemcard(); }, 30000);
