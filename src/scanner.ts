// Incremental scanner: file path -> {offset, mtime, size, ino}; only appended bytes are parsed.
// Only touches projects/**, history.jsonl, stats-cache.json, settings.json under CLAUDE_HOME.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { Dirent, Stats } from 'node:fs';
import { cfg } from './config.ts';
import { costOf } from './pricing.ts';
import { newAcc, addTo } from './aggregate.ts';
import type { Acc, AgentStat, Cursor, FileRef, FileState, LiveRecord, LiveSession, ModelAcc, PendingTool, RawRecord, ScanEvent, ScanMeta, ScannerState, Session } from './types.ts';

function freshState(): ScannerState {
  return {
    files: new Map(), seen: new Set(), sessions: new Map(),
    total: newAcc(), models: new Map(), days: new Map(), projects: new Map(),
    effort: {}, tier: {}, speed: {}, geo: {}, hours: new Array(24).fill(0),
    malformed: 0, bytesRead: 0,
    hist: { offset: 0, size: 0, ino: 0, entries: [], lastKey: '' },
    histDays: new Map(), histProjects: new Map(),
    indexes: new Map(), indexBySid: new Map(),
    statsCache: null, scMtime: 0, settings: null, setMtime: 0, live: new Map(),
  };
}

export let state: ScannerState = freshState();
export const meta: ScanMeta = { filesScanned: 0, bytesRead: 0, malformed: 0, lastScan: null, scanMs: 0, claudeHome: cfg.claudeHome, changedFiles: 0, scans: 0 };
const listeners = new Set<(ev: ScanEvent) => void>();
export const onChange = (cb: (ev: ScanEvent) => void): (() => boolean) => { listeners.add(cb); return () => listeners.delete(cb); };

const inc = (o: Record<string, number>, k: string) => { k = String(k); o[k] = (o[k] || 0) + 1; };

function getSession(st: ScannerState, id: string): Session {
  let s = st.sessions.get(id);
  if (!s) {
    s = {
      id, cwd: '', gitBranch: '', version: '', first: null, last: null, acc: newAcc(), models: new Map(),
      title: '', firstPrompt: '', promptCount: 0, prompts: [], turnMs: 0, cs: null, agents: new Set(),
      ts: new Map(), calls: [], agentStats: new Map(), launches: new Map(), main: newAcc(),
      effort: null, permissionMode: null, sessionKind: null, agentName: null, hourly: new Map(), mtime: 0,
    };
    st.sessions.set(id, s);
  }
  return s;
}

function getAgent(sess: Session, id: string): AgentStat {
  let a = sess.agentStats.get(id);
  if (!a) {
    a = { id, metaType: '', metaDesc: '', metaModel: '', attrType: '', models: new Set(), acc: newAcc(), first: null, last: null, mtime: 0, effort: null, prompt: '', out: '' };
    sess.agentStats.set(id, a);
  }
  return a;
}

// plain text of a message (string content or text blocks); null when it carries tool results (not a prompt / not prose)
function textOf(o: RawRecord): string | null {
  const c = o.message && o.message.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return null;
  const parts: string[] = [];
  for (const b of c) { if (!b) continue; if (b.type === 'tool_result') return null; if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text); }
  return parts.join('\n');
}

function bump(st: ScannerState, sess: Session, model: string, day: string, cwd: string, ts: string, d: Partial<Acc>): { m: ModelAcc; sm: ModelAcc } {
  addTo(st.total, d);
  let m = st.models.get(model);
  if (!m) { m = { ...newAcc(), unknownPricing: false }; st.models.set(model, m); }
  addTo(m, d);
  let D = st.days.get(day);
  if (!D) { D = { ...newAcc(), byModel: {} }; st.days.set(day, D); }
  addTo(D, d);
  addTo(D.byModel[model] || (D.byModel[model] = newAcc()), d);
  const pk = cwd || sess.cwd || '(unknown)';
  let P = st.projects.get(pk);
  if (!P) { P = { ...newAcc(), sessions: new Set(), last: '' }; st.projects.set(pk, P); }
  addTo(P, d); P.sessions.add(sess.id);
  if (ts && ts > P.last) P.last = ts;
  addTo(sess.acc, d);
  let sm = sess.models.get(model);
  if (!sm) { sm = { ...newAcc(), unknownPricing: false }; sess.models.set(model, sm); }
  addTo(sm, d);
  return { m, sm };
}

