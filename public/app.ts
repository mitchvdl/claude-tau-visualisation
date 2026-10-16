// claude-stats frontend: plain ES module, no framework, no inline handlers.

// ---------- types ----------
// Response shapes of /api/* as this file reads them (mirrors src/aggregate.ts). Move to a shared module later.
interface Counts { input: number; cw5: number; cw1: number; cr: number; out: number; thinking: number; calls: number; tools: number; web: number; cost: number }
interface Totals extends Counts { prompts: number; total?: number }
interface ModelAgg extends Counts { model: string; total?: number }
interface ModelStat extends ModelAgg { total: number; unknownPricing: boolean }
interface ModelRow extends ModelAgg { share: number; unknownPricing: boolean }
interface DayRow { date: string; input: number; cw5: number; cw1: number; cr: number; out: number; cost: number; calls: number; total: number; prompts: number; thinking?: number; tools?: number; web?: number; byModel?: Record<string, Counts> }
interface ProjectRow { cwd: string; sessions: number; calls: number; total: number; cr: number; out: number; cost: number; last: string }
interface AgentTypeRow { type: string; runs: number; tokens: number; cost: number }
interface ProjAvg { total: number; cost: number; calls: number }
interface Projection {
  insufficient?: boolean;
  today: { tokens: number; cost: number; pace: { cost: number } };
  avg7: ProjAvg;
  trend30: { costPerDayDelta: number; pct: number };
  monthToDate: { cost: number; daysRemaining: number };
  projectedMonth: { cost: number; costAlt: number };
  next30: { cost: number; tokens: number };
  forecastDays: { date: string; total: number; cacheRead: number }[];
  history: DayRow[];
}
interface Settings { model?: string | null; effortLevel?: string | null; alwaysThinkingEnabled?: boolean | null }
interface StatsCache {
  lastComputedDate?: string; firstSessionDate?: string; totalSessions: number; totalMessages: number;
  longestSession?: { duration: number; messageCount: number };
  modelUsage?: Record<string, { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; costUSD: number }>;
  hourCounts?: Record<string, number>;
}
interface ScanMeta { lastScan: string; scanMs: number; filesScanned: number; bytesRead: number; malformed: number; scans: number }
interface Summary {
  activeAgents: number;
  perAgentType: Record<string, { runs: number; tokens: number; cost: number }>;
  perModel: ModelStat[];
  perDay: DayRow[];
  perProject: ProjectRow[];
  projection: Projection;
  effort: Record<string, number>; tier: Record<string, number>; speed: Record<string, number>; geo: Record<string, number>;
  hours: number[];
  settings: Settings | null;
  statsCache: StatsCache | null;
  scan: ScanMeta;
  activeSessions: SessionRow[];
  config: { refreshMs: number; activeWindowMin: number; waitIdleSec: number; claudeHome: string };
}
interface TokenCounts { input: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number; output: number; thinking: number; total: number }
interface Reported { cost: number | null; linesAdded: number; linesRemoved: number; apiMs: number; toolMs: number }
interface SessionRow {
  id: string; title: string; cwd: string; gitBranch: string; version: string;
  first: string | null; last: string | null; durationMs: number; turnMs: number;
  models: string[]; tokens: TokenCounts; cost: number; reported: Reported | null;
  promptCount: number; calls: number; toolCalls: number; subagents: number; activeAgents: number; agentCost: number;
  isActive: boolean; effort: string | null; permissionMode: string | null; sessionKind: string | null;
}
// /api/sessions/:id
interface CallPoint { t: number; model: string; ctx: number; agentId?: string | null }
interface AgentView { id: string; type: string; description: string; models: string[]; tokens: TokenCounts; cost: number; calls: number; first: string | null; last: string | null; isActive: boolean }
// `models` is left out: the detail payload overwrites it with the per-model objects in perModel.
interface SessionDetail extends Omit<SessionRow, 'calls' | 'models'> {
  callCount: number; calls: CallPoint[]; cacheHit: number;
  hourly: { hour: string; tokens: number; cost: number }[];
  perModel: ModelStat[];
  prompts: { ts: string | null; text: string }[];
  agents: AgentView[];
  main: { tokens: TokenCounts; cost: number; calls: number };
}
// /api/timeseries
interface TsCounts { input: number; cw5: number; cw1: number; cr: number; out: number; calls: number; cost: number }
interface TimeSeries { window: string; bucket: string; bucketMs: number; scope: string; models: string[]; points: { t: number; perModel: Record<string, TsCounts> }[] }
interface TsRow { input: number; cw: number; cr: number; out: number; cost: number; calls: number }
// /api/history
interface HistEntry { ts: number; display: string; project: string; sessionId: string }

// ---------- client state ----------
interface TsState { scope: string; off: Set<string>; data: TimeSeries; tok: number; hideAg?: boolean }
interface AppState { sum: Summary; sessions: SessionRow[]; hist: HistEntry[]; win: string; modelOrder: string[]; hideCR: boolean; openId: string | null; sseOpen: boolean; lastOk: number; lastDetail?: SessionDetail; ts?: TsState }

// ---------- DOM / table helpers ----------
// Expando fields set on DOM nodes (render caches, tween state).
interface Expando extends HTMLElement { _v?: number; _raf?: number; _m?: string; _k?: string }
type Attrs = Record<string, string | boolean | null | undefined>;
type Kid = Node | string | null | undefined | Node[];
type KvRow = [string, unknown, string?];
interface Col<T> { key: string; label: string; num?: boolean; cls?: string; hint?: string; val: (r: T) => string | number; fmt?: (r: T) => string; title?: (r: T) => string; render?: (td: Expando, r: T) => void }
interface TableOpts<T> { key: (r: T) => string; sortKey: string; dir?: number; pin?: (r: T) => boolean; onClick?: (r: T) => void; rowClass?: (r: T) => string }
interface TableApi<T> { items: T[]; update(items: T[]): void }
interface RowState<T> { tds: Expando[]; tr: HTMLElement; item?: T }
interface Tables { models: TableApi<ModelRow>; agentTypes: TableApi<AgentTypeRow>; projects: TableApi<ProjectRow>; sessions: TableApi<SessionRow>; byDay: TableApi<DayRow>; daily: TableApi<DayRow> }

// ---------- Chart.js: CDN global loaded by a script tag before this module (not an npm dependency) ----------
declare const Chart: any;
interface ChartDataset {
  label?: string; type?: string; data: unknown[]; parsing?: boolean; showLine?: boolean; yAxisID?: string; order?: number;
  backgroundColor?: string | string[] | CanvasPattern; borderColor?: string; borderWidth?: number; borderRadius?: number; borderSkipped?: string | boolean; maxBarThickness?: number;
  categoryPercentage?: number; barPercentage?: number; pointRadius?: number; pointHoverRadius?: number; pointBackgroundColor?: string; pointBorderColor?: string; pointBorderWidth?: number; tension?: number;
}
interface ChartData { labels?: string[]; datasets: ChartDataset[] }
interface ChartCallbacks { title?: (items: any[]) => string; label?: (c: any) => string } // Chart.js context objects, left loose
interface ChartAxis {
  type?: string; position?: string; min?: number; max?: number; stacked?: boolean; beginAtZero?: boolean;
  grid?: { color?: string; display?: boolean; drawOnChartArea?: boolean };
  border?: { color?: string; display?: boolean };
  ticks: { color?: string; font?: { family?: string; size?: number }; maxRotation?: number; autoSkip?: boolean; maxTicksLimit?: number; callback?: (v: any) => string };
}
interface ChartOpts {
  responsive?: boolean; maintainAspectRatio?: boolean; animation?: boolean;
  interaction?: { mode: string; intersect: boolean };
  indexAxis?: string; cutout?: string;
  plugins: {
    legend: { display?: boolean; position?: string; labels?: { color?: string; boxWidth?: number; boxHeight?: number; font?: { family?: string; size?: number } } };
    tooltip: { backgroundColor?: string; borderColor?: string; borderWidth?: number; titleColor?: string; bodyColor?: string; bodyFont?: { family?: string }; titleFont?: { family?: string }; padding?: number; callbacks?: ChartCallbacks };
  };
  scales?: { [id: string]: ChartAxis };
}
interface ChartLike { canvas: HTMLElement; data: ChartData; options: ChartOpts; destroy(): void; update(mode?: string): void; isDatasetVisible(i: number): boolean; setDatasetVisibility(i: number, visible: boolean): void }

const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const hasChart = typeof Chart !== 'undefined';

