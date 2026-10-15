// Accumulator helpers + shaping of scanner state into API payloads.
import { cfg } from './config.ts';
import type { Acc, AgentStat, AgentTypeTotals, AgentView, AvgRow, DayAcc, DayRow, FileState, Launch, LiveView, PendingTool, Projection, ProjectAcc, ScanMeta, ScannerState, Session, SessionDetail, SessionSummary, SummaryResponse, TimeseriesError, TimeseriesPoint, TimeseriesQuery, TimeseriesResult, TokenCounts, TsUsage, WaitEntry, WaitExtra, WaitInfo, WaitKind, WaitingRow } from './types.ts';

export const newAcc = (): Acc => ({ input: 0, cw5: 0, cw1: 0, cr: 0, out: 0, thinking: 0, calls: 0, tools: 0, web: 0, cost: 0 });
export function addTo(a: Acc, d: Partial<Acc>) { for (const k in d) a[k] += d[k]; }
const tokensOf = (a: Acc): number => a.input + a.cw5 + a.cw1 + a.cr + a.out;
const hitRatio = (a: Acc): number => { const d = a.input + a.cr + a.cw5 + a.cw1; return d > 0 ? a.cr / d : 0; };

function titleOf(s: Session, st: ScannerState): string {
  const ix = st.indexBySid.get(s.id);
  return s.title || (ix && ix.summary) || s.firstPrompt || (ix && ix.firstPrompt) || s.id.slice(0, 8);
}

const accTokens = (a: Acc): TokenCounts => ({ input: a.input, cacheWrite5m: a.cw5, cacheWrite1h: a.cw1, cacheRead: a.cr, output: a.out, thinking: a.thinking, total: tokensOf(a) });
const isLive = (mtime: number, now: number): boolean => now - mtime < cfg.activeWindowMin * 60000;

// ---- waiting for the user ----
// Authoritative: sessions/<pid>.json written by Claude Code (status 'waiting' + a live pid). The transcript's pending tool_use map only enriches it
// (which command / question). Sessions with no status file at all fall back to the old heuristic (idle transcript + pending tool call = 'maybe').
const newest = (a: PendingTool, b: PendingTool): number => ((b.ts || '') < (a.ts || '') ? -1 : 1);
function mkWait(s: Session, fi: FileState | null, p: PendingTool | null, kind: WaitKind, conf: 'certain' | 'maybe', extra: WaitExtra = {}): WaitInfo {
  const aid = fi && fi.isSub ? fi.agentId : null, a = aid ? s.agentStats.get(aid) : null, l: Partial<Launch> = aid ? (s.launches.get(aid) || {}) : {};
  const qs = (p && p.questions) || [];
  return {
    kind, confidence: conf, tool: p ? p.name : '', since: (p && p.ts) || null, agentId: aid,
    agentType: a ? (a.metaType || a.attrType || l.type || 'unknown') : null, agentDescription: a ? (a.metaDesc || l.description || '') : null,
    title: kind === 'question' ? (qs[0] && (qs[0].header || qs[0].question)) || 'question' : kind === 'plan' ? (p && p.planTitle) || 'plan' : p ? `${p.name}${p.summary ? ' · ' + p.summary : ''}` : extra.waitingFor || 'input',
    questions: qs, text: kind === 'question' ? (qs[0] && qs[0].question) || '' : kind === 'plan' ? (p && p.planExcerpt) || '' : p ? `${p.name} ${p.summary || ''}`.trim() : extra.waitingFor || '',
    waitingFor: extra.waitingFor || null, sessionName: extra.sessionName || null,
  };
}
const kindOf = (p: PendingTool): WaitKind => (p.name === 'AskUserQuestion' ? 'question' : p.name === 'ExitPlanMode' ? 'plan' : 'permission');
// sessionId -> { main: wait|null, agents: Map(agentId -> wait) }
export function buildWaitMap(st: ScannerState, now = Date.now()): Map<string, WaitEntry> {
  const m = new Map<string, WaitEntry>();
  const put = (sid: string, w: WaitInfo) => { let e = m.get(sid); if (!e) { e = { main: null, agents: new Map() }; m.set(sid, e); } if (w.agentId) e.agents.set(w.agentId, w); else e.main = w; };
  const files = new Map<string, FileState[]>(); // sid -> files with pending tool calls
  for (const fi of st.files.values()) if (fi.pending && fi.pending.size) { let a = files.get(fi.sid); if (!a) files.set(fi.sid, (a = [])); a.push(fi); }
  const live = st.live || new Map();
  for (const [sid, lv] of live) { // authoritative path
    if (!lv.alive || lv.status !== 'waiting') continue;
    const s = st.sessions.get(sid); if (!s) continue;
    let best: PendingTool | null = null, bfi: FileState | null = null;
    for (const fi of files.get(sid) || []) for (const p of fi.pending.values()) if (!best || newest(p, best) < 0) { best = p; bfi = fi; }
    const wf = lv.waitingFor || '', extra = { waitingFor: wf, sessionName: lv.name || null };
    if (best) { const w = mkWait(s, bfi, best, kindOf(best), 'certain', extra); let n = 0; for (const fi of files.get(sid) || []) n += fi.pending.size; w.pendingCount = n; if (n > 1 && w.kind === 'permission') w.text += ` (+${n - 1} more pending)`; put(sid, w); }
    else { const k = /question/i.test(wf) ? 'question' : /permission/i.test(wf) ? 'permission' : /input/i.test(wf) ? 'question' : 'input'; put(sid, mkWait(s, null, null, k, 'certain', extra)); }
  }
  for (const [sid, list] of files) { // fallback: no status file at all for this session
    if (live.has(sid)) continue; const s = st.sessions.get(sid); if (!s) continue;
    for (const fi of list) {
      if (!(now - fi.mtime < cfg.activeWindowMin * 60000)) continue;
      const defs = [...fi.pending.values()].filter((p) => p.name === 'AskUserQuestion' || p.name === 'ExitPlanMode').sort(newest);
      if (defs[0]) { put(sid, mkWait(s, fi, defs[0], kindOf(defs[0]), 'certain')); continue; }
      if (now - fi.mtime < cfg.waitIdleSec * 1000) continue;
      put(sid, mkWait(s, fi, [...fi.pending.values()].sort(newest)[0], 'permission', 'maybe'));
    }
  }
  return m;
}
export function liveView(st: ScannerState, id: string): LiveView | null {
  const r = st.live && st.live.get(id); if (!r || !r.alive) return null;
  return { status: r.status, waitingFor: r.waitingFor, name: r.name, kind: r.kind, pid: r.pid, statusSince: r.statusSince };
}
const pickWait = (wm: Map<string, WaitEntry> | null, id: string): WaitInfo | null => { const e = wm && wm.get(id); if (!e) return null; let best: WaitInfo | null = null; const score = (w: WaitInfo): number => (w.confidence === 'certain' ? 2 : 0) + (w.agentId ? 0 : 1); for (const w of [e.main, ...e.agents.values()]) if (w && (!best || score(w) > score(best) || (score(w) === score(best) && (w.since || '') > (best.since || '')))) best = w; return best; };