function clean(t: string): string | null {
  t = t.trim();
  if (t.startsWith('<local-command-')) return null;
  const m = t.match(/<command-name>\s*([^<]*?)\s*<\/command-name>/);
  if (m) { const a = t.match(/<command-args>([^<]*)<\/command-args>/); return (m[1] + ' ' + (a ? a[1].trim() : '')).trim(); }
  return t || null;
}
function promptText(o: RawRecord): string | null {
  if (o.isSidechain || o.isMeta) return null;
  const hasField = (o.origin && o.origin.kind != null) || o.turnOrigin != null || o.promptSource != null;
  if (hasField && !((o.origin && o.origin.kind === 'human') || o.turnOrigin === 'human' || o.promptSource === 'typed')) return null;
  const c = o.message && o.message.content;
  let raw: string | null = null;
  if (typeof c === 'string') raw = c;
  else if (Array.isArray(c)) {
    for (const b of c) {
      if (!b) continue;
      if (b.type === 'tool_result') return null;
      if (b.type === 'text' && raw === null && typeof b.text === 'string') raw = b.text;
    }
  }
  if (raw == null) return null;
  const txt = clean(raw); // slash-command wrappers become "/name args" before the "<" check
  if (!txt) return null;
  if (!hasField && (txt.startsWith('<') || txt.startsWith('This session is being continued'))) return null;
  return txt;
}