// ---------- helpers ----------
function h(tag: string, attrs?: Attrs | null, ...kids: Kid[]): HTMLElement {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v as string; else if (k === 'text') e.textContent = v as string; else e.setAttribute(k, v === true ? '' : v as string);
  }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
}
const nf = new Intl.NumberFormat('en-US');
const full = (n: number) => nf.format(Math.round(n || 0));
function compact(n: number): string {
  n = n || 0;
  const a = Math.abs(n);
  const u: [number, string] | null = a >= 1e12 ? [1e12, 'T'] : a >= 1e9 ? [1e9, 'B'] : a >= 1e6 ? [1e6, 'M'] : a >= 1e3 ? [1e3, 'k'] : null;
  if (!u) return String(Math.round(n));
  const v = n / u[0];
  return (Math.abs(v) < 10 ? v.toFixed(2) : Math.abs(v) < 100 ? v.toFixed(1) : v.toFixed(0)) + u[1];
}
const money = (c: number) => (c > 0 && c < 0.01 ? '$' + c.toFixed(4) : '$' + (c || 0).toFixed(2));
const pct = (r: number) => ((r || 0) * 100).toFixed(1) + '%';
function rel(ts: number | string): string {
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!t) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return Math.floor(s) + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
function dur(ms: number): string {
  if (!ms || ms < 0) return '0m';
  const m = Math.round(ms / 60000);
  if (m < 60) return m + 'm';
  const hh = Math.floor(m / 60);
  return hh < 48 ? hh + 'h ' + (m % 60) + 'm' : Math.floor(hh / 24) + 'd ' + (hh % 24) + 'h';
}
const base = (p: string) => (p ? p.split('/').filter(Boolean).slice(-2).join('/') || p : '(unknown)');
const short = (m: string) => String(m).replace(/^claude-/, '');
const cssv = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const store = {
  get(k: string): string | null { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string): void { try { localStorage.setItem(k, v); } catch { /* ignore */ } },
};

