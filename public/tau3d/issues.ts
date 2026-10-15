import { H, S } from './shared.ts';
import { fmtTok } from './util.ts';
import { feed, hudEls, voice } from './dom.ts';
import { api, data, demo } from './data.ts';
import type { ProjectionData, SessionDetail, SessionSummary, SummaryResponse } from '../../src/types.ts';
import type { Ring } from './state.ts';

/* ============================================================ issues layer */
// issuesFor(session) -> [{kind, severity:'error'|'warn', count, msg, t}]
// Sources: session.issues (future API field), client-derived details (/api/sessions/:id calls[].ctx), demo injection.
export interface Issue { kind: string; severity: 'error' | 'warn'; count: number; msg: string; t: number }
// anything that may carry raw (future API) issues; normalised by normIssue
export interface IssueSource { id: string; issues?: Partial<Issue>[] }
export interface IssueEntry { last?: string | null; issues: Issue[]; pending?: string | null } // id -> { last, issues, pending }
export const issueCache = new Map<string, IssueEntry>();
export const fetchQ: SessionSummary[] = []; export let fetching = 0;
export const normIssue = (x: Partial<Issue>): Issue => ({ kind: String(x.kind || 'issue'), severity: x.severity === 'error' ? 'error' : 'warn', count: +x.count || 1, msg: String(x.msg || x.kind || ''), t: x.t || Date.now() });
export function deriveIssues(d: SessionDetail): Issue[] {
  const out: Issue[] = []; const calls = (d.calls || []).filter((c) => !c.agentId); // main agent only
  let comp = 0, tc = 0;
  for (let i = 1; i < calls.length; i++) { const a = calls[i - 1].ctx || 0, b = calls[i].ctx || 0; if (a > 20000 && b < a * 0.5) { comp++; tc = calls[i].t; } }
  if (comp) out.push({ kind: 'compaction', severity: 'warn', count: comp, msg: 'memory compressed', t: tc });
  const last = calls.length ? calls[calls.length - 1].ctx || 0 : 0;
  if (last > 150000) out.push({ kind: 'context', severity: 'warn', count: 1, msg: `context pressure ${fmtTok(last)}`, t: calls[calls.length - 1].t });
  return out;
}
export function queueDetail(s: SessionSummary): void {
  const c = issueCache.get(s.id); if (c && (c.last === s.last || c.pending === s.last)) return;
  issueCache.set(s.id, { ...(c || { issues: [] }), pending: s.last }); fetchQ.push(s); pumpQ();
}
export function pumpQ(): void {
  while (fetching < 3 && fetchQ.length) {
    const s = fetchQ.shift(); fetching++;
    api.get<SessionDetail>('/api/sessions/' + encodeURIComponent(s.id)).then((d) => { issueCache.set(s.id, { last: s.last, issues: deriveIssues(d) }); if (s.isActive || H.feedActive(s)) H.feedIngest(s, d); })
      .catch(() => issueCache.set(s.id, { last: s.last, issues: [] })).finally(() => { fetching--; issuesChanged(); pumpQ(); });
  }
}
export const DEMO: Record<number, Omit<Issue, 't'>[]> = {
  2: [{ kind: 'tool_failure', severity: 'error', count: 4, msg: '4 tool failures' }],
  5: [{ kind: 'api_error', severity: 'error', count: 2, msg: '2 API errors, retries exhausted' }],
  4: [{ kind: 'compaction', severity: 'warn', count: 2, msg: 'memory compressed' }],
  7: [{ kind: 'context', severity: 'warn', count: 1, msg: 'context pressure 171k' }],
  9: [{ kind: 'tool_failure', severity: 'error', count: 1, msg: '1 tool failure' }],
};
export function issuesFor(s: IssueSource): Issue[] {
  const out: Issue[] = [];
  if (Array.isArray(s.issues)) out.push(...s.issues.map(normIssue));
  const c = issueCache.get(s.id); if (c) out.push(...c.issues.map(normIssue));
  if (demo) { const i = data.sessions.findIndex((x) => x.id === s.id); if (DEMO[i]) out.push(...DEMO[i].map((x) => normIssue({ ...x, t: Date.now() - 60000 * (i + 1) }))); }
  return out;
}
export function globalIssues(): Issue[] {
  const s = data.summary as SummaryResponse & { issues?: Partial<Issue>[] }; if (!s) return []; const out: Issue[] = [];
  if (Array.isArray(s.issues)) out.push(...s.issues.map(normIssue));
  const pj = (s.projection || {}) as Partial<ProjectionData>; if (pj.today && pj.avg7 && pj.avg7.cost > 0 && pj.today.cost > 1.5 * pj.avg7.cost) out.push({ kind: 'burn', severity: 'warn', count: 1, msg: `today's burn is ${(pj.today.cost / pj.avg7.cost).toFixed(1)}x the 7-day average`, t: Date.now() });
  return out;
}
export const announced = new Set<string>();
export function issuesChanged(fromRefresh?: boolean): void {
  let n = globalIssues().length; const fresh: { i: number; x: Issue }[] = [];
  S.rings.forEach((r: Ring, i: number) => { r.iss = issuesFor(r.s); r.sev = r.iss.some((x) => x.severity === 'error') ? 2 : r.iss.length ? 1 : 0; n += r.iss.length; r.iss.forEach((x) => { const key = r.id + ':' + x.kind + ':' + x.count; if (!announced.has(key)) { if (voice.started) announced.add(key); fresh.push({ i, x }); } }); });
  globalIssues().forEach((x) => { const key = 'g:' + x.kind; if (!announced.has(key)) { if (voice.started) announced.add(key); fresh.push({ i: -1, x }); } });
  hudEls.iss.textContent = String(n); hudEls.iss.classList.toggle('bad', n > 0);
  for (const f of fresh) { const k = 'e:' + (f.i < 0 ? 'g' : S.rings[f.i].id) + f.x.kind + f.x.count; if (!feed.seen.has(k)) { feed.seen.add(k); H.feedPush('e', `! ${f.i < 0 ? 'global' : 'memory ' + (f.i + 1)}: ${f.x.msg}`); } }
  if (fresh.length && voice.started) {
    fresh.sort((a, b) => Number(b.x.severity === 'error') - Number(a.x.severity === 'error')); const f = fresh[0];
    H.say(f.i < 0 ? `Warning: ${f.x.msg}.` : f.x.severity === 'error' ? `Memory ${f.i + 1} is fragmenting: ${f.x.msg}.` : `Memory ${f.i + 1}: ${f.x.msg}.`);
    S.lastAnnounce = performance.now();
  }
}

// late-bound for callers in earlier modules (see shared.ts H)
Object.assign(H, { issuesChanged, queueDetail });
