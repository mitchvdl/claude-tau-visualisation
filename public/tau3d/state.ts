import { H, S, bumpActivity } from './shared.ts';
import { TAU, clamp, ease, hash, lerp, trunc } from './util.ts';
import { params } from './dom.ts';
import { modelColor, pal } from './palettes.ts';
import { data } from './data.ts';
import { queueDetail } from './issues.ts';
import type { Issue } from './issues.ts';
import type { ProjectionData, SessionSummary, SummaryResponse } from '../../src/types.ts';

/* ============================================================ state */
// one memory ring = one session on the dial (created/refreshed in updateRings)
export interface Ring {
  id: string; s: SessionSummary; i: number; nl: number; r: number; th: number; a0: number; span: number; alpha: number; rot: number; dir: number; speed: number; rotW: number;
  selK: number; hovK: number; act: number; seed: number; nSeg: number; iss: Issue[]; sev: number; waitK: number; idleK: number;
  wait: any; // waits.ts entry for this session (or null)
  obj: any; // three.js ring mesh (ringmesh.ts)
  tilt: number[]; z: number; dead?: boolean;
  objN?: number; objRect?: boolean; rect?: boolean; blocky?: boolean; warnK?: number; errK?: number; // set by ringmesh/update
}
// per-session call delta between two /api/sessions fetches
export interface SessDelta { id: string; dC: number; dT: number; dO: number; s: SessionSummary }
interface SessCounts { calls: number; tools: number; out: number; tok: number }
export interface Recv {
  t: number; dur: number; peak: number; amp: number; on: boolean; nodes: number; frozen: boolean; phase: number; sizeK: number; briK: number; th: number; degCap: number; settleMode: number; sk: number; sparkle: number;
  lastFull: number; lastShim: number; pattern: string; pendCalls: number; pend: Map<string, SessDelta>; seed: number; hubN: number;
}
// burst origin/context: diffs are the (up to 3) sessions that produced the calls
export interface BurstCtx { diffs?: { ang: number; rad: number; title: string; dC: number }[]; toolRatio?: number; outPerCall?: number; title?: string }
export interface View {
  ex: number; wg: number; cs: number; dialR: number; fiberA: number; act: number; actT: number; tint: number[]; tintT: number[]; g: number[]; gT: number[]; pupil: number; domModel: string | null;
}

