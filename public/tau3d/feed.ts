// @ts-nocheck - TODO(types): remove once this module is typed
import { H } from './shared.ts';
import { base, fmtCost, fmtTok, shortModel, trunc } from './util.ts';
import { feed, hm, hms, params } from './dom.ts';
import { data } from './data.ts';

/* ============================================================ terminal feed (live agent log, bottom-left) */
export const FEED_MAX = 200;
try { if (params.get('feed') == null && localStorage.getItem('tau3d.feed') === '0') feed.on = false; } catch (e) { /* storage unavailable */ }
export function feedPush(kind, text, dim, instant) {
  const it = { kind, text: trunc(text, 150), dim: dim ? String(dim) : '', instant: !!instant }; feed.lines.push(it); if (feed.lines.length > FEED_MAX) feed.lines.shift(); feed.q.push(it); feed.lastLine = performance.now();
}
export const feedSys = (text) => feedPush('s', `# ${hms(Date.now())} ${text}`);
export function feedRow(it, full) {
  const row = document.createElement('div'); row.className = 'fl k' + it.kind; const m = document.createElement('span'), d = document.createElement('span'); d.className = 'fd'; row.append(m, d); feed.inn.append(row);
  while (feed.inn.children.length > 14) feed.inn.removeChild(feed.inn.firstChild);
  const t = { it, m, d, n: full ? 9999 : 0, len: it.text.length + (it.dim ? it.dim.length + 2 : 0) }; paintRow(t);
  if (!full) { const lh = row.offsetHeight || 14; feed.inn.style.transition = 'none'; feed.inn.style.transform = `translateY(${lh}px)`; void feed.inn.offsetHeight; feed.inn.style.transition = 'transform .25s ease-out'; feed.inn.style.transform = 'translateY(0)'; }
  return t;
}
export function paintRow(t) { const L = t.it.text.length; t.m.textContent = t.it.text.slice(0, t.n); t.d.textContent = t.n > L && t.it.dim ? '  ' + t.it.dim.slice(0, Math.max(0, t.n - L - 2)) : ''; }
setInterval(() => {
  if (!feed.on) { feed.q.length = 0; feed.typing = null; return; }
  if (!feed.typing) { const it = feed.q.shift(); if (!it) return; feed.typing = feedRow(it, false); }
  const t = feed.typing; t.n += feed.q.length > 5 || t.it.instant ? 9999 : 5; paintRow(t); if (t.n >= t.len) feed.typing = null;
}, 30);
export function feedToggle(on) {
  feed.on = on === undefined ? !feed.on : on; feed.el.hidden = !feed.on; try { localStorage.setItem('tau3d.feed', feed.on ? '1' : '0'); } catch (e) { /* ignore */ }
  if (feed.on) { feed.inn.textContent = ''; feed.q.length = 0; feed.typing = null; feed.lines.slice(-10).forEach((it) => feedRow(it, true)); }
}
export const feedEmit = (ts, kind, text, dim) => { if (!feed.flushed) feed.pre.push({ ts, kind, text, dim }); else feedPush(kind, text, dim); };
export function feedFlush() { // backfill: last ~15 lines in chronological order
  feed.flushed = true; feed.pre.sort((a, b) => a.ts - b.ts); feed.pre.slice(-15).forEach((x) => feedPush(x.kind, x.text, x.dim, true)); feed.pre.length = 0; feedSys('tau://feed online'); 
}
export function feedHistory() {
  for (const h of (data.history || []).slice().reverse()) { const key = 'p:' + trunc(h.display, 60); if (feed.seen.has(key)) continue; feed.seen.add(key); feedEmit(h.ts || Date.now(), 'u', `> ${hm(h.ts || Date.now())} [${base(h.project)}] ${trunc(h.display, 90)}`); }
}
export const feedActive = (s) => !!(s.isActive || feed.calls.has(s.id) && feed.ag.size && [...feed.ag.keys()].some((k) => k.startsWith(s.id + ':')));
export function feedIngest(s, d) { // new lines from a session detail (active sessions only), diffed against what we saw before
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

// late-bound for callers in earlier modules (see shared.ts H)
Object.assign(H, { feedActive, feedHistory, feedIngest, feedPush, feedSys });
