// Shared data shapes for the server (src/*.ts) and the browser client (public/, via `import type`).
// Types only: this file must stay free of runtime code.

// ---- config (src/config.ts) ----
export interface Config {
  claudeHome: string; host: string; port: number; refreshMs: number; activeWindowMin: number; waitIdleSec: number; publicDir: string;
}

// ---- pricing (src/pricing.ts) ----
export interface Price { p: string; in: number; out: number; cr: number } // USD per 1M tokens
export interface TokenDelta { input: number; out: number; cr: number; cw5: number; cw1: number } // one API call's usage

// ---- accumulators (aggregate.ts newAcc) ----
export interface Acc { input: number; cw5: number; cw1: number; cr: number; out: number; thinking: number; calls: number; tools: number; web: number; cost: number }
export interface ModelAcc extends Acc { unknownPricing: boolean }
export interface DayAcc extends Acc { byModel: Record<string, Acc> }
export interface ProjectAcc extends Acc { sessions: Set<string>; last: string }
// token counts as shaped for API payloads (accTokens / session.tokens)
export interface TokenCounts { input: number; cacheWrite5m: number; cacheWrite1h: number; cacheRead: number; output: number; thinking: number; total: number }

// ---- transcript records ----
// Claude Code JSONL lines are heterogeneous, untyped JSON.parse output and are checked field by field at runtime
// in scanner.ts, so they stay `any` at that boundary on purpose.
export type RawRecord = any;

export interface Prompt { ts: string | null; text: string }
export interface Question { header: string; question: string; multiSelect: boolean; options: string[] }
// a tool_use still waiting for its tool_result (keyed by tool_use id in FileState.pending)
export interface PendingTool { name: string; ts: string | null; summary?: string; questions?: Question[]; planTitle?: string; planExcerpt?: string }
// last 'cost-state' record of a session (written by Claude Code)
export interface CostState { totalCostUSD?: number; totalLinesAdded?: number; totalLinesRemoved?: number; totalAPIDuration?: number; totalToolDuration?: number }
// one API call; ctx = input-side tokens (input + cache), a context-size proxy
export interface CallRec { t: number; model: string; agentId: string | null; ctx: number }
// per-minute usage bucket inside a session
export interface TsUsage { input: number; cw5: number; cw1: number; cr: number; out: number; think: number; calls: number; cost: number }
export interface Hourly { tokens: number; cost: number; calls: number }
// subagent launch info taken from the parent's Agent tool result
export interface Launch { description: string; model: string; type: string }
export interface AgentMeta { type: string; description: string; model: string }

export interface AgentStat {
  id: string; metaType: string; metaDesc: string; metaModel: string; attrType: string; models: Set<string>; acc: Acc;
  first: string | null; last: string | null; mtime: number; effort: string | null;
}

export interface Session {
  id: string; cwd: string; gitBranch: string; version: string; first: string | null; last: string | null; acc: Acc; models: Map<string, ModelAcc>;
  title: string; firstPrompt: string; promptCount: number; prompts: Prompt[]; turnMs: number; cs: CostState | null; agents: Set<string>;
  ts: Map<number, Map<string, TsUsage>>; calls: CallRec[]; agentStats: Map<string, AgentStat>; launches: Map<string, Launch>; main: Acc;
  effort: string | null; permissionMode: string | null; sessionKind: string | null; agentName: string | null; hourly: Map<string, Hourly>; mtime: number;
}

// ---- scanner state ----
export type LineHandler = (st: ScannerState, line: string, fi: Cursor) => void;
// a file being tailed from `offset`; history.jsonl uses a bare Cursor, transcripts use FileState
export interface Cursor { path: string; offset: number; sids: Set<string>; handler: LineHandler }
export interface FileState extends Cursor {
  sid: string; isSub: boolean; agentId: string | null; meta: AgentMeta | null; metaTries?: number; size: number; mtime: number; ino: number;
  pending: Map<string, PendingTool>;
}

// a transcript file found on disk by discover(); subagent files carry isSub + agentId
export interface FileRef { path: string; sid: string; isSub?: boolean; agentId?: string }
export interface HistEntry { ts: number; display: string; project: string; sessionId: string }
export interface IndexEntry { sessionId?: string; summary?: string; firstPrompt?: string }
export interface Settings { model: string | null; effortLevel: string | null; alwaysThinkingEnabled: boolean | null }

// sessions/<pid>.json written by Claude Code; `alive` is checked against the pid on each scan
export interface LiveSession { pid: number; sessionId: string; cwd: string; kind: string | null; name: string; status: string; waitingFor: string | null; statusSince: string | null; alive: boolean }
export type LiveRecord = Omit<LiveSession, 'alive'>;

export interface ScannerState {
  files: Map<string, FileState>; seen: Set<string>; sessions: Map<string, Session>;
  total: Acc; models: Map<string, ModelAcc>; days: Map<string, DayAcc>; projects: Map<string, ProjectAcc>;
  effort: Record<string, number>; tier: Record<string, number>; speed: Record<string, number>; geo: Record<string, number>; hours: number[];
  malformed: number; bytesRead: number;
  hist: { offset: number; size: number; ino: number; entries: HistEntry[]; lastKey: string };
  histDays: Map<string, number>; histProjects: Map<string, number>;
  indexes: Map<string, { mtime: number; entries: IndexEntry[] }>; indexBySid: Map<string, IndexEntry>;
  statsCache: Record<string, unknown> | null; scMtime: number; settings: Settings | null; setMtime: number; live: Map<string, LiveSession>;
}