function agentView(s: Session, a: AgentStat, now: number, wm?: Map<string, WaitEntry> | null): AgentView {
  const l: Partial<Launch> = s.launches.get(a.id) || {};
  const models = [...a.models];
  if (!models.length && (a.metaModel || l.model)) models.push(a.metaModel || l.model);
  return {
    id: a.id,
    type: a.metaType || a.attrType || l.type || 'unknown',
    description: a.metaDesc || l.description || '',
    models,
    tokens: accTokens(a.acc),
    cost: a.acc.cost, calls: a.acc.calls, toolCalls: a.acc.tools,
    first: a.first, last: a.last, mtime: a.mtime, effort: a.effort || null,
    isActive: !!a.mtime && isLive(a.mtime, now),
    waiting: (wm && wm.get(s.id) && wm.get(s.id).agents.get(a.id)) || null,
  };
}

export function sessionSummary(s: Session, st: ScannerState, now = Date.now(), wm: Map<string, WaitEntry> | null = null): SessionSummary {
  const cs = s.cs;
  let activeAgents = 0, agentCost = 0, agentTok = 0;
  for (const a of s.agentStats.values()) {
    if (a.mtime && isLive(a.mtime, now)) activeAgents++;
    agentCost += a.acc.cost; agentTok += tokensOf(a.acc);
  }
  return {
    id: s.id,
    title: titleOf(s, st),
    cwd: s.cwd || '',
    gitBranch: s.gitBranch || '',
    version: s.version || '',
    first: s.first || null,
    last: s.last || null,
    durationMs: s.first && s.last ? Date.parse(s.last) - Date.parse(s.first) : 0,
    turnMs: s.turnMs,
    models: [...s.models.keys()],
    tokens: { input: s.acc.input, cacheWrite5m: s.acc.cw5, cacheWrite1h: s.acc.cw1, cacheRead: s.acc.cr, output: s.acc.out, thinking: s.acc.thinking, total: tokensOf(s.acc) },
    cost: s.acc.cost,
    reported: cs ? {
      cost: cs.totalCostUSD ?? null, linesAdded: cs.totalLinesAdded ?? 0, linesRemoved: cs.totalLinesRemoved ?? 0,
      apiMs: cs.totalAPIDuration ?? 0, toolMs: cs.totalToolDuration ?? 0,
    } : null,
    promptCount: s.promptCount,
    firstPrompt: s.firstPrompt || '',
    calls: s.acc.calls,
    toolCalls: s.acc.tools,
    subagents: Math.max(s.agents.size, s.agentStats.size),
    activeAgents, agentCost, agentTokens: agentTok,
    mtime: s.mtime,
    isActive: now - s.mtime < cfg.activeWindowMin * 60000,
    effort: s.effort || null,
    permissionMode: s.permissionMode || null,
    sessionKind: s.sessionKind || null,
    agentName: s.agentName || null,
    waiting: pickWait(wm, s.id),
    live: liveView(st, s.id),
  };
}