export const MODES = ['CORE', 'MEMORY', 'NEURAL', 'PULSE', 'MODELS'];
export const mw = [0, 0, 0, 0, 0]; mw[S.mode] = params.has('mode') ? 1 : 0;
export const mouse = { x: -1, y: -1, in: false, nx: 0, ny: 0 };
export const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const motion = reduced ? 0.3 : 1;
export const DTMAX = params.get('shot') === '1' ? 0.5 : 0.05;
// receiving state machine: recv.on runs one burst of `dur` seconds; view.ex (excitement 0..1) and view.wg (web growth 0..1) derive from its phase
export const recv: Recv = { t: 0, dur: 9, peak: 1, amp: 1, on: false, nodes: 250, frozen: false, phase: 0, sizeK: 1, briK: 1, th: 0.3, degCap: 4, settleMode: 0, sk: 0, sparkle: 0, lastFull: -1e9, lastShim: -1e9, pattern: 'shock', pendCalls: 0, pend: new Map(), seed: 0, hubN: 2 };
export const envE = (p: number): number => (p < 0.18 ? ease(p / 0.18) : p < 0.62 ? 1 : 1 - ease(clamp((p - 0.62) / 0.38, 0, 1)));
export const envW = (p: number): number => (p < 0.42 ? ease(p / 0.42) : p < 0.62 ? 1 : 1 - ease(clamp((p - 0.62) / 0.38, 0, 1)));
export function mulberry32(a: number): () => number { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
// ctx: { diffs:[{ang, rad, title, dC, active, subs}], toolRatio, outPerCall, title } (all optional; X key passes {} = random origin and pattern)
export function triggerReceive(amp: number, ctx?: BurstCtx): void {
  ctx = ctx || {}; amp = clamp(amp, 0.05, 1); const rm = reduced ? 0.6 : 1; const fresh = !(recv.on && !recv.frozen);
  if (fresh) { recv.amp = amp; recv.t = 0; } else { recv.amp = Math.max(recv.amp, amp); recv.t = Math.min(recv.t, 0.4 * recv.dur); }
  recv.dur = lerp(2, 9, recv.amp) * rm; recv.peak = lerp(0.22, 1, recv.amp * recv.amp) * (reduced ? 0.75 : 1);
  if (fresh) H.genBurst(ctx); recv.on = true; if (amp >= 0.35) recv.lastFull = performance.now();
  if (amp > 0.45 && performance.now() - S.lastAnnounce > 2500) { H.say(ctx.title ? `Receiving from ${trunc(ctx.title, 40)}…` : 'Receiving information.'); S.lastAnnounce = performance.now(); }
  H.feedSys(`burst ${recv.pattern} · amp ${recv.amp.toFixed(2)}${ctx.title ? ' · from ' + trunc(ctx.title, 36) : ''}`);
}
// which sessions produced the new calls (diffed per id between two /api/sessions fetches)
export const prevSessMap = new Map<string, SessCounts>();
export function diffSessions(list: SessionSummary[]): SessDelta[] {
  const out: SessDelta[] = [];
  for (const s of list) {
    const cur = { calls: s.calls || 0, tools: s.toolCalls || 0, out: s.tokens ? (s.tokens.output || 0) + (s.tokens.thinking || 0) : 0, tok: s.tokens ? s.tokens.total || 0 : 0 }, p = prevSessMap.get(s.id);
    if (p && (cur.calls > p.calls || cur.tok > p.tok)) out.push({ id: s.id, dC: Math.max(0, cur.calls - p.calls), dT: cur.tools - p.tools, dO: cur.out - p.out, s });
    prevSessMap.set(s.id, cur);
  }
  return out;
}
export function sessAnchor(id: string): { ang: number; rad: number } { const r = S.rings.find((q: Ring) => q.id === id); return r ? { ang: r.a0 + r.rot * r.rotW, rad: Math.max(0.15, r.r) } : { ang: Math.random() * TAU, rad: 0.3 }; }
export function ctxFromPend(): BurstCtx {
  const arr = [...recv.pend.values()].sort((a, b) => b.dC - a.dC); let dC = 0, dT = 0, dO = 0; for (const d of arr) { dC += d.dC; dT += d.dT; dO += d.dO; }
  const ctx: BurstCtx = { diffs: arr.slice(0, 3).map((d) => ({ ...sessAnchor(d.id), title: d.s.title || d.s.firstPrompt, dC: d.dC })) };
  if (dC > 0) { ctx.toolRatio = dT / dC; ctx.outPerCall = dO / dC; } if (arr[0]) ctx.title = arr[0].s.title || arr[0].s.firstPrompt;
  return ctx;
}
// data -> burst, with a ~20 s cooldown: skipped deltas accumulate; inside the cooldown only a sparkle on the live web (or one tiny shimmer)
export function receiveFromDelta(a: SummaryResponse, b: SummaryResponse): void {
  if (!a || !b || !a.totals || !b.totals) return; const dc = (b.totals.calls || 0) - (a.totals.calls || 0), dt = (b.totals.total || 0) - (a.totals.total || 0);
  if (!(dc > 0 || dt > 0)) return;
  const wids = H.waitIds(), dsf = (data.sessDiff || []).filter((d) => !wids.has(d.id)); if ((data.sessDiff || []).length && !dsf.length) return; // the only activity is on a waiting session
  recv.pendCalls += Math.max(dc, 0); for (const d of dsf) { const q = recv.pend.get(d.id); if (q) { q.dC += d.dC; q.dT += d.dT; q.dO += d.dO; q.s = d.s; } else recv.pend.set(d.id, { ...d }); }
  bumpActivity(0.08 + 0.3 * clamp(Math.log10(1 + Math.max(dc, 0)) / 1.7, 0, 1));
  const now = performance.now();
  if (now - recv.lastFull < 20000) { if (recv.on || view.wg > 0.02) recv.sparkle = 1; else if (now - recv.lastShim > 6000) { recv.lastShim = now; triggerReceive(0.12, ctxFromPend()); } return; }
  const amp = 0.1 + 0.9 * clamp(Math.log10(1 + recv.pendCalls) / 1.7, 0, 1); const ctx = ctxFromPend(); recv.pendCalls = 0; recv.pend.clear(); triggerReceive(amp, ctx);
}
export const view: View = { ex: 0, wg: 0, cs: 1, dialR: 0.40, fiberA: 1, act: 0, actT: 0, tint: [...pal.core], tintT: [...pal.core], g: [0, 0, 0], gT: [0, 0, 0], pupil: 0.05, domModel: null };
export const shocks: number[] = [];
export const ghosts: Ring[] = [];
export const shock = (): void => { shocks.push(performance.now() / 1000); if (shocks.length > 5) shocks.shift(); };

export function updateRings(): void {
  const ss = data.sessions || []; const old = new Map<string, Ring>(S.rings.map((r: Ring): [string, Ring] => [r.id, r]));
  const logs = ss.map((s) => Math.log10(1 + (s.tokens ? s.tokens.total : 0)));
  const lo = Math.min(...logs, 99), hi = Math.max(...logs, 0);
  const next = ss.map((s, i) => {
    let r = old.get(s.id); old.delete(s.id);
    if (!r) r = { id: s.id, r: 0, th: 0, a0: 0, span: TAU, alpha: 0, rot: hash(i, 3) * TAU, dir: 1, speed: 0.1, rotW: 1, selK: 0, hovK: 0, act: 0, seed: Math.floor(hash(i, 9) * 1e4), nSeg: 20, iss: [], sev: 0, waitK: 0, idleK: 0, wait: null, obj: null, tilt: [(hash(i, 31) - 0.5) * 0.34, (hash(i, 32) - 0.5) * 0.34, hash(i, 33) * TAU], z: 0 } as Ring;
    r.s = s; r.i = i; r.nl = hi > lo ? (logs[i] - lo) / (hi - lo) : 0.5;
    r.nSeg = clamp(Math.round(6 + (s.calls || 0) / 5), 8, 80);
    queueDetail(s);
    return r;
  });
  old.forEach((r) => { r.dead = true; ghosts.push(r); });
  S.rings = next; S.rings.forEach((r: Ring, i: number) => { r.dir = i % 2 ? -1 : 1; });
  S.sel = clamp(S.sel, 0, Math.max(0, S.rings.length - 1));
}

export function deriveTargets(): void {
  const s = data.summary; if (!s) return; const p = (s.projection || {}) as Partial<ProjectionData>;
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

// late-bound for callers in earlier modules (see shared.ts H)
Object.assign(H, { deriveTargets, diffSessions, receiveFromDelta, shock, updateRings });