// ---- pending tool_use tracking (waiting-for-user detection) ----
const cut = (v: string | null | undefined, n: number): string => { v = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : ''; return v.length > n ? v.slice(0, n - 1) + '…' : v; };
function pendingOf(b: RawRecord, ts: string | null): PendingTool {
  const inp = b.input && typeof b.input === 'object' ? b.input : {};
  const rec: PendingTool = { name: String(b.name || ''), ts: ts || null };
  if (rec.name === 'AskUserQuestion') {
    rec.questions = (Array.isArray(inp.questions) ? inp.questions : []).slice(0, 4).map((q) => ({
      header: cut(q && q.header, 60), question: cut(q && q.question, 300), multiSelect: !!(q && q.multiSelect),
      options: (Array.isArray(q && q.options) ? q.options : []).slice(0, 4).map((o) => cut(o && (o.label || o), 300)),
    }));
  } else if (rec.name === 'ExitPlanMode') {
    const plan = typeof inp.plan === 'string' ? inp.plan : '';
    const head = plan.split('\n').map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean) || '';
    rec.planTitle = cut(head, 120);
    rec.planExcerpt = cut(plan.replace(/[#*`>_-]+/g, ' '), 400);
  } else {
    rec.summary = cut(inp.command || inp.file_path || inp.description || inp.url || inp.pattern || inp.path || inp.prompt || '', 160);
  }
  return rec;
}
function trackPending(fi: FileState, o: RawRecord, humanPrompt: boolean): void {
  const c = o.message && o.message.content, pend = fi.pending;
  if (o.type === 'assistant') {
    if (Array.isArray(c)) for (const b of c) if (b && b.type === 'tool_use' && b.id) { pend.set(b.id, pendingOf(b, o.timestamp)); if (pend.size > 50) pend.delete(pend.keys().next().value); }
    return;
  }
  if (o.type !== 'user') return;
  let isResult = false, text = typeof c === 'string' ? c : '';
  if (Array.isArray(c)) for (const b of c) {
    if (!b) continue;
    if (b.type === 'tool_result') { isResult = true; pend.delete(b.tool_use_id); } else if (b.type === 'text' && typeof b.text === 'string' && !text) text = b.text;
  }
  if (!isResult && (humanPrompt || /^\s*\[Request interrupted/.test(text))) pend.clear();
}

function handleLine(st: ScannerState, str: string, fi: FileState): void {
  let o: RawRecord;
  try { o = JSON.parse(str); } catch { st.malformed++; return; }
  if (!o || typeof o !== 'object') return;
  const t = o.type;
  if (!t) return;
  const sid = o.sessionId || fi.sid;
  switch (t) {
    case 'assistant': case 'user': case 'system': {
      const s = getSession(st, sid);
      fi.sids.add(sid);
      const ts = o.timestamp;
      if (ts) { if (!s.first || ts < s.first) s.first = ts; if (!s.last || ts > s.last) s.last = ts; }
      if (o.cwd && !s.cwd) s.cwd = o.cwd;
      if (o.gitBranch) s.gitBranch = o.gitBranch;
      if (o.version) s.version = o.version;
      if (o.sessionKind) s.sessionKind = o.sessionKind;
      const aid = fi.isSub ? (o.agentId || fi.agentId) : null;
      if (o.agentId) s.agents.add(o.agentId);
      if (aid) {
        const a = getAgent(s, aid);
        if (ts) { if (!a.first || ts < a.first) a.first = ts; if (!a.last || ts > a.last) a.last = ts; }
        if (o.attributionAgent) a.attrType = o.attributionAgent;
        if (t === 'user' && !a.prompt) { const p = textOf(o); if (p && p.trim()) a.prompt = p.trim().slice(0, 600); }
        else if (t === 'assistant') { const p = textOf(o); if (p && p.trim()) a.out = (a.out + (a.out ? '\n' : '') + p.trim()).slice(-2000); }
      }
      const tur = t === 'user' && !fi.isSub && o.toolUseResult;
      if (tur && typeof tur === 'object' && tur.agentId) {
        s.launches.set(tur.agentId, { description: tur.description || '', model: tur.resolvedModel || '', type: tur.agentType || tur.subagent_type || '' });
      }
      if (t === 'assistant') { handleAssistant(st, o, s, aid); trackPending(fi, o, false); }
      else if (t === 'user') {
        const txt = promptText(o);
        trackPending(fi, o, !!txt);
        if (txt) {
          s.promptCount++;
          if (!s.firstPrompt) s.firstPrompt = txt.slice(0, 200);
          s.prompts.push({ ts: ts || null, text: txt.slice(0, 300) });
          if (s.prompts.length > 50) s.prompts.shift();
        }
      } else if (o.subtype === 'turn_duration' && typeof o.durationMs === 'number') s.turnMs += o.durationMs;
      break;
    }
    case 'cost-state': getSession(st, sid).cs = o; fi.sids.add(sid); break;
    case 'ai-title': if (o.aiTitle) { getSession(st, sid).title = o.aiTitle; fi.sids.add(sid); } break;
    case 'permission-mode': if (o.permissionMode) { getSession(st, sid).permissionMode = o.permissionMode; fi.sids.add(sid); } break;
    case 'agent-name': if (o.agentName) { getSession(st, sid).agentName = o.agentName; fi.sids.add(sid); } break;
    default: break;
  }
}

function handleAssistant(st: ScannerState, o: RawRecord, sess: Session, aid: string | null): void {
  const m = o.message;
  if (!m || typeof m !== 'object') return;
  const model = m.model || 'unknown';
  const ts = o.timestamp || '';
  const day = ts ? ts.slice(0, 10) : 'unknown';
  const cwd = o.cwd || sess.cwd;
  let tools = 0;
  if (Array.isArray(m.content)) for (const b of m.content) if (b && b.type === 'tool_use') tools++;
  const id = m.id || o.requestId || o.uuid;
  const isFirst = id ? !st.seen.has(id) : true;
  if (id && isFirst) st.seen.add(id);
  const u = m.usage;
  const d: Partial<Acc> = { tools };
  let counted = false;
  if (isFirst && u && typeof u === 'object') {
    const cc = u.cache_creation;
    const total = u.cache_creation_input_tokens || 0;
    let cw5 = total, cw1 = 0;
    if (cc && (typeof cc.ephemeral_5m_input_tokens === 'number' || typeof cc.ephemeral_1h_input_tokens === 'number')) {
      cw5 = cc.ephemeral_5m_input_tokens || 0; cw1 = cc.ephemeral_1h_input_tokens || 0;
    }
    const tk = { input: u.input_tokens || 0, out: u.output_tokens || 0, cr: u.cache_read_input_tokens || 0, cw5, cw1 };
    if (tk.input + tk.out + tk.cr + tk.cw5 + tk.cw1 > 0) {
      counted = true;
      const { cost, unknown } = costOf(model, tk);
      Object.assign(d, tk, {
        thinking: (u.output_tokens_details && u.output_tokens_details.thinking_tokens) || 0,
        web: (u.server_tool_use && u.server_tool_use.web_search_requests) || 0,
        calls: 1, cost,
      });
      const hk = ts ? ts.slice(0, 13) : null;
      if (hk) {
        let h = sess.hourly.get(hk);
        if (!h) { h = { tokens: 0, cost: 0, calls: 0 }; sess.hourly.set(hk, h); }
        h.tokens += tk.input + tk.out + tk.cr + tk.cw5 + tk.cw1; h.cost += cost; h.calls++;
      }
      inc(st.effort, o.effort ?? 'unset'); inc(st.tier, u.service_tier ?? 'unknown');
      inc(st.speed, u.speed ?? 'unknown'); inc(st.geo, u.inference_geo ?? 'unknown');
      if (ts) { const hr = new Date(ts).getHours(); if (hr >= 0) st.hours[hr]++; }
      if (o.effort) sess.effort = o.effort;
      const r = bump(st, sess, model, day, cwd, ts, d);
      split(sess, aid, model, d, o);
      if (ts) recordTs(sess, ts, model, aid, d, tk.input + tk.cr + tk.cw5 + tk.cw1);
      if (unknown) { r.m.unknownPricing = true; r.sm.unknownPricing = true; }
    }
  }
  if (!counted && tools > 0) { bump(st, sess, model, day, cwd, ts, d); split(sess, aid, model, d, o); }
}

// attribute a bumped delta to the main session or to one subagent (session totals already include both)
function split(sess: Session, aid: string | null, model: string, d: Partial<Acc>, o: RawRecord): void {
  if (!aid) { addTo(sess.main, d); return; }
  const a = getAgent(sess, aid);
  addTo(a.acc, d);
  a.models.add(model);
  if (o.effort) a.effort = o.effort;
}

// minute buckets: minute(epoch ms) -> Map('m|'|'a|' + model -> usage); 'a' = subagent file, 'm' = main file
function recordTs(sess: Session, ts: string, model: string, aid: string | null, d: Partial<Acc>, ctx: number): void {
  const t = Date.parse(ts);
  if (!Number.isFinite(t)) return;
  const mk = Math.floor(t / 60000) * 60000;
  let b = sess.ts.get(mk);
  if (!b) { b = new Map(); sess.ts.set(mk, b); }
  const k = (aid ? 'a|' : 'm|') + model;
  let x = b.get(k);
  if (!x) { x = { input: 0, cw5: 0, cw1: 0, cr: 0, out: 0, think: 0, calls: 0, cost: 0 }; b.set(k, x); }
  x.input += d.input; x.cw5 += d.cw5; x.cw1 += d.cw1; x.cr += d.cr; x.out += d.out; x.think += d.thinking; x.calls++; x.cost += d.cost;
  sess.calls.push({ t, model, agentId: aid || null, ctx });
}

async function readAgentMeta(fi: FileState): Promise<void> {
  fi.metaTries = (fi.metaTries || 0) + 1;
  try {
    const j = JSON.parse(await fsp.readFile(fi.path.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
    fi.meta = { type: j.agentType || '', description: j.description || '', model: j.model || '' };
  } catch { /* missing or partial: retry a few scans */ }
}

async function readNew(st: ScannerState, fi: Cursor, size: number): Promise<void> {
  const start = fi.offset;
  let rem = Buffer.alloc(0), fed = 0, consumed = 0;
  const stream = fs.createReadStream(fi.path, { start, end: size - 1, highWaterMark: 1 << 20 });
  for await (const chunk of stream) {
    st.bytesRead += chunk.length; fed += chunk.length;
    const buf = rem.length ? Buffer.concat([rem, chunk]) : chunk;
    let pos = 0, nl;
    while ((nl = buf.indexOf(10, pos)) !== -1) {
      if (nl > pos) fi.handler(st, buf.toString('utf8', pos, nl), fi);
      pos = nl + 1;
    }
    consumed = fed - (buf.length - pos);
    rem = Buffer.from(buf.subarray(pos));
    await new Promise((r) => setImmediate(r));
  }
  fi.offset = start + consumed;
}

async function discover(root: string): Promise<{ files: FileRef[]; indexes: string[] }> {
  const files: FileRef[] = [], indexes: string[] = [];
  const pdir = path.join(root, 'projects');
  let projs: Dirent[] = [];
  try { projs = await fsp.readdir(pdir, { withFileTypes: true }); } catch { return { files, indexes }; }
  await Promise.all(projs.filter((p) => p.isDirectory()).map(async (p) => {
    const dir = path.join(pdir, p.name);
    let ents: Dirent[] = [];
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isFile() && e.name.endsWith('.jsonl')) files.push({ path: path.join(dir, e.name), sid: e.name.slice(0, -6) });
      else if (e.isFile() && e.name === 'sessions-index.json') indexes.push(path.join(dir, e.name));
      else if (e.isDirectory() && e.name !== 'memory') {
        const sub = path.join(dir, e.name, 'subagents');
        try {
          for (const f of await fsp.readdir(sub, { withFileTypes: true })) {
            if (f.isFile() && f.name.endsWith('.jsonl')) files.push({ path: path.join(sub, f.name), sid: e.name, isSub: true, agentId: f.name.replace(/^agent-/, '').slice(0, -6) });
          }
        } catch { /* no subagents */ }
      }
    }
  }));
  return { files, indexes };
}

async function statOf(p: string): Promise<Stats | null> { try { return await fsp.stat(p); } catch { return null; } }

function handleHistory(st: ScannerState, str: string): void {
  let o: RawRecord;
  try { o = JSON.parse(str); } catch { st.malformed++; return; }
  if (!o || typeof o.timestamp !== 'number') return;
  const display = typeof o.display === 'string' ? o.display : '';
  const key = `${o.timestamp}|${o.sessionId}|${display}`;
  if (key === st.hist.lastKey) return;
  st.hist.lastKey = key;
  st.hist.entries.push({ ts: o.timestamp, display: display.slice(0, 400), project: o.project || '', sessionId: o.sessionId || '' });
  const day = new Date(o.timestamp).toISOString().slice(0, 10);
  st.histDays.set(day, (st.histDays.get(day) || 0) + 1);
  if (o.project) st.histProjects.set(o.project, (st.histProjects.get(o.project) || 0) + 1);
}

// ---- live status written by Claude Code itself: sessions/<pid>.json (only *.json; the *.key files are never touched) ----
const liveCache = new Map<string, { mtime: number; rec: LiveRecord | null }>(); // path -> { mtime, rec }
let liveSig = '';
const pidAlive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
async function readLive(root: string): Promise<Map<string, LiveSession>> {
  const dir = path.join(root, 'sessions'), out = new Map<string, LiveSession>(), seen = new Set<string>(); let names: string[] = [];
  try { names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.json') && !n.startsWith('.')); } catch { liveCache.clear(); return out; }
  for (const n of names) {
    const p = path.join(dir, n); seen.add(p); const stt = await statOf(p); if (!stt) continue;
    let c = liveCache.get(p);
    if (!c || c.mtime !== stt.mtimeMs) {
      let rec: LiveRecord | null = null;
      try { // keep only the few fields we need
        const j = JSON.parse(await fsp.readFile(p, 'utf8'));
        if (j && typeof j.sessionId === 'string' && Number.isFinite(j.pid)) rec = { pid: j.pid, sessionId: j.sessionId, cwd: typeof j.cwd === 'string' ? j.cwd : '', kind: j.kind || null, name: typeof j.name === 'string' ? j.name : '', status: typeof j.status === 'string' ? j.status : '', waitingFor: typeof j.waitingFor === 'string' ? j.waitingFor : null, statusSince: Number.isFinite(j.statusUpdatedAt) ? new Date(j.statusUpdatedAt).toISOString() : null };
      } catch { /* partial write: retry next scan */ }
      c = { mtime: stt.mtimeMs, rec }; liveCache.set(p, c);
    }
    if (!c.rec) continue;
    const rec = { ...c.rec, alive: pidAlive(c.rec.pid) }, prev = out.get(rec.sessionId);
    if (!prev || (rec.alive && !prev.alive) || (rec.alive === prev.alive && (rec.statusSince || '') > (prev.statusSince || ''))) out.set(rec.sessionId, rec);
  }
  for (const p of liveCache.keys()) if (!seen.has(p)) liveCache.delete(p);
  return out;
}

let running: Promise<void> | null = null;
export function scan(): Promise<void> {
  if (!running) running = doScan().finally(() => { running = null; });
  return running;
}

async function doScan(): Promise<void> {
  const t0 = Date.now();
  const root = cfg.claudeHome;
  let st = state;
  const { files, indexes } = await discover(root);
  const stats = await Promise.all(files.map((f) => statOf(f.path)));
  const list: (FileRef & { st: Stats })[] = [];
  files.forEach((f, i) => { if (stats[i]) list.push({ ...f, st: stats[i] }); });

  // reset detection: shrink, inode change, or removed file => rebuild from scratch in a fresh state
  let reset = false;
  const present = new Set(list.map((f) => f.path));
  for (const [p, fi] of st.files) if (!present.has(p)) { reset = true; break; }
  if (!reset) for (const f of list) {
    const fi = st.files.get(f.path);
    if (fi && (f.st.size < fi.offset || f.st.ino !== fi.ino)) { reset = true; break; }
  }
  let next = st;
  if (reset) { next = freshState(); next.hist = st.hist; /* history handled below */ }
  const target = next;

  let changed = 0;
  for (const f of list) {
    let fi = target.files.get(f.path);
    if (!fi) { fi = { path: f.path, sid: f.sid, isSub: !!f.isSub, agentId: f.agentId || null, meta: null, offset: 0, size: 0, mtime: 0, ino: f.st.ino, sids: new Set(), handler: handleLine, pending: new Map() }; target.files.set(f.path, fi); }
    if (f.st.size > fi.offset) {
      changed++;
      await readNew(target, fi, f.st.size);
    }
    fi.size = f.st.size; fi.mtime = f.st.mtimeMs; fi.ino = f.st.ino;
    if (fi.isSub) {
      const s = target.sessions.get(fi.sid);
      if (!fi.meta && (fi.metaTries || 0) < 5) await readAgentMeta(fi);
      if (s) {
        const a = getAgent(s, fi.agentId);
        a.mtime = fi.mtime;
        if (fi.meta) { a.metaType = fi.meta.type; a.metaDesc = fi.meta.description; a.metaModel = fi.meta.model; }
      }
    }
    for (const sid of fi.sids) { const s = target.sessions.get(sid); if (s && fi.mtime > s.mtime) s.mtime = fi.mtime; }
  }

  // history.jsonl (incremental, own reset)
  const hp = path.join(root, 'history.jsonl');
  const hs = await statOf(hp);
  if (hs) {
    const h = target.hist;
    if (hs.size < h.offset || (h.ino && hs.ino !== h.ino)) {
      Object.assign(h, { offset: 0, entries: [], lastKey: '' }); target.histDays = new Map(); target.histProjects = new Map();
    }
    if (hs.size > h.offset) {
      changed++;
      const fi: Cursor = { path: hp, offset: h.offset, handler: handleHistory, sids: new Set() };
      await readNew(target, fi, hs.size);
      h.offset = fi.offset;
    }
    h.ino = hs.ino; h.size = hs.size;
    if (h.entries.length > 2000) h.entries.splice(0, h.entries.length - 2000);
  }

  // small JSON files on mtime change
  const sc = await statOf(path.join(root, 'stats-cache.json'));
  if (sc && sc.mtimeMs !== target.scMtime) {
    try { target.statsCache = JSON.parse(await fsp.readFile(path.join(root, 'stats-cache.json'), 'utf8')); target.scMtime = sc.mtimeMs; changed++; } catch { /* keep old */ }
  }
  const se = await statOf(path.join(root, 'settings.json'));
  if (se && se.mtimeMs !== target.setMtime) {
    try {
      const j = JSON.parse(await fsp.readFile(path.join(root, 'settings.json'), 'utf8'));
      target.settings = { model: j.model ?? null, effortLevel: j.effortLevel ?? null, alwaysThinkingEnabled: j.alwaysThinkingEnabled ?? null };
      target.setMtime = se.mtimeMs; changed++;
    } catch { /* keep old */ }
  }
  let idxChanged = false;
  for (const ip of indexes) {
    const is = await statOf(ip);
    if (!is) continue;
    const prev = target.indexes.get(ip);
    if (prev && prev.mtime === is.mtimeMs) continue;
    try {
      const j = JSON.parse(await fsp.readFile(ip, 'utf8'));
      target.indexes.set(ip, { mtime: is.mtimeMs, entries: Array.isArray(j.entries) ? j.entries : [] });
      idxChanged = true;
    } catch { /* ignore */ }
  }
  if (idxChanged) {
    target.indexBySid = new Map();
    for (const { entries } of target.indexes.values()) for (const e of entries) if (e && e.sessionId) target.indexBySid.set(e.sessionId, { summary: e.summary, firstPrompt: e.firstPrompt });
    changed++;
  }

  target.live = await readLive(root);
  const sig = [...target.live.values()].map((r) => `${r.sessionId}:${r.alive}:${r.status}:${r.waitingFor}:${r.statusSince}`).sort().join('|');
  if (sig !== liveSig) { liveSig = sig; changed++; } // a live status flipped: tell the page
  state = target;
  const ms = Date.now() - t0;
  Object.assign(meta, {
    filesScanned: target.files.size, bytesRead: target.bytesRead, malformed: target.malformed,
    lastScan: new Date().toISOString(), scanMs: ms, changedFiles: changed, scans: meta.scans + 1,
  });
  console.log(`[scan] changed=${changed} bytes=${target.bytesRead} total files=${target.files.size} ${ms}ms${reset ? ' (full rebuild)' : ''}`);
  if (changed) for (const cb of listeners) { try { cb({ type: 'update', scannedAt: meta.lastScan, changedFiles: changed }); } catch { /* ignore */ } }
}

export function start(): Promise<void> {
  const first = scan();
  timer = setInterval(() => { scan().catch((e) => console.error('[scan] error', e)); }, cfg.refreshMs);
  return first;
}
let timer: NodeJS.Timeout | null = null;
export function stop(): void { if (timer) clearInterval(timer); timer = null; }