export function buildSessionList(st: ScannerState, { limit = 200, sort = 'last' }: { limit?: number; sort?: string } = {}): SessionSummary[] {
  const now = Date.now();
  const wm = buildWaitMap(st, now);
  const all = [...st.sessions.values()].filter((s) => s.first || s.acc.calls).map((s) => sessionSummary(s, st, now, wm));
  const keyf: (x: SessionSummary) => number = sort === 'cost' ? (x) => x.cost : sort === 'tokens' ? (x) => x.tokens.total : (x) => Date.parse((x.last || 0) as string) || 0;
  all.sort((a, b) => keyf(b) - keyf(a));
  const top = all.slice(0, limit);
  const have = new Set(top.map((x) => x.id));
  for (const x of all) if ((x.isActive || (x.live && x.live.status === 'waiting')) && !have.has(x.id)) top.push(x);
  return top;
}

export function buildSessionDetail(st: ScannerState, id: string): SessionDetail | null {
  const s = st.sessions.get(id);
  if (!s) return null;
  const now = Date.now(), wm = buildWaitMap(st, now);
  const base = sessionSummary(s, st, now, wm);
  const models = [...s.models.entries()].map(([model, a]) => ({ model, ...a, total: tokensOf(a), unknownPricing: !!a.unknownPricing }));
  const hourly = [...s.hourly.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([hour, v]) => ({ hour, ...v }));
  const agents = [...s.agentStats.values()].map((a) => agentView(s, a, now, wm)).sort((a, b) => (Date.parse((b.last || 0) as string) || 0) - (Date.parse((a.last || 0) as string) || 0));
  const main = { tokens: accTokens(s.main), cost: s.main.cost, calls: s.main.calls };
  const calls = s.calls.slice().sort((a, b) => a.t - b.t).slice(-3000);
  return { ...base, callCount: base.calls, calls, agents, main, prompts: s.prompts.slice(), models: models, perModel: models, hourly, cacheHit: hitRatio(s.acc) };
}