function tween(el: Expando, to: number, fmt: (n: number) => string): void {
  const from = el._v ?? 0;
  el._v = to;
  cancelAnimationFrame(el._raf);
  if (from === to || matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / 350), e = 1 - Math.pow(1 - k, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (k < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

// ---------- state ----------
const S: AppState = { sum: null, sessions: [], hist: [], win: store.get('win') || '7d', modelOrder: [], hideCR: store.get('hideCR') === '1', openId: null, sseOpen: false, lastOk: 0 };
if (!['today', '7d', '30d', 'all'].includes(S.win)) S.win = '7d';

function cutoff(): string {
  if (S.win === 'all') return '';
  const n = S.win === 'today' ? 0 : S.win === '7d' ? 6 : 29;
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}
const modelColor = (m: string): string => {
  const i = S.modelOrder.indexOf(m);
  return i >= 0 && i < 8 ? cssv('--s' + (i + 1)) : cssv('--other');
};

// ---------- generic keyed, sortable table ----------
function makeTable<T>(table: HTMLElement, cols: Col<T>[], opts: TableOpts<T>): TableApi<T> {
  const sort = { key: opts.sortKey, dir: opts.dir || -1 };
  const ths = cols.map((c) => h('th', { class: c.num ? 'n' : '', text: c.label, title: c.hint || 'Sort' }));
  const tbody = h('tbody');
  table.replaceChildren(h('thead', {}, h('tr', {}, ths)), tbody);
  const rows = new Map<string, RowState<T>>();
  ths.forEach((th, i) => th.addEventListener('click', () => {
    const k = cols[i].key;
    if (sort.key === k) sort.dir = -sort.dir; else { sort.key = k; sort.dir = cols[i].num ? -1 : 1; }
    api.update(api.items);
  }));
  const api: TableApi<T> = {
    items: [],
    update(items: T[]) {
      api.items = items;
      const col = cols.find((c) => c.key === sort.key) || cols[0];
      ths.forEach((th, i) => th.classList.toggle('sorted', cols[i] === col));
      const sorted = items.slice().sort((a, b) => {
        if (opts.pin) { const pa = opts.pin(a), pb = opts.pin(b); if (pa !== pb) return pa ? -1 : 1; }
        const va = col.val(a), vb = col.val(b);
        const c = typeof va === 'string' ? va.localeCompare(vb as string) : (va || 0) - ((vb as number) || 0);
        return c * sort.dir;
      });
      const seen = new Set<string>();
      sorted.forEach((it, i) => {
        const k = opts.key(it);
        seen.add(k);
        let r = rows.get(k);
        if (!r) {
          r = { tds: cols.map((c) => { const td = h('td', { class: (c.num ? 'n ' : '') + (c.cls || '') }); td.dataset.col = c.key; return td; }), tr: null };
          r.tr = h('tr', { class: opts.onClick ? 'click' : '' }, r.tds);
          if (opts.onClick) r.tr.addEventListener('click', () => opts.onClick(r.item));
          rows.set(k, r);
        }
        r.item = it;
        cols.forEach((c, j) => {
          const td = r.tds[j];
          if (c.render) c.render(td, it);
          else { const t = c.fmt ? c.fmt(it) : String(c.val(it)); if (td.textContent !== t) td.textContent = t; }
          const tt = c.title ? c.title(it) : (c.num ? full(c.val(it) as number) : '');
          if (tt) td.title = tt; else td.removeAttribute('title');
        });
        if (opts.rowClass) r.tr.className = (opts.onClick ? 'click ' : '') + opts.rowClass(it);
        const want = tbody.children[i];
        if (want !== r.tr) tbody.insertBefore(r.tr, want || null);
      });
      for (const [k, r] of rows) if (!seen.has(k)) { r.tr.remove(); rows.delete(k); }
    },
  };
  return api;
}

// ---------- charts ----------
const charts: Record<string, ChartLike> = {};
function baseOpts(extra: Partial<ChartOpts> = {}): ChartOpts {
  const grid = cssv('--border-soft'), muted = cssv('--muted'), t2 = cssv('--text2');
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: {
      legend: { labels: { color: t2, boxWidth: 10, boxHeight: 10, font: { family: cssv('--mono'), size: 11 } } },
      tooltip: { backgroundColor: cssv('--surface'), borderColor: cssv('--border'), borderWidth: 1, titleColor: cssv('--text'), bodyColor: t2, bodyFont: { family: cssv('--mono') }, titleFont: { family: cssv('--mono') }, padding: 10 },
    },
    scales: {
      x: { grid: { color: 'transparent' }, border: { color: grid }, ticks: { color: muted, font: { family: cssv('--mono'), size: 10 }, maxRotation: 0, autoSkip: true } },
      y: { grid: { color: grid }, border: { display: false }, ticks: { color: muted, font: { family: cssv('--mono'), size: 10 }, callback: (v) => compact(v) } },
    },
    ...extra,
  };
}
function setChart(id: string, type: string, data: ChartData, optsFn: () => ChartOpts): void {
  if (!hasChart) return;
  const opts = optsFn();
  let c = charts[id];
  if (c && c.canvas !== $(id)) { c.destroy(); delete charts[id]; c = null; }
  if (!c) { charts[id] = new Chart($(id), { type, data, options: opts }); return; }
  c.data.labels = data.labels;
  // keep legend-hidden state by matching dataset labels
  const hidden = new Map<string, boolean>(c.data.datasets.map((d, i): [string, boolean] => [d.label, !c.isDatasetVisible(i)]));
  c.data.datasets = data.datasets;
  c.options = opts;
  data.datasets.forEach((d, i) => { if (hidden.get(d.label)) c.setDatasetVisibility(i, false); });
  c.update('none');
}

// ---------- window math ----------
function windowDays(): DayRow[] {
  const c = cutoff();
  return S.sum.perDay.filter((d) => d.date >= c && d.date !== 'unknown');
}
function sumDays(days: DayRow[]): { t: Totals; models: ModelAgg[] } {
  const t: Totals = { input: 0, cw5: 0, cw1: 0, cr: 0, out: 0, thinking: 0, calls: 0, tools: 0, web: 0, cost: 0, prompts: 0 };
  const models: Record<string, ModelAgg> = {};
  for (const d of days) {
    for (const k in t) t[k] += d[k] || 0;
    for (const [m, a] of Object.entries(d.byModel || {})) {
      const x = models[m] || (models[m] = { model: m, input: 0, cw5: 0, cw1: 0, cr: 0, out: 0, thinking: 0, calls: 0, tools: 0, web: 0, cost: 0 });
      for (const k in a) x[k] += a[k];
    }
  }
  t.total = t.input + t.cw5 + t.cw1 + t.cr + t.out;
  return { t, models: Object.values(models) };
}
const inWin = (s: SessionRow) => !cutoff() || (s.last || '').slice(0, 10) >= cutoff();

// ---------- tiles ----------
const TILES: [string, string, boolean?][] = [
  ['total', 'Total tokens', true], ['out', 'Output tokens'], ['cache', 'Cache hit ratio'], ['cost', 'Est. cost (API list)', true],
  ['rep', 'Reported by Claude Code'], ['calls', 'API calls'], ['tools', 'Tool calls'], ['active', 'Active sessions'],
];
const PTILES: [string, string, boolean?][] = [['pm', 'Projected this month', true], ['n30', 'Next 30 days'], ['a7', 'Avg per day (7d)'], ['tr', '30d trend']];
function buildTiles() {
  $('projTiles').replaceChildren(...PTILES.map(([id, l, hero]) =>
    h('div', { class: 'tile' + (hero ? ' hero' : '') }, h('div', { class: 'l', text: l }), h('div', { class: 'v', id: 't_' + id, text: '-' }), h('div', { class: 's', id: 's_' + id, text: '\u00a0' }))));
  $('tiles').replaceChildren(...TILES.map(([id, l, hero]) =>
    h('div', { class: 'tile' + (hero ? ' hero' : '') }, h('div', { class: 'l', text: l }), h('div', { class: 'v', id: 't_' + id, text: '-' }), h('div', { class: 's', id: 's_' + id, text: ' ' }))));
}
const setTile = (id: string, v: number, fmt: (n: number) => string, sub: string, title?: string) => {
  const el = $('t_' + id);
  tween(el, v, fmt);
  if (title) el.title = title;
  $('s_' + id).textContent = sub;
};
function renderTiles(t: Totals) {
  const sess = S.sessions.filter(inWin);
  const rep = sess.reduce((a, s) => a + (s.reported && s.reported.cost || 0), 0);
  const cw = t.cw5 + t.cw1;
  const den = t.input + t.cr + cw;
  setTile('total', t.total, compact, 'in + cache + out', full(t.total));
  setTile('out', t.out, compact, `${compact(t.thinking)} thinking`, full(t.out));
  setTile('cache', den ? t.cr / den : 0, pct, `${compact(t.cr)} read / ${compact(cw)} written`);
  setTile('cost', t.cost, money, 'at list API prices');
  setTile('rep', rep, money, S.win === 'all' ? 'sum of last cost-state' : 'sessions active in window');
  setTile('calls', t.calls, compact, `${compact(t.prompts)} prompts`, full(t.calls));
  setTile('tools', t.tools, compact, t.calls ? (t.tools / t.calls).toFixed(2) + ' per call' : '', full(t.tools));
  const act = S.sum.activeSessions;
  setTile('active', act.length, (v) => String(Math.round(v)), `last ${S.sum.config.activeWindowMin} min`);
}

function renderProjection() {
  const p = S.sum.projection;
  const card = $('projCard');
  if (!p || p.insufficient) {
    $('projTiles').classList.add('hidden'); $('pace').textContent = '';
    $('projCaption').textContent = 'Not enough history yet for projections (need at least 2 days of data).';
    return;
  }
  $('projTiles').classList.remove('hidden');
  $('projCaption').textContent = 'Projections assume the recent daily average continues. List API prices, not a bill.';
  const m = p.monthToDate;
  setTile('pm', p.projectedMonth.cost, money, `MTD ${money(m.cost)} · ${m.daysRemaining} days left · basis 7d avg`, `30d basis: ${money(p.projectedMonth.costAlt)}`);
  setTile('n30', p.next30.cost, money, `${compact(p.next30.tokens)} tokens`);
  setTile('a7', p.avg7.cost, money, `${compact(p.avg7.total)} tokens · ${compact(p.avg7.calls)} calls`);
  const tr = p.trend30.pct;
  setTile('tr', tr, (v) => (v > 0 ? '+' : '') + v.toFixed(1) + '%', `${p.trend30.costPerDayDelta >= 0 ? '+' : '-'}${money(Math.abs(p.trend30.costPerDayDelta))} USD/day change`);
  $('t_tr').className = 'v ' + (tr <= 0 ? 'good' : 'warn');
  const t = p.today;
  $('pace').textContent = `today: ${compact(t.tokens)} tokens · ${money(t.cost)} so far · on pace for ${money(t.pace.cost)}`;
}

// ---------- tables ----------
const tokCols = (prefix?: string): Col<Counts>[] => [
  { key: 'input', label: 'Input', num: true, val: (r) => r.input, fmt: (r) => compact(r.input) },
  { key: 'cw5', label: 'Cache W 5m', num: true, val: (r) => r.cw5, fmt: (r) => compact(r.cw5) },
  { key: 'cw1', label: 'Cache W 1h', num: true, val: (r) => r.cw1, fmt: (r) => compact(r.cw1) },
  { key: 'cr', label: 'Cache R', num: true, val: (r) => r.cr, fmt: (r) => compact(r.cr) },
  { key: 'out', label: 'Output', num: true, val: (r) => r.out, fmt: (r) => compact(r.out) },
];
const tables: Partial<Tables> = {};
function initTables() {
  tables.models = makeTable<ModelRow>($('tModels'), [
    { key: 'model', label: 'Model', val: (r) => r.model, render: (td, r) => { const n = short(r.model); if (td._m !== r.model) { td._m = r.model; td.replaceChildren(h('span', { class: 'sw' }), n); } (td.firstChild as HTMLElement).style.background = modelColor(r.model); } },
    { key: 'calls', label: 'Calls', num: true, val: (r) => r.calls, fmt: (r) => compact(r.calls) },
    ...tokCols(),
    { key: 'thinking', label: 'Thinking', num: true, val: (r) => r.thinking, fmt: (r) => compact(r.thinking) },
    { key: 'tools', label: 'Tools', num: true, val: (r) => r.tools, fmt: (r) => compact(r.tools) },
    { key: 'cost', label: 'Est. cost', num: true, val: (r) => r.cost, fmt: (r) => (r.unknownPricing ? 'n/a' : money(r.cost)), title: (r) => (r.unknownPricing ? 'No pricing known for this model (cost 0)' : money(r.cost)) },
    { key: 'share', label: 'Share', num: true, val: (r) => r.share, fmt: (r) => pct(r.share), title: () => '' },
  ], { key: (r) => r.model, sortKey: 'cost' });

  tables.agentTypes = makeTable<AgentTypeRow>($('tAgentTypes'), [
    { key: 'type', label: 'Agent type', val: (r) => r.type },
    { key: 'runs', label: 'Runs', num: true, val: (r) => r.runs },
    { key: 'tokens', label: 'Tokens', num: true, val: (r) => r.tokens, fmt: (r) => compact(r.tokens) },
    { key: 'cost', label: 'Est. cost', num: true, val: (r) => r.cost, fmt: (r) => money(r.cost), title: (r) => money(r.cost) },
  ], { key: (r) => r.type, sortKey: 'cost' });

  tables.projects = makeTable<ProjectRow>($('tProjects'), [
    { key: 'cwd', label: 'Project', val: (r) => r.cwd, fmt: (r) => base(r.cwd), title: (r) => r.cwd },
    { key: 'sessions', label: 'Sessions', num: true, val: (r) => r.sessions },
    { key: 'calls', label: 'Calls', num: true, val: (r) => r.calls, fmt: (r) => compact(r.calls) },
    { key: 'total', label: 'Tokens', num: true, val: (r) => r.total, fmt: (r) => compact(r.total) },
    { key: 'cr', label: 'Cache R', num: true, val: (r) => r.cr, fmt: (r) => compact(r.cr) },
    { key: 'out', label: 'Output', num: true, val: (r) => r.out, fmt: (r) => compact(r.out) },
    { key: 'cost', label: 'Est. cost', num: true, val: (r) => r.cost, fmt: (r) => money(r.cost), title: (r) => money(r.cost) },
    { key: 'last', label: 'Last activity', val: (r) => r.last || '', fmt: (r) => rel(r.last), title: (r) => r.last || '' },
  ], { key: (r) => r.cwd, sortKey: 'cost' });

  tables.sessions = makeTable<SessionRow>($('tSessions'), [
    { key: 'act', label: '', val: (r) => (r.isActive ? 1 : 0), render: (td, r) => { const on = !!td.firstChild; if (r.isActive && !on) td.replaceChildren(h('span', { class: 'mk', title: 'active' })); else if (!r.isActive && on) td.replaceChildren(); }, title: () => '' },
    { key: 'title', label: 'Session', cls: 'wrapc', val: (r) => r.title, title: (r) => r.title },
    { key: 'cwd', label: 'Project', val: (r) => r.cwd, fmt: (r) => base(r.cwd), title: (r) => r.cwd },
    { key: 'gitBranch', label: 'Branch', val: (r) => r.gitBranch || '', fmt: (r) => r.gitBranch || '-' },
    { key: 'models', label: 'Models', val: (r) => r.models.join(','), fmt: (r) => r.models.map(short).join(', '), title: (r) => r.models.join(', ') },
    { key: 'subagents', label: 'Agents', num: true, val: (r) => r.subagents, render: (td, r) => {
      const k = r.subagents + '/' + r.activeAgents;
      if (td._k === k) return;
      td._k = k;
      if (!r.subagents) td.replaceChildren('\u2013');
      else td.replaceChildren(...(r.activeAgents > 0 ? [h('span', { class: 'mk', title: 'agents active' }), ' '] : []), r.activeAgents + ' / ' + r.subagents);
    }, title: (r) => (r.subagents ? `${r.activeAgents} active of ${r.subagents} subagents, ${money(r.agentCost)}` : '') },
    { key: 'last', label: 'Last', val: (r) => r.last || '', fmt: (r) => rel(r.last), title: (r) => r.last || '' },
    { key: 'durationMs', label: 'Span', num: true, val: (r) => r.durationMs, fmt: (r) => dur(r.durationMs), title: (r) => `turn time ${dur(r.turnMs)}` },
    { key: 'promptCount', label: 'Prompts', num: true, val: (r) => r.promptCount },
    { key: 'toolCalls', label: 'Tools', num: true, val: (r) => r.toolCalls, fmt: (r) => compact(r.toolCalls) },
    { key: 'tokens', label: 'Tokens', num: true, val: (r) => r.tokens.total, fmt: (r) => compact(r.tokens.total) },
    { key: 'cost', label: 'Est. cost', num: true, val: (r) => r.cost, fmt: (r) => money(r.cost), title: (r) => money(r.cost) },
    { key: 'rep', label: 'CC cost', num: true, val: (r) => (r.reported && r.reported.cost) || 0, fmt: (r) => (r.reported && r.reported.cost != null ? money(r.reported.cost) : '-'), title: () => 'Reported by Claude Code' },
    { key: 'lines', label: '+/- lines', num: true, val: (r) => (r.reported ? r.reported.linesAdded : 0), fmt: (r) => (r.reported ? `+${r.reported.linesAdded} / -${r.reported.linesRemoved}` : '-'), title: () => '' },
  ], { key: (r) => r.id, sortKey: 'last', pin: (r) => r.isActive, onClick: (r) => openDrawer(r.id), rowClass: (r) => (r.isActive ? 'active' : '') });

  tables.byDay = makeTable<DayRow>($('tByDay'), [
    { key: 'date', label: 'Date', val: (r) => r.date, render: (td, r) => {
      const today = r.date === new Date().toISOString().slice(0, 10);
      const k = r.date + today;
      if (td._k !== k) { td._k = k; td.replaceChildren(...(today ? [h('span', { class: 'mk', title: 'today (live)' }), ' '] : []), r.date); }
    }, title: () => '' },
    { key: 'input', label: 'Input', num: true, val: (r) => r.input, fmt: (r) => compact(r.input) },
    { key: 'cw5', label: 'Cache W 5m', num: true, val: (r) => r.cw5, fmt: (r) => compact(r.cw5) },
    { key: 'cw1', label: 'Cache W 1h', num: true, val: (r) => r.cw1, fmt: (r) => compact(r.cw1) },
    { key: 'cr', label: 'Cache R', num: true, val: (r) => r.cr, fmt: (r) => compact(r.cr) },
    { key: 'out', label: 'Output', num: true, val: (r) => r.out, fmt: (r) => compact(r.out) },
    { key: 'total', label: 'Total', num: true, val: (r) => r.total, fmt: (r) => compact(r.total) },
    { key: 'calls', label: 'Calls', num: true, val: (r) => r.calls },
    { key: 'prompts', label: 'Prompts', num: true, val: (r) => r.prompts },
    { key: 'cost', label: 'Est. cost', num: true, val: (r) => r.cost, fmt: (r) => money(r.cost), title: (r) => money(r.cost) },
  ], { key: (r) => r.date, sortKey: 'date', rowClass: (r) => {
    const wd = new Date(r.date + 'T00:00:00Z').getUTCDay();
    return (r.calls === 0 && r.total === 0 ? 'zero ' : '') + (wd === 0 || wd === 6 ? 'wk' : '');
  } });

  tables.daily = makeTable<DayRow>($('tDaily'), [
    { key: 'date', label: 'Date', val: (r) => r.date },
    { key: 'input', label: 'Input', num: true, val: (r) => r.input, fmt: (r) => compact(r.input) },
    { key: 'cw', label: 'Cache W', num: true, val: (r) => r.cw5 + r.cw1, fmt: (r) => compact(r.cw5 + r.cw1) },
    { key: 'cr', label: 'Cache R', num: true, val: (r) => r.cr, fmt: (r) => compact(r.cr) },
    { key: 'out', label: 'Output', num: true, val: (r) => r.out, fmt: (r) => compact(r.out) },
    { key: 'cost', label: 'Est. cost', num: true, val: (r) => r.cost, fmt: (r) => money(r.cost) },
    { key: 'calls', label: 'Calls', num: true, val: (r) => r.calls },
    { key: 'prompts', label: 'Prompts', num: true, val: (r) => r.prompts },
  ], { key: (r) => r.date, sortKey: 'date' });
}

function renderTables(days: DayRow[], models: ModelAgg[], totalCost: number) {
  tables.models.update(models.map((m) => ({ ...m, share: totalCost > 0 ? m.cost / totalCost : 0, unknownPricing: (S.sum.perModel.find((p) => p.model === m.model) || ({} as ModelStat)).unknownPricing })));
  const sess = S.sessions.filter(inWin);
  let projects: ProjectRow[];
  if (S.win === 'all') {
    projects = S.sum.perProject;
    $('projNote').textContent = 'all time, grouped by cwd of each log line';
  } else {
    const m = new Map<string, ProjectRow>();
    for (const s of sess) {
      const k = s.cwd || '(unknown)';
      const p = m.get(k) || { cwd: k, sessions: 0, calls: 0, total: 0, cr: 0, out: 0, cost: 0, last: '' };
      p.sessions++; p.calls += s.calls; p.total += s.tokens.total; p.cr += s.tokens.cacheRead; p.out += s.tokens.output; p.cost += s.cost;
      if ((s.last || '') > p.last) p.last = s.last;
      m.set(k, p);
    }
    projects = [...m.values()];
    $('projNote').textContent = 'sessions whose last activity is in the window (whole-session totals)';
  }
  const types = Object.entries(S.sum.perAgentType || {}).map(([type, v]) => ({ type, ...v }));
  $('agentTypeCard').classList.toggle('hidden', !types.some((x) => x.type !== 'main'));
  tables.agentTypes.update(types);
  tables.projects.update(projects);
  tables.sessions.update(sess);
  tables.daily.update(days);
  const p = S.sum.projection, c = cutoff();
  tables.byDay.update(p && !p.insufficient ? p.history.filter((r) => r.date >= c) : days.map((d) => ({ ...d, prompts: d.prompts || 0 })));
}

// ---------- charts render ----------
function renderCharts(days: DayRow[], models: ModelAgg[]) {
  if (!hasChart) return;
  const sv = ['--s1', '--s2', '--s3', '--s4'].map(cssv);
  const surface = cssv('--surface');
  const pj = S.sum.projection;
  const fc = pj && !pj.insufficient ? pj.forecastDays : [];
  const dates = days.map((d) => d.date).concat(fc.map((f) => f.date));
  const labels = dates.map((d) => d.slice(5));
  const pad = fc.map(() => null);
  const a2 = cssv('--accent2');
  const hatch = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 8;
    const g = cv.getContext('2d');
    g.fillStyle = a2 + '33'; g.fillRect(0, 0, 8, 8);
    g.strokeStyle = a2 + 'aa'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(0, 8); g.lineTo(8, 0); g.moveTo(-2, 2); g.lineTo(2, -2); g.moveTo(6, 10); g.lineTo(10, 6); g.stroke();
    return g.createPattern(cv, 'repeat') || a2 + '59';
  })();
  const dsBar = (label: string, color: string, fn: (d: DayRow) => number): ChartDataset => ({ label, data: days.map(fn).concat(pad), backgroundColor: color, borderColor: surface, borderWidth: 2, borderRadius: 3, borderSkipped: 'bottom', maxBarThickness: 36 });
  setChart('cDaily', 'bar', {
    labels,
    datasets: [dsBar('Input', sv[0], (d) => d.input), dsBar('Cache write', sv[1], (d) => d.cw5 + d.cw1), ...(S.hideCR ? [] : [dsBar('Cache read', sv[2], (d) => d.cr)]), dsBar('Output', sv[3], (d) => d.out),
      ...(fc.length ? [{ label: 'Projected', data: days.map(() => null).concat(fc.map((f) => (S.hideCR ? f.total - f.cacheRead : f.total))), backgroundColor: hatch, borderColor: a2, borderWidth: 1, borderRadius: 3, borderSkipped: 'bottom', maxBarThickness: 36 }] : [])],
  }, () => {
    const o = baseOpts();
    o.scales.x.stacked = true; o.scales.y.stacked = true;
    o.plugins.tooltip.callbacks = { title: (it) => dates[it[0].dataIndex] + (it[0].dataIndex >= days.length ? ' (projected)' : ''), label: (c) => ` ${c.dataset.label}: ${full(c.parsed.y)}` };
    return o;
  });
  const accent = cssv('--accent');
  setChart('cCost', 'line', {
    labels, datasets: [{ label: 'Est. cost (USD)', data: days.map((d) => d.cost), borderColor: accent, backgroundColor: accent, borderWidth: 2, pointRadius: days.length > 20 ? 0 : 3, pointHoverRadius: 5, pointBackgroundColor: accent, pointBorderColor: surface, pointBorderWidth: 2, tension: 0.25 }],
  }, () => {
    const o = baseOpts();
    o.plugins.legend.display = false;
    o.scales.y.ticks.callback = (v) => '$' + compact(v);
    o.plugins.tooltip.callbacks = { title: (it) => days[it[0].dataIndex].date, label: (c) => ' ' + money(c.parsed.y) };
    return o;
  });
  const ms = models.filter((m) => m.total > 0 || m.cost > 0).sort((a, b) => b.total - a.total);
  const mt = (m: Counts) => m.input + m.cw5 + m.cw1 + m.cr + m.out;
  models.forEach((m) => { m.total = mt(m); });
  setChart('cModelTok', 'doughnut', {
    labels: ms.map((m) => short(m.model)),
    datasets: [{ data: ms.map((m) => m.total), backgroundColor: ms.map((m) => modelColor(m.model)), borderColor: surface, borderWidth: 2 }],
  }, () => {
    const o = baseOpts({ cutout: '62%' });
    delete o.scales; o.interaction = { mode: 'nearest', intersect: true };
    o.plugins.legend.position = innerWidth > 640 ? 'right' : 'bottom';
    o.plugins.tooltip.callbacks = { label: (c) => ` ${c.label}: ${full(c.parsed)} (${pct(c.parsed / (ms.reduce((a, m) => a + m.total, 0) || 1))})` };
    return o;
  });
  const mc = models.filter((m) => m.cost > 0).sort((a, b) => b.cost - a.cost);
  setChart('cModelCost', 'bar', {
    labels: mc.map((m) => short(m.model)),
    datasets: [{ label: 'Est. cost', data: mc.map((m) => m.cost), backgroundColor: mc.map((m) => modelColor(m.model)), borderRadius: 4, maxBarThickness: 22 }],
  }, () => {
    const o = baseOpts({ indexAxis: 'y' });
    o.interaction = { mode: 'nearest', intersect: true };
    o.plugins.legend.display = false;
    o.scales.x.ticks.callback = (v) => '$' + compact(v);
    o.scales.y.ticks.callback = function (v) { return this.getLabelForValue(v); };
    o.scales.y.ticks.color = cssv('--text2'); o.scales.y.grid = { display: false };
    o.plugins.tooltip.callbacks = { label: (c) => ' ' + money(c.parsed.x) };
    return o;
  });
  setChart('cHours', 'bar', {
    labels: S.sum.hours.map((_, i) => String(i).padStart(2, '0')),
    datasets: [{ label: 'API calls', data: S.sum.hours, backgroundColor: accent, borderRadius: 3, maxBarThickness: 18 }],
  }, () => { const o = baseOpts(); o.plugins.legend.display = false; o.plugins.tooltip.callbacks = { title: (it) => `${it[0].label}:00`, label: (c) => ' ' + full(c.parsed.y) + ' calls' }; return o; });
  const eff = Object.entries(S.sum.effort).sort((a, b) => b[1] - a[1]);
  setChart('cEffort', 'bar', {
    labels: eff.map((e) => e[0]),
    datasets: [{ label: 'API calls', data: eff.map((e) => e[1]), backgroundColor: accent, borderRadius: 4, maxBarThickness: 22 }],
  }, () => {
    const o = baseOpts({ indexAxis: 'y' });
    o.interaction = { mode: 'nearest', intersect: true };
    o.plugins.legend.display = false;
    o.scales.y.grid = { display: false }; o.scales.y.ticks.callback = function (v) { return this.getLabelForValue(v); }; o.scales.y.ticks.color = cssv('--text2');
    o.scales.x.ticks.callback = (v) => compact(v);
    o.plugins.tooltip.callbacks = { label: (c) => ' ' + full(c.parsed.x) + ' calls' };
    return o;
  });
  const hc: Record<string, number> = (S.sum.statsCache && S.sum.statsCache.hourCounts) || {};
  $('cScHours').parentElement.classList.toggle('hidden', !S.sum.statsCache);
  if (S.sum.statsCache) setChart('cScHours', 'bar', {
    labels: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')),
    datasets: [{ label: 'Sessions started', data: Array.from({ length: 24 }, (_, i) => hc[i] || 0), backgroundColor: cssv('--accent2'), borderRadius: 3, maxBarThickness: 18 }],
  }, () => { const o = baseOpts(); o.plugins.legend.display = false; return o; });
}

