import { H, S } from './shared.ts';
import { demoLost, params, voice } from './dom.ts';
import type { HistEntry, SessionSummary, SummaryResponse, TimeseriesResult } from '../../src/types.ts';
import type { SessDelta } from './state.ts';

/* ============================================================ data layer */
// per-model series on the timeseries grid: vals/cost are [model][bucket]; calls/total are [bucket]
export interface Series { n: number; t0: number; bucketMs: number; models: string[]; vals: Float32Array[]; cost: Float32Array[]; calls: Float32Array; total: Float32Array; max: number }
// one stripe on the 12h dial: k = hours ago
export interface ClockStripe { pos: number; hour: number; calls: number; cost: number; k: number }
export interface Data { summary: SummaryResponse | null; sessions: SessionSummary[]; series: Series | null; series7: Series | null; history: HistEntry[]; lastOk: number; lost: boolean; lostSince: number; sessDiff?: SessDelta[] }

export const demo = params.get('demo') === 'issues', demo2 = params.get('demo') === 'waiting';
export const api = { async get<T>(url: string): Promise<T> { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); } };
export const data: Data = { summary: null, sessions: [], series: null, series7: null, history: [], lastOk: 0, lost: false, lostSince: 0 };
if (demoLost) { data.lost = true; data.lostSince = Date.now() - (parseFloat(params.get('lostfor') ?? '') || 20) * 1000; }

export function buildSeries(ts: TimeseriesResult): Series | null {
  if (!ts || !ts.points) return null;
  const n = ts.points.length, models = ts.models || []; const vals = models.map(() => new Float32Array(n)); const cost = models.map(() => new Float32Array(n));
  const calls = new Float32Array(n); const total = new Float32Array(n);
  ts.points.forEach((p, i) => { for (let k = 0; k < models.length; k++) { const m = p.perModel && p.perModel[models[k]]; if (!m) continue; const t = (m.input || 0) + (m.cw5 || 0) + (m.cw1 || 0) + (m.cr || 0) + (m.out || 0) + (m.think || 0); vals[k][i] = t; cost[k][i] = m.cost || 0; total[i] += t; calls[i] += m.calls || 0; } });
  let max = 1; for (let i = 0; i < n; i++) if (total[i] > max) max = total[i];
  return { n, t0: n ? ts.points[0].t : 0, bucketMs: ts.bucketMs, models, vals, cost, calls, total, max };
}

// last 12 local hours as stripes on a 12h dial: [{pos, hour, calls, cost, k}] (k = hours ago)
export function clockHours(): ClockStripe[] {
  const sr = data.series7, out: ClockStripe[] = []; const t0h = new Date(); t0h.setMinutes(0, 0, 0); const cur = t0h.getTime();
  for (let k = 0; k < 12; k++) { const t = cur - k * 3600e3, hour = new Date(t).getHours(); let calls = 0, cost = 0;
    if (sr && sr.bucketMs === 3600e3) { const i = Math.round((t - sr.t0) / sr.bucketMs); if (i >= 0 && i < sr.n) { calls = sr.calls[i]; for (let m = 0; m < sr.models.length; m++) cost += sr.cost[m][i]; } }
    out.push({ pos: hour % 12, hour, calls, cost, k }); }
  return out;
}
export async function refresh(reason: string): Promise<void> {
  const jobs: [Promise<SummaryResponse>, Promise<SessionSummary[]>, Promise<TimeseriesResult>, Promise<HistEntry[]>, Promise<TimeseriesResult>] = [api.get<SummaryResponse>('/api/summary'), api.get<SessionSummary[]>('/api/sessions?limit=16&sort=last'), api.get<TimeseriesResult>('/api/timeseries?window=today&bucket=5m&scope=all'), api.get<HistEntry[]>('/api/history?limit=5'), api.get<TimeseriesResult>('/api/timeseries?window=7d&bucket=1h&scope=all')];
  const res = await Promise.allSettled(jobs);
  const prev = data.summary; let ok = 0;
  if (res[0].status === 'fulfilled') { data.summary = res[0].value; S.refreshMs = (data.summary.config && data.summary.config.refreshMs) || 5000; ok++; }
  if (res[1].status === 'fulfilled') { data.sessions = res[1].value || []; data.sessDiff = H.diffSessions(data.sessions); H.updateRings(); ok++; }
  if (res[2].status === 'fulfilled') { data.series = buildSeries(res[2].value); ok++; }
  if (res[3].status === 'fulfilled') { data.history = res[3].value || []; H.feedHistory(); }
  if (res[4] && res[4].status === 'fulfilled') data.series7 = buildSeries(res[4].value);
  if (ok === 0) { if (!data.lost) { data.lost = true; data.lostSince = Date.now(); H.say('Signal lost. Searching...'); } H.setLink(); return; }
  const wasLost = data.lost && !demoLost; data.lost = demoLost; data.lastOk = Date.now();
  H.deriveTargets(); H.updateHud(); H.setLink(); H.renderLegend(); H.issuesChanged(true); H.syncWaitData();
  for (const as of (data.summary.activeSessions || [])) if (as && as.id && as.last) H.queueDetail(as);
  if (wasLost) { H.say('Signal restored.'); S.flash = 1; }
  else if (reason === 'update') H.announceChange(prev, data.summary);
  if (reason === 'update' || reason === 'poll') H.receiveFromDelta(prev, data.summary);
  else if (!voice.started) { voice.started = true; H.rotateVoice(true); }
  if (params.get('detail') === '1' && !S.detailOpen) { params.delete('detail'); H.openDetail(); }
}

export let debounceT: ReturnType<typeof setTimeout> | number = 0;
let probing = false;
export function connectEvents(): void {
  let es: EventSource; try { es = new EventSource('/api/events'); } catch (e) { return; }
  es.onmessage = (ev) => { let m: { type?: string }; try { m = JSON.parse(ev.data); } catch (e) { return; } if (m.type === 'update') { H.feedSys('sse update'); H.shock(); clearTimeout(debounceT); debounceT = setTimeout(() => refresh('update'), 1000); } };
  es.onerror = () => { H.setLink(true); if (!probing) { probing = true; setTimeout(() => { probing = false; refresh('poll'); }, 1500); } }; // probe soon so a dead server shows as lost within seconds
  es.onopen = () => H.setLink();
}