const DAY = 86400000;
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function buildProjection(st: ScannerState, now = Date.now()): Projection {
  const real = [...st.days.keys()].filter((k) => k !== 'unknown');
  if (real.length < 2) return { insufficient: true };
  const todayMs = Math.floor(now / DAY) * DAY;
  const dayRow = (date: string): DayRow => {
    const d = st.days.get(date) || newAcc();
    return { date, input: d.input, cw5: d.cw5, cw1: d.cw1, cr: d.cr, out: d.out, calls: d.calls, cost: d.cost, prompts: st.histDays.get(date) || 0, total: d.input + d.cw5 + d.cw1 + d.cr + d.out, byModel: (st.days.get(date) || {}).byModel || {} };
  };
  const lastN = (n: number): DayRow[] => Array.from({ length: n }, (_, i) => dayRow(iso(todayMs - (n - 1 - i) * DAY)));
  const avg = (rows: DayRow[], div: number): AvgRow => {
    const a = { input: 0, cacheWrite: 0, cacheRead: 0, output: 0, total: 0, cost: 0, calls: 0 };
    for (const r of rows) { a.input += r.input; a.cacheWrite += r.cw5 + r.cw1; a.cacheRead += r.cr; a.output += r.out; a.total += r.total; a.cost += r.cost; a.calls += r.calls; }
    if (div > 0) for (const k in a) a[k] /= div;
    return a;
  };
  const r7 = lastN(7), r30 = lastN(30);
  const avg7 = avg(r7, 7), avg30 = avg(r30, 30);
  const act7 = r7.filter((r) => r.calls > 0).length, act30 = r30.filter((r) => r.calls > 0).length;
  const avgActive30 = avg(r30.filter((r) => r.calls > 0), act30);

  const t = r30[29];
  const hours = Math.max((now - todayMs) / 3600000, 0.25);
  const today = {
    date: t.date, tokens: t.total, cost: t.cost, calls: t.calls, hoursElapsed: hours,
    pace: { cost: (t.cost * 24) / hours, tokens: (t.total * 24) / hours },
  };

  const n = 30; let sx = 0, sy = 0, sxy = 0, sxx = 0;
  r30.forEach((r, x) => { sx += x; sy += r.cost; sxy += x * r.cost; sxx += x * x; });
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const trend30 = { costPerDayDelta: slope, pct: avg30.cost > 0 ? ((slope * 30) / avg30.cost) * 100 : 0 };

  const nowD = new Date(todayMs);
  const first = Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth(), 1);
  const dim = new Date(Date.UTC(nowD.getUTCFullYear(), nowD.getUTCMonth() + 1, 0)).getUTCDate();
  const daysElapsed = nowD.getUTCDate();
  const daysRemaining = dim - daysElapsed;
  let mt = 0, mc = 0;
  for (let ms = first; ms <= todayMs; ms += DAY) { const r = dayRow(iso(ms)); mt += r.total; mc += r.cost; }
  const monthToDate = { tokens: mt, cost: mc, daysElapsed, daysRemaining };
  const projectedMonth = {
    cost: mc + daysRemaining * avg7.cost, tokens: mt + daysRemaining * avg7.total, basis: 'avg7' as const,
    costAlt: mc + daysRemaining * avg30.cost, tokensAlt: mt + daysRemaining * avg30.total,
  };
  const next7 = { cost: avg7.cost * 7, tokens: avg7.total * 7 };
  const next30 = { cost: avg7.cost * 30, tokens: avg7.total * 30 };

  const mcost: Record<string, number> = {}; let tot30 = 0;
  for (const r of r30) for (const [m, a] of Object.entries(r.byModel)) { mcost[m] = (mcost[m] || 0) + a.cost; tot30 += a.cost; }
  const perModelMonth = Object.entries(mcost).map(([model, c]) => {
    const share = tot30 > 0 ? c / tot30 : 0;
    return { model, share, cost: share * projectedMonth.cost };
  }).sort((a, b) => b.cost - a.cost);

  const forecastDays = Array.from({ length: 14 }, (_, i) => ({ date: iso(todayMs + (i + 1) * DAY), total: avg7.total, cacheRead: avg7.cacheRead, cost: avg7.cost }));
  const history = lastN(60).map(({ byModel, ...r }) => r);
  return { today, avg7, avg30, activeDays7: act7, activeDays30: act30, avgActive30, trend30, monthToDate, projectedMonth, next7, next30, perModelMonth, forecastDays, history };
}

export function buildSummary(st: ScannerState, scanMeta: ScanMeta): SummaryResponse {
  const now = Date.now();
  let reported = 0;
  for (const s of st.sessions.values()) if (s.cs && typeof s.cs.totalCostUSD === 'number') reported += s.cs.totalCostUSD;
  const totalCost = st.total.cost;
  const perModel = [...st.models.entries()].map(([model, a]) => ({
    model, ...a, total: tokensOf(a), costShare: totalCost > 0 ? a.cost / totalCost : 0,
  })).sort((a, b) => b.cost - a.cost || b.total - a.total);

  const dayKeys = new Set([...st.days.keys(), ...st.histDays.keys()]);
  const perDay = [...dayKeys].sort().map((date) => {
    const d: DayAcc = st.days.get(date) || { ...newAcc(), byModel: {} };
    return { date, ...d, total: tokensOf(d), prompts: st.histDays.get(date) || 0 };
  });

  const perProject = [...st.projects.entries()].map(([cwd, p]) => ({
    cwd, ...(Object.fromEntries(Object.entries(p).filter(([k]) => k !== 'sessions')) as Omit<ProjectAcc, 'sessions'>),
    total: tokensOf(p), sessions: p.sessions.size, prompts: st.histProjects.get(cwd) || 0,
  })).sort((a, b) => b.cost - a.cost);

  const sessions = [...st.sessions.values()];
  const wm = buildWaitMap(st, now);
  const active = sessions.filter((s) => now - s.mtime < cfg.activeWindowMin * 60000).map((s) => sessionSummary(s, st, now, wm));
  const waiting: WaitingRow[] = [];
  for (const [sid, e] of wm) { const s = st.sessions.get(sid), ttl = s ? titleOf(s, st) : sid.slice(0, 8); for (const w of [e.main, ...e.agents.values()]) if (w) waiting.push({ sessionId: sid, sessionTitle: ttl, ...w }); }
  waiting.sort((a, b) => ((b.since || '') < (a.since || '') ? -1 : 1));
  active.sort((a, b) => b.mtime - a.mtime);

  const perAgentType: Record<string, AgentTypeTotals> = {};
  const bumpType = (type: string, tokens: number, cost: number) => {
    const t = perAgentType[type] || (perAgentType[type] = { runs: 0, tokens: 0, cost: 0 });
    t.runs++; t.tokens += tokens; t.cost += cost;
  };
  let activeAgents = 0;
  for (const s of sessions) {
    if (s.main.calls || s.main.tools) bumpType('main', tokensOf(s.main), s.main.cost);
    for (const a of s.agentStats.values()) {
      const v = agentView(s, a, now);
      bumpType(v.type, v.tokens.total, v.cost);
      if (v.isActive) activeAgents++;
    }
  }

  return {
    activeAgents, perAgentType,
    totals: { ...st.total, total: tokensOf(st.total), cacheHit: hitRatio(st.total), reportedCost: reported, sessions: sessions.length },
    perModel, perDay, perProject, projection: buildProjection(st, now),
    effort: st.effort, tier: st.tier, speed: st.speed, geo: st.geo, hours: st.hours,
    settings: st.settings, statsCache: st.statsCache,
    scan: scanMeta,
    activeSessions: active, waiting,
    live: [...(st.live || new Map()).values()].filter((r) => r.alive).map((r) => ({ sessionId: r.sessionId, name: r.name, status: r.status, waitingFor: r.waitingFor, statusSince: r.statusSince, cwd: r.cwd })),
    config: { refreshMs: cfg.refreshMs, activeWindowMin: cfg.activeWindowMin, waitIdleSec: cfg.waitIdleSec, claudeHome: cfg.claudeHome },
  };
}