function renderDist() {
  const grp = (title: string, obj: Record<string, number>) => h('div', {}, h('div', { class: 'grp', text: title }),
    h('div', { class: 'row' }, Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => h('span', { class: 'chip', title: full(v) + ' calls' }, k + ' ', h('b', { text: compact(v) })))));
  $('dist').replaceChildren(grp('Service tier', S.sum.tier), grp('Speed', S.sum.speed), grp('Inference geo', S.sum.geo));
}

function renderStatsCache() {
  const sc = S.sum.statsCache;
  const dl = $('sc');
  if (!sc) { dl.replaceChildren(h('dt', { text: 'stats-cache.json' }), h('dd', { text: 'not found' })); return; }
  const mu = Object.values(sc.modelUsage || {});
  const tok = mu.reduce((a, m) => a + (m.inputTokens || 0) + (m.outputTokens || 0) + (m.cacheReadInputTokens || 0) + (m.cacheCreationInputTokens || 0), 0);
  const cost = mu.reduce((a, m) => a + (m.costUSD || 0), 0);
  const behind = sc.lastComputedDate ? Math.floor((Date.now() - Date.parse(sc.lastComputedDate)) / 86400000) : null;
  const ls = sc.longestSession;
  const rows = [
    ['Last computed', (sc.lastComputedDate || '?') + (behind > 1 ? ` (${behind}d behind)` : '')],
    ['First session', sc.firstSessionDate ? sc.firstSessionDate.slice(0, 10) : '-'],
    ['Total sessions', full(sc.totalSessions)], ['Total messages', full(sc.totalMessages)],
    ['Lifetime tokens', compact(tok)], ['Lifetime cost (CC)', money(cost)],
    ['Longest session', ls ? `${dur(ls.duration)} / ${full(ls.messageCount)} msgs` : '-'],
  ];
  dl.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]));
}