export interface ScanMeta {
  filesScanned: number; bytesRead: number; malformed: number; lastScan: string | null; scanMs: number; claudeHome: string; changedFiles: number; scans: number;
}
export interface ScanEvent { type: 'update'; scannedAt: string; changedFiles: number }

// ---- waiting for the user (aggregate.ts) ----
export type WaitKind = 'question' | 'plan' | 'permission' | 'input';
export interface WaitInfo {
  kind: WaitKind; confidence: 'certain' | 'maybe'; tool: string; since: string | null; agentId: string | null; agentType: string | null; agentDescription: string | null;
  title: string; questions: Question[]; text: string; waitingFor: string | null; sessionName: string | null; pendingCount?: number;
}
export interface WaitEntry { main: WaitInfo | null; agents: Map<string, WaitInfo> }
export interface WaitExtra { waitingFor?: string | null; sessionName?: string | null }
export interface WaitingRow extends WaitInfo { sessionId: string; sessionTitle: string }
export interface LiveView { status: string; waitingFor: string | null; name: string; kind: string | null; pid: number; statusSince: string | null }

// ---- API payloads ----
export interface AgentView {
  id: string; type: string; description: string; models: string[]; tokens: TokenCounts; cost: number; calls: number; toolCalls: number;
  first: string | null; last: string | null; mtime: number; effort: string | null; isActive: boolean; waiting: WaitInfo | null;
}

export interface SessionSummary {
  id: string; title: string; cwd: string; gitBranch: string; version: string; first: string | null; last: string | null; durationMs: number; turnMs: number;
  models: string[]; tokens: TokenCounts; cost: number;
  reported: { cost: number | null; linesAdded: number; linesRemoved: number; apiMs: number; toolMs: number } | null;
  promptCount: number; firstPrompt: string; calls: number; toolCalls: number; subagents: number;
  activeAgents: number; agentCost: number; agentTokens: number; mtime: number; isActive: boolean; effort: string | null;
  permissionMode: string | null; sessionKind: string | null; agentName: string | null; waiting: WaitInfo | null; live: LiveView | null;
}

// model row inside a session (ModelAcc plus derived fields)
export interface SessionModelRow extends ModelAcc { model: string; total: number; unknownPricing: boolean }
export interface HourlyRow extends Hourly { hour: string }

// detail = summary, but `calls` is the call list (the summary's count moves to callCount)
export interface SessionDetail extends Omit<SessionSummary, 'models' | 'calls'> {
  callCount: number; calls: CallRec[]; agents: AgentView[]; main: { tokens: TokenCounts; cost: number; calls: number };
  prompts: Prompt[]; models: SessionModelRow[]; perModel: SessionModelRow[]; hourly: HourlyRow[]; cacheHit: number;
}

export interface DayRow {
  date: string; input: number; cw5: number; cw1: number; cr: number; out: number; calls: number; cost: number; prompts: number; total: number; byModel: Record<string, Acc>;
}
export interface AvgRow { input: number; cacheWrite: number; cacheRead: number; output: number; total: number; cost: number; calls: number }
export interface ProjectionInsufficient { insufficient: true }
export interface ProjectionData {
  today: { date: string; tokens: number; cost: number; calls: number; hoursElapsed: number; pace: { cost: number; tokens: number } };
  avg7: AvgRow; avg30: AvgRow; activeDays7: number; activeDays30: number; avgActive30: AvgRow;
  trend30: { costPerDayDelta: number; pct: number };
  monthToDate: { tokens: number; cost: number; daysElapsed: number; daysRemaining: number };
  projectedMonth: { cost: number; tokens: number; basis: 'avg7'; costAlt: number; tokensAlt: number };
  next7: { cost: number; tokens: number }; next30: { cost: number; tokens: number };
  perModelMonth: { model: string; share: number; cost: number }[];
  forecastDays: { date: string; total: number; cacheRead: number; cost: number }[];
  history: Omit<DayRow, 'byModel'>[];
}
export type Projection = ProjectionInsufficient | ProjectionData;

export interface PerModelRow extends ModelAcc { model: string; total: number; costShare: number }
export interface PerDayRow extends DayAcc { date: string; total: number; prompts: number }
export interface ProjectRow extends Omit<ProjectAcc, 'sessions'> { cwd: string; total: number; sessions: number; prompts: number }
export interface AgentTypeTotals { runs: number; tokens: number; cost: number }
export interface LiveBrief { sessionId: string; name: string; status: string; waitingFor: string | null; statusSince: string | null; cwd: string }

export interface SummaryResponse {
  activeAgents: number; perAgentType: Record<string, AgentTypeTotals>;
  totals: Acc & { total: number; cacheHit: number; reportedCost: number; sessions: number };
  perModel: PerModelRow[]; perDay: PerDayRow[]; perProject: ProjectRow[]; projection: Projection;
  effort: Record<string, number>; tier: Record<string, number>; speed: Record<string, number>; geo: Record<string, number>; hours: number[];
  settings: Settings | null; statsCache: Record<string, unknown> | null;
  scan: ScanMeta; activeSessions: SessionSummary[]; waiting: WaitingRow[]; live: LiveBrief[];
  config: { refreshMs: number; activeWindowMin: number; waitIdleSec: number; claudeHome: string };
}

export interface TimeseriesQuery { window?: string; bucket?: string; model?: string; session?: string; scope?: string }
export interface TimeseriesPoint { t: number; perModel: Record<string, TsUsage> }
export interface TimeseriesResult {
  error?: undefined; window: string; bucket: string; bucketMs: number; scope: string; models: string[]; points: TimeseriesPoint[];
}
export interface TimeseriesError { error: string }