const BUCKETS: Record<string, number> = { '1m': 60000, '5m': 300000, '1h': 3600000, '6h': 21600000, '1d': DAY };
const DEFAULT_BUCKET: Record<string, string> = { today: '5m', '7d': '1h', '30d': '6h', all: '1d' };

// Usage per time bucket and model. Window starts at the same UTC-midnight cutoff as the UI's Today/7d/30d.
export function buildTimeseries(st: ScannerState, { window = '7d', bucket, model, session, scope = 'all' }: TimeseriesQuery = {}, now = Date.now()): TimeseriesResult | TimeseriesError {
  if (!DEFAULT_BUCKET[window]) window = '7d';
  const bName = BUCKETS[bucket] ? bucket : DEFAULT_BUCKET[window];
  const bucketMs = BUCKETS[bName];
  const only = model ? new Set(String(model).split(',').filter(Boolean)) : null;
  const sessions = session ? [st.sessions.get(session)].filter(Boolean) : [...st.sessions.values()];
  const days = window === 'today' ? 0 : window === '7d' ? 6 : window === '30d' ? 29 : -1;
  let lo = days >= 0 ? Math.floor(now / DAY) * DAY - days * DAY : Infinity;
  let hi = days >= 0 ? now : -Infinity;
  const models = new Set<string>(), agg = new Map<number, Record<string, TsUsage>>();
  for (const s of sessions) {
    for (const [mk, inner] of s.ts) {
      if (days >= 0 && mk < lo) continue;
      for (const [k, v] of inner) {
        const isAgent = k[0] === 'a', m = k.slice(2);
        if (scope === 'main' && isAgent) continue;
        if (scope === 'agents' && !isAgent) continue;
        models.add(m);
        if (only && !only.has(m)) continue;
        if (days < 0) { if (mk < lo) lo = mk; if (mk > hi) hi = mk; }
        const bk = Math.floor(mk / bucketMs) * bucketMs;
        let pm = agg.get(bk);
        if (!pm) { pm = {}; agg.set(bk, pm); }
        const x = pm[m] || (pm[m] = { input: 0, cw5: 0, cw1: 0, cr: 0, out: 0, think: 0, calls: 0, cost: 0 });
        for (const f in x) x[f] += v[f];
      }
    }
  }
  const points: TimeseriesPoint[] = [];
  if (Number.isFinite(lo) && Number.isFinite(hi)) {
    const start = Math.floor(lo / bucketMs) * bucketMs, end = Math.floor(hi / bucketMs) * bucketMs;
    if ((end - start) / bucketMs > 20000) return { error: 'too many buckets' };
    for (let t = start; t <= end; t += bucketMs) points.push({ t, perModel: agg.get(t) || {} });
  }
  return { window, bucket: bName, bucketMs, scope, models: [...models].sort(), points };
}