let feedSig = '';
function renderFeed() {
  const sig = S.hist.length + ':' + (S.hist[0] ? S.hist[0].ts : 0);
  const ul = $('feed');
  if (sig !== feedSig) {
    feedSig = sig;
    ul.replaceChildren(...S.hist.map((e) => {
      const t = h('span', { class: 'when', text: rel(e.ts) }); t.dataset.ts = String(e.ts);
      return h('li', {}, h('div', { class: 'meta' }, t, h('span', { class: 'proj', text: base(e.project), title: e.project })), h('div', { class: 'txt', text: e.display || '(empty)' }));
    }));
  } else for (const t of ul.querySelectorAll<HTMLElement>('.when')) t.textContent = rel(+t.dataset.ts);
}

function renderHeader() {
  const sm = S.sum;
  $('home').textContent = sm.config.claudeHome;
  const st: Settings = sm.settings || {};
  const chip = (k: string, v: unknown) => h('span', { class: 'chip' }, k + ' ', h('b', { text: v == null ? '-' : String(v) }));
  $('cfg').replaceChildren(chip('model', st.model), chip('effort', st.effortLevel ?? 'default'), chip('thinking', st.alwaysThinkingEnabled == null ? 'default' : st.alwaysThinkingEnabled ? 'on' : 'off'));
  $('scanInfo').textContent = `last scan ${new Date(sm.scan.lastScan).toLocaleTimeString([], { hour12: false })} · ${sm.scan.scanMs} ms · every ${sm.config.refreshMs / 1000}s`;
  const f = sm.scan;
  $('foot').textContent = `${full(f.filesScanned)} files · ${(f.bytesRead / 1048576).toFixed(1)} MB read · ${full(f.malformed)} malformed lines · scan #${f.scans} · prices are list-API estimates, not a bill`;
}

function render() {
  if (!S.sum) return;
  const days = windowDays();
  const { t, models } = sumDays(days);
  const all = S.sum.perModel;
  S.modelOrder = all.filter((m) => m.cost > 0 || m.total > 0).map((m) => m.model);
  renderHeader();
  renderTiles(t);
  renderProjection();
  renderCharts(days, models);
  renderTables(days, models, t.cost);
  renderDist(); renderStatsCache(); renderFeed();
  renderTsMain();
  document.querySelectorAll<HTMLButtonElement>('#win button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.w === S.win)));
}

// ---------- drawer ----------
async function openDrawer(id: string) {
  S.openId = id;
  try { history.replaceState(null, '', '#session/' + encodeURIComponent(id)); } catch { /* ignore */ }
  Object.assign(D, { scope: 'all', off: new Set(), data: null, hideAg: false });
  $('drawer').classList.add('open'); $('backdrop').classList.add('open'); $('drawer').setAttribute('aria-hidden', 'false');
  await loadDrawer(true);
}
function closeDrawer() {
  S.openId = null;
  try { history.replaceState(null, '', location.pathname + location.search); } catch { /* ignore */ }
  $('drawer').classList.remove('open'); $('backdrop').classList.remove('open'); $('drawer').setAttribute('aria-hidden', 'true');
}
async function loadDrawer(fresh: boolean) {
  if (!S.openId) return;
  try {
    const r = await fetch('/api/sessions/' + encodeURIComponent(S.openId));
    if (!r.ok) throw new Error(String(r.status));
    const d: SessionDetail = await r.json();
    const dr = $('drawer'), top = fresh ? 0 : dr.scrollTop;
    S.lastDetail = d;
    $('drawerBody').replaceChildren(...drawerContent(d));
    dr.scrollTop = top;
    drawerCharts(d);
  } catch (e) { $('drawerBody').replaceChildren(h('p', { text: 'Could not load session: ' + e.message })); }
}
// copy text to the clipboard (async API on secure contexts like localhost, execCommand fallback); the button briefly says Copied
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  const ta = document.createElement('textarea'); ta.value = text; ta.style.cssText = 'position:fixed;opacity:0'; document.body.append(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* ignore */ } ta.remove(); return ok;
}
function copyBtn(label: string, text: string, title: string): HTMLElement {
  const b = h('button', { class: 'cp', type: 'button', text: label, title });
  b.addEventListener('click', async () => { const ok = await copyText(text); b.textContent = ok ? 'Copied' : 'Copy failed'; setTimeout(() => { b.textContent = label; }, 1400); });
  return b;
}
const resumeCmd = (cwd: string, id: string) => (cwd ? `cd '${cwd.replace(/'/g, `'\\''`)}' && ` : '') + `claude --resume ${id}`;
function kv(rows: KvRow[]) { return h('dl', { class: 'kv' }, rows.flatMap(([k, v, t]) => [h('dt', { text: k }), h('dd', { text: String(v), title: t || '', class: k === 'Project' || k === 'Branch' ? 'priv' : '' })])); }
function drawerContent(d: SessionDetail) {
  const rp = d.reported;
  const tk = d.tokens;
  const hours = d.hourly;
  const mx = Math.max(1, ...hours.map((x) => x.tokens));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'spark'); svg.setAttribute('viewBox', `0 0 ${Math.max(hours.length, 1) * 6} 48`); svg.setAttribute('preserveAspectRatio', 'none');
  hours.forEach((x, i) => {
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    const hh = Math.max(1, (x.tokens / mx) * 46);
    r.setAttribute('x', String(i * 6)); r.setAttribute('y', String(48 - hh)); r.setAttribute('width', '5'); r.setAttribute('height', String(hh));
    const ti = document.createElementNS('http://www.w3.org/2000/svg', 'title'); ti.textContent = `${x.hour}:00Z  ${full(x.tokens)} tokens  ${money(x.cost)}`; r.append(ti);
    svg.append(r);
  });
  const mt = makeStaticModelTable(d.perModel);
  return [
    h('h3', { text: d.title }),
    h('div', { class: 'sub', text: (d.isActive ? 'ACTIVE · ' : '') + d.id }),
    h('div', { class: 'copyrow' }, copyBtn('Copy ID', d.id, 'Copy the session id'), copyBtn('Copy resume command', resumeCmd(d.cwd, d.id), 'cd into the project and run claude --resume <id>')),
    h('h4', { text: 'Overview' }),
    kv([
      ['Project', d.cwd || '-'], ['Branch', d.gitBranch || '-'], ['Claude Code', d.version || '-'],
      ['Kind / effort', `${d.sessionKind || '-'} / ${d.effort || '-'}`], ['Permission mode', d.permissionMode || '-'],
      ['First', d.first || '-'], ['Last', d.last ? `${d.last} (${rel(d.last)})` : '-'],
      ['Span / turn time', `${dur(d.durationMs)} / ${dur(d.turnMs)}`],
      ['Prompts / API calls', `${d.promptCount} / ${full(d.callCount)}`], ['Tool calls / subagents', `${full(d.toolCalls)} / ${d.subagents}`],
    ]),
    h('h4', { text: 'Cost' }),
    kv([
      ['Estimated (list API)', money(d.cost)],
      ['Reported by Claude Code', rp && rp.cost != null ? money(rp.cost) : '-'],
      ['Lines added / removed', rp ? `+${full(rp.linesAdded)} / -${full(rp.linesRemoved)}` : '-'],
      ['API time / tool time', rp ? `${dur(rp.apiMs)} / ${dur(rp.toolMs)}` : '-'],
      ['Cache hit ratio', pct(d.cacheHit)],
    ]),
    h('h4', { text: 'Tokens' }),
    kv([['Input', full(tk.input)], ['Cache write 5m', full(tk.cacheWrite5m)], ['Cache write 1h', full(tk.cacheWrite1h)], ['Cache read', full(tk.cacheRead)], ['Output', full(tk.output)], ['Thinking (in output)', full(tk.thinking)]]),
    ...tsSection(d),
    ...subagentSection(d),
    ...lanesSection(d),
    h('h4', { text: 'Per model' }), mt,
    h('h4', { text: 'Tokens per hour (UTC)' }), svg,
    h('h4', { text: `Prompts (last ${d.prompts.length})` }),
    h('ol', {}, d.prompts.slice().reverse().map((p) => h('li', {}, h('span', { class: 't', text: (p.ts || '') + (p.ts ? ' · ' + rel(p.ts) : '') }), p.text))),
  ];
}
// ---------- time series (main card + drawer) ----------
const S_TS: TsState = { scope: 'all', off: new Set(), data: null, tok: 0 };
S.ts = S_TS;
const D: TsState = { scope: 'all', off: new Set(), data: null, hideAg: false, tok: 0 };
const SCOPES: [string, string][] = [['all', 'All'], ['main', 'Main'], ['agents', 'Subagents']];
function scopeSeg(get: () => string, cb: (v: string) => void): HTMLElement[] {
  const btns = SCOPES.map(([v, l]) => {
    const b = h('button', { type: 'button', text: l, 'aria-pressed': String(get() === v) });
    b.addEventListener('click', () => { btns.forEach((x) => x.setAttribute('aria-pressed', String(x === b))); cb(v); });
    return b;
  });
  return btns;
}
function chipRow(el: HTMLElement, models: string[], off: Set<string>, cb: () => void): void {
  el.replaceChildren(...models.map((m) => {
    const b = h('button', { class: 'chip', type: 'button', title: m, 'aria-pressed': String(!off.has(m)) }, h('span', { class: 'sw', style: `background:${modelColor(m)}` }), short(m));
    b.addEventListener('click', () => { if (off.has(m)) off.delete(m); else off.add(m); cb(); });
    return b;
  }));
}
const two = (n: number) => String(n).padStart(2, '0');
function tsDraw(id: string, data: TimeSeries, off: Set<string>): void {
  if (!hasChart || !$(id)) return;
  const rows: TsRow[] = data.points.map((p) => {
    const a = { input: 0, cw: 0, cr: 0, out: 0, cost: 0, calls: 0 };
    for (const [m, v] of Object.entries(p.perModel)) {
      if (off.has(m)) continue;
      a.input += v.input; a.cw += v.cw5 + v.cw1; a.cr += v.cr; a.out += v.out; a.cost += v.cost; a.calls += v.calls;
    }
    return a;
  });
  const span = data.bucketMs * data.points.length;
  const lab = (t: number) => {
    const d = new Date(t), md = two(d.getMonth() + 1) + '-' + two(d.getDate()), hm = two(d.getHours()) + ':' + two(d.getMinutes());
    return data.bucketMs >= 86400000 ? md : span <= 18 * 3600000 ? hm : md + ' ' + hm;
  };
  const sv = ['--s1', '--s2', '--s3', '--s4'].map(cssv), accent = cssv('--accent');
  const bar = (label: string, color: string, fn: (r: TsRow) => number): ChartDataset => ({ type: 'bar', label, data: rows.map(fn), backgroundColor: color, borderWidth: 0, categoryPercentage: 1, barPercentage: 0.9, maxBarThickness: 28, yAxisID: 'y', order: 1 });
  setChart(id, 'bar', {
    labels: data.points.map((p) => lab(p.t)),
    datasets: [bar('Input', sv[0], (r) => r.input), bar('Cache write', sv[1], (r) => r.cw), ...(S.hideCR ? [] : [bar('Cache read', sv[2], (r) => r.cr)]), bar('Output', sv[3], (r) => r.out),
      { type: 'line', label: 'Est. cost', data: rows.map((r) => r.cost), borderColor: accent, backgroundColor: accent, borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 3, tension: 0.2, yAxisID: 'y1', order: 0 }],
  }, () => {
    const o = baseOpts();
    o.scales.x.stacked = true; o.scales.y.stacked = true;
    o.scales.x.ticks.maxTicksLimit = 10;
    o.scales.y1 = { position: 'right', grid: { drawOnChartArea: false }, border: { display: false }, beginAtZero: true, ticks: { color: cssv('--muted'), font: { family: cssv('--mono'), size: 10 }, callback: (v) => '$' + compact(v) } };
    o.plugins.tooltip.callbacks = {
      title: (it) => new Date(data.points[it[0].dataIndex].t).toLocaleString([], { hour12: false }),
      label: (c) => (c.dataset.yAxisID === 'y1' ? ` Est. cost: ${money(c.parsed.y)}` : ` ${c.dataset.label}: ${full(c.parsed.y)}`),
    };
    return o;
  });
}
async function loadTs() {
  const tok = ++S_TS.tok;
  try {
    const r = await fetch(`/api/timeseries?window=${S.win}&scope=${S_TS.scope}`);
    if (!r.ok) return;
    const j: TimeSeries = await r.json();
    if (tok !== S_TS.tok) return;
    S_TS.data = j;
    renderTsMain();
  } catch { /* keep previous */ }
}
function renderTsMain() {
  const dt = S_TS.data;
  if (!dt) return;
  $('tsCap').textContent = `Local time \u00b7 bucket ${dt.bucket}`;
  chipRow($('tsChips'), dt.models, S_TS.off, renderTsMain);
  tsDraw('cTs', dt, S_TS.off);
}
function tsSection(d: SessionDetail) {
  const mk = h('div', { class: 'tools' });
  mk.append(h('span', { class: 'seg small' }, scopeSeg(() => D.scope, (v) => { D.scope = v; loadDrawerTs(d); })));
  const out = [
    h('h4', { text: 'Tokens over time' }), mk,
    h('div', { class: 'chips', id: 'dTsChips' }),
    h('div', { class: 'chart' }, h('canvas', { id: 'cdTs', role: 'img', 'aria-label': 'Tokens over time for this session' })),
    h('div', { class: 'cap', id: 'dTsCap' }),
  ];
  if ((d.calls || []).length >= 2) {
    const b = h('button', { class: 'mini', type: 'button', text: D.hideAg ? 'SHOW SUBAGENT CALLS' : 'HIDE SUBAGENT CALLS' });
    b.addEventListener('click', () => { D.hideAg = !D.hideAg; b.textContent = D.hideAg ? 'SHOW SUBAGENT CALLS' : 'HIDE SUBAGENT CALLS'; drawCtx(d); });
    out.push(
      h('h4', { text: 'Context per call' }), h('div', { class: 'tools' }, b),
      h('div', { class: 'chart' }, h('canvas', { id: 'cdCtx', role: 'img', 'aria-label': 'Context size per API call' })),
      h('div', { class: 'cap', text: 'input + cache read + cache write per API call \u2248 context in use; drops are compactions. Line = main session, dots = subagent calls.' }),
    );
  }
  return out;
}
function renderDrawerTs() {
  const dt = D.data;
  if (!dt || !$('cdTs')) return;
  if ($('dTsCap')) $('dTsCap').textContent = `Local time \u00b7 bucket ${dt.bucket}`;
  if ($('dTsChips')) chipRow($('dTsChips'), dt.models, D.off, renderDrawerTs);
  tsDraw('cdTs', dt, D.off);
}
async function loadDrawerTs(d: SessionDetail) {
  const tok = ++D.tok;
  const b = d.durationMs < 3 * 3600000 ? '1m' : d.durationMs < 86400000 ? '5m' : '1h';
  try {
    const r = await fetch(`/api/timeseries?window=all&bucket=${b}&session=${encodeURIComponent(d.id)}&scope=${D.scope}`);
    if (!r.ok) return;
    const j: TimeSeries = await r.json();
    if (tok !== D.tok || S.openId !== d.id) return;
    D.data = j;
    renderDrawerTs();
  } catch { /* keep previous */ }
}
function drawCtx(d: SessionDetail) {
  if (!hasChart || !$('cdCtx')) return;
  const by = new Map<string, { x: number; y: number }[]>(), ag: { x: number; y: number }[] = [];
  for (const c of d.calls || []) {
    if (c.agentId) ag.push({ x: c.t, y: c.ctx });
    else { if (!by.has(c.model)) by.set(c.model, []); by.get(c.model).push({ x: c.t, y: c.ctx }); }
  }
  const muted = cssv('--other');
  const datasets: ChartDataset[] = [...by].map(([m, pts]) => ({ label: short(m), data: pts, parsing: false, borderColor: modelColor(m), backgroundColor: modelColor(m), borderWidth: 1.5, pointRadius: 1.5, tension: 0 }));
  if (!D.hideAg && ag.length) datasets.push({ label: 'Subagent calls', data: ag, parsing: false, showLine: false, borderColor: muted, backgroundColor: muted + '99', pointRadius: 1.5 });
  const first = d.calls[0].t, last = d.calls[d.calls.length - 1].t;
  const withDate = last - first > 18 * 3600000;
  const fmt = (v: number) => { const t = new Date(v); return (withDate ? two(t.getMonth() + 1) + '-' + two(t.getDate()) + ' ' : '') + two(t.getHours()) + ':' + two(t.getMinutes()); };
  setChart('cdCtx', 'line', { datasets }, () => {
    const o = baseOpts();
    o.interaction = { mode: 'nearest', intersect: true };
    o.scales.x = { type: 'linear', min: first, max: last, grid: { color: 'transparent' }, border: { color: cssv('--border-soft') }, ticks: { color: cssv('--muted'), font: { family: cssv('--mono'), size: 10 }, maxTicksLimit: 7, callback: fmt } };
    o.plugins.tooltip.callbacks = { title: (it) => new Date(it[0].parsed.x).toLocaleString([], { hour12: false }), label: (c) => ` ${c.dataset.label}: ${full(c.parsed.y)} tokens` };
    return o;
  });
}
function drawerCharts(d: SessionDetail) {
  renderDrawerTs();
  loadDrawerTs(d);
  drawCtx(d);
}
function lanesSection(d: SessionDetail) {
  const ag = (d.agents || []).filter((a) => a.first && a.last);
  if (!ag.length) return [];
  const counts = new Map<string, number>();
  for (const a of ag) counts.set(a.type, (counts.get(a.type) || 0) + 1);
  const types = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
  const col = (t: string): string => { const i = types.indexOf(t); return i < 8 ? cssv('--s' + (i + 1)) : cssv('--other'); };
  const t0 = Math.min(...ag.map((a) => Date.parse(a.first)), Date.parse(d.first) || Infinity);
  const t1 = Math.max(...ag.map((a) => Date.parse(a.last)), Date.parse(d.last) || 0);
  const sp = Math.max(1, t1 - t0);
  const lt = (t: number) => { const x = new Date(t); return (sp > 18 * 3600000 ? two(x.getMonth() + 1) + '-' + two(x.getDate()) + ' ' : '') + two(x.getHours()) + ':' + two(x.getMinutes()); };
  const rows = ag.slice().sort((a, b) => Date.parse(a.first) - Date.parse(b.first)).map((a) => {
    const l = (Date.parse(a.first) - t0) / sp * 100, w = Math.max((Date.parse(a.last) - Date.parse(a.first)) / sp * 100, 0.4);
    const tip = `${a.id}\n${a.type}\n${a.description}\n${dur(Date.parse(a.last) - Date.parse(a.first))} \u00b7 ${money(a.cost)}`;
    return h('div', { class: 'lane', title: tip },
      h('span', { class: 'lb', text: `${a.id.slice(0, 8)} ${a.type}` }),
      h('span', { class: 'track' }, h('span', { class: 'bar', style: `left:${l}%;width:${w}%;background:${col(a.type)}` }, a.isActive ? h('span', { class: 'mk' }) : null)));
  });
  return [
    h('h4', { text: 'Subagent timeline' }),
    h('div', { class: 'lanes-legend' }, types.map((t) => h('span', {}, h('span', { class: 'sw', style: `background:${col(t)}` }), `${t} (${counts.get(t)})`))),
    h('div', { class: 'lanes-axis' }, h('span', { text: lt(t0) }), h('span', { text: lt(t1) })),
    h('div', { class: 'lanes' }, rows),
  ];
}
function subagentSection(d: SessionDetail) {
  const ag = d.agents || [];
  if (!ag.length) return [];
  const t = h('table', { class: 'agt' });
  t.append(h('thead', {}, h('tr', {}, ['', 'Agent', 'Description', 'Model', 'Tokens', 'Cost', 'Last'].map((x, i) => h('th', { class: i > 3 ? 'n' : '', text: x })))));
  t.append(h('tbody', {}, ag.map((a) => h('tr', { title: `${full(a.calls)} calls \u00b7 ${a.first && a.last ? dur(Date.parse(a.last) - Date.parse(a.first)) : '-'}` },
    h('td', {}, a.isActive ? h('span', { class: 'mk', title: 'active' }) : null),
    h('td', {}, h('span', { text: a.id.slice(0, 8), title: a.id }), h('span', { class: 'sub atype', text: a.type })),
    h('td', { class: 'adesc', text: a.description, title: a.description }),
    h('td', { text: a.models.map(short).join(', '), title: a.models.join(', ') }),
    h('td', { class: 'n', text: compact(a.tokens.total), title: full(a.tokens.total) }),
    h('td', { class: 'n', text: money(a.cost) }),
    h('td', { class: 'n', text: rel(a.last), title: a.last || '' })))));
  return [
    h('h4', { text: 'Subagents' }),
    h('div', { class: 'sub split', text: `Main ${money(d.main.cost)} \u00b7 Subagents ${money(d.agentCost)} (${ag.length} run${ag.length === 1 ? '' : 's'})` }),
    h('div', { class: 'tablewrap agents-t' }, t),
  ];
}
function makeStaticModelTable(models: ModelStat[]) {
  const t = h('table');
  t.append(h('thead', {}, h('tr', {}, ['Model', 'Calls', 'In', 'CacheW', 'CacheR', 'Out', 'Cost'].map((x, i) => h('th', { class: i ? 'n' : '', text: x })))));
  t.append(h('tbody', {}, models.map((m) => h('tr', {},
    h('td', {}, h('span', { class: 'sw', style: `background:${modelColor(m.model)}` }), short(m.model)),
    ...[m.calls, m.input, m.cw5 + m.cw1, m.cr, m.out].map((v) => h('td', { class: 'n', text: compact(v), title: full(v) })),
    h('td', { class: 'n', text: m.unknownPricing ? 'n/a' : money(m.cost) })))));
  return h('div', { class: 'tablewrap' }, t);
}

// ---------- refresh ----------
let busy = false, again = false;
async function refresh() {
  if (busy) { again = true; return; }
  busy = true;
  const bar = $('progress');
  bar.className = 'progress on';
  try {
    const [a, b, c] = await Promise.all([fetch('/api/summary'), fetch('/api/sessions?limit=2000&sort=last'), fetch('/api/history?limit=100')]);
    if (!a.ok || !b.ok || !c.ok) throw new Error('HTTP error');
    [S.sum, S.sessions, S.hist] = await Promise.all([a.json(), b.json(), c.json()]);
    S.lastOk = Date.now();
    render();
    loadTs();
    await loadDrawer(false);
    setLive();
  } catch (e) {
    $('liveTxt').textContent = 'OFFLINE'; $('dot').className = 'dot';
  } finally {
    bar.className = 'progress done';
    setTimeout(() => { bar.className = 'progress'; }, 400);
    busy = false;
    if (again) { again = false; refresh(); }
  }
}
function setLive() {
  const age = Date.now() - S.lastOk;
  const ms = S.sum ? S.sum.config.refreshMs : 5000;
  const ok = S.lastOk && age < ms * 8;
  $('dot').className = 'dot ' + (ok ? 'live' : 'stale');
  let txt = ok ? 'LIVE' : 'STALE';
  const na = S.sum ? S.sum.activeAgents : 0;
  if (ok && na > 0) {
    const ns = S.sum.activeSessions.filter((x) => x.activeAgents > 0).length;
    txt += ` \u00b7 ${ns} session${ns === 1 ? '' : 's'} \u00b7 ${na} agent${na === 1 ? '' : 's'}`;
  }
  $('liveTxt').textContent = txt;
}

function connectSSE() {
  const es = new EventSource('/api/events');
  es.onopen = () => { S.sseOpen = true; };
  es.onmessage = (ev) => { try { if (JSON.parse(ev.data).type === 'update') refresh(); } catch { /* ignore */ } };
  es.onerror = () => { S.sseOpen = false; };
}

// ---------- init ----------
function init() {
  buildTiles(); initTables();
  document.querySelectorAll<HTMLButtonElement>('#win button').forEach((b) => b.addEventListener('click', () => { S.win = b.dataset.w; store.set('win', S.win); render(); loadTs(); }));
  $('toggleTable').addEventListener('click', () => {
    const showT = $('dailyTableWrap').classList.toggle('hidden') === false;
    $('dailyWrap').classList.toggle('hidden', showT);
    $('toggleTable').textContent = showT ? 'CHART' : 'TABLE';
  });
  const crBtns = [$('toggleCR'), $('tsCR')];
  const crText = () => crBtns.forEach((b) => { b.textContent = S.hideCR ? 'SHOW CACHE READ' : 'HIDE CACHE READ'; });
  crText();
  crBtns.forEach((b) => b.addEventListener('click', () => {
    S.hideCR = !S.hideCR; store.set('hideCR', S.hideCR ? '1' : '0');
    crText();
    if (charts.cDaily) { charts.cDaily.destroy(); delete charts.cDaily; }
    render();
    if (S.openId && S.lastDetail) drawerCharts(S.lastDetail);
  }));
  $('tsScope').replaceChildren(...scopeSeg(() => S.ts.scope, (v) => { S.ts.scope = v; loadTs(); }));
  $('drawerClose').addEventListener('click', closeDrawer);
  $('backdrop').addEventListener('click', closeDrawer);
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeDrawer();
    else if ((e.key === 'g' || e.key === 'G') && !e.metaKey && !e.ctrlKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName)) setView3d(true);
    else if ((e.key === 'p' || e.key === 'P') && !e.metaKey && !e.ctrlKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target as HTMLElement).tagName)) togglePriv();
  });
  // Tau 3D runs in a full-screen iframe on this page (no navigation); the frame is emptied on close so the GPU is freed.
  // privacy mode (P): blur titles, prompts, paths; the flag is shared with the 3D layer through localStorage
  const PRIV_KEY = 'claude-stats-privacy';
  const applyPriv = (on: boolean) => { document.body.classList.toggle('privacy', on); $('privBtn').setAttribute('aria-pressed', String(on)); };
  const togglePriv = () => { const on = !document.body.classList.contains('privacy'); applyPriv(on); try { localStorage.setItem(PRIV_KEY, on ? '1' : '0'); } catch { /* ignore */ } };
  { let v = false; try { v = localStorage.getItem(PRIV_KEY) === '1'; } catch { /* ignore */ } if (new URLSearchParams(location.search).has('privacy')) v = new URLSearchParams(location.search).get('privacy') === '1'; applyPriv(v); }
  $('privBtn').addEventListener('click', togglePriv);
  addEventListener('storage', (e) => { if (e.key === PRIV_KEY) applyPriv(e.newValue === '1'); });
  const markView = (on: boolean) => document.querySelectorAll('#viewSwitch button').forEach((b) => b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.v === '3d' ? on : !on)));
  const setView3d = (on: boolean) => {
    const box = $('view3d'), fr = $('f3d') as HTMLIFrameElement;
    if (on === !box.hidden) return;
    box.hidden = !on; document.body.classList.toggle('in3d', on); markView(on);
    if (on) { fr.src = '/tau3d.html'; fr.addEventListener('load', () => fr.contentWindow?.focus(), { once: true }); history.replaceState(null, '', '#3d'); }
    else { fr.src = 'about:blank'; history.replaceState(null, '', location.pathname + location.search); window.focus(); }
  };
  addEventListener('message', (e) => { if (e.origin === location.origin && e.data && e.data.type === 'tau3d:close') setView3d(false); });
  document.querySelectorAll('#viewSwitch button').forEach((b) => b.addEventListener('click', () => setView3d((b as HTMLElement).dataset.v === '3d')));
  if (location.hash === '#3d') setView3d(true);
  const rethemed = () => setTimeout(() => { render(); if (S.openId) loadDrawer(false); }, 50);
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', rethemed);
  const curTheme = () => { const t = document.documentElement.getAttribute('data-theme'); return t === 'dark' || t === 'light' ? t : 'auto'; };
  const markTheme = () => document.querySelectorAll<HTMLButtonElement>('#theme button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.t === curTheme())));
  markTheme();
  document.querySelectorAll<HTMLButtonElement>('#theme button').forEach((b) => b.addEventListener('click', () => {
    const t = b.dataset.t;
    if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', t);
    store.set('claude-stats-theme', t);
    markTheme(); rethemed();
  }));
  connectSSE();
  const m = location.hash.match(/^#session\/([\w-]+)$/);
  refresh();
  if (m) openDrawer(m[1]);
  // fallback polling when SSE is down; slow heartbeat otherwise so "last scan" stays fresh
  setInterval(() => {
    const ms = S.sum ? S.sum.config.refreshMs : 5000;
    if (Date.now() - S.lastOk >= ms * (S.sseOpen ? 4 : 1) - 250) refresh();
    setLive();
  }, 1000);
}
init();
