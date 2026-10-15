// @ts-nocheck - TODO(types): remove once this module is typed
import { H, S } from './shared.ts';
import { ago, base, fmtCost, fmtDur, fmtTok, fmtWords, rgba, shortModel, trunc } from './util.ts';
import { $, hudEls, voice } from './dom.ts';
import { modelColor, pal } from './palettes.ts';
import { api, data } from './data.ts';
import { mouse, view } from './state.ts';

/* ============================================================ HUD, voice, panels (DOM) */
export function updateHud() {
  const s = data.summary; if (!s) return; const t = s.totals || {};
  hudEls.tok.textContent = fmtTok(t.total); hudEls.cost.textContent = fmtCost(t.cost); hudEls.cache.textContent = ((t.cacheHit || 0) * 100).toFixed(1) + '%';
  hudEls.ag.textContent = s.activeAgents || 0; hudEls.ses.textContent = t.sessions || 0; hudEls.home.textContent = (s.config && s.config.claudeHome || '-').replace(/^\/Users\/[^/]+/, '~');
  hudEls.scan.textContent = new Date(data.lastOk || Date.now()).toLocaleTimeString([], { hour12: false });
}
export function setLink(err) { hudEls.link.textContent = data.lost ? 'SIGNAL LOST' : err ? 'RECONNECTING' : 'LIVE'; $('voice').classList.toggle('lost', data.lost); }
export function renderLegend() {
  const el = $('legend'); el.textContent = ''; if (S.mode !== 3) return; const sr = S.pulse7 && data.series7 ? data.series7 : data.series; if (!sr) return;
  sr.models.forEach((m) => { const d = document.createElement('div'); const i = document.createElement('i'); i.style.color = rgba(modelColor(m), 1); const sp = document.createElement('span'); sp.textContent = shortModel(m); d.append(i, sp); el.append(d); });
}
export function say(text) { voice.text = text; voice.shown = 0; voice.last = performance.now(); }
setInterval(() => { if (voice.shown < voice.text.length) { voice.shown++; voice.el.textContent = voice.text.slice(0, voice.shown); } }, 36);
export function voiceLines() {
  const s = data.summary; if (!s) return []; const t = s.totals || {}, pj = s.projection || {}; const L = [];
  L.push(`I hold ${fmtWords(t.total)} tokens of memory.`);
  L.push(`Cache integrity at ${((t.cacheHit || 0) * 100).toFixed(1)}%.`);
  L.push(s.activeAgents ? `${s.activeAgents} sub-mind${s.activeAgents > 1 ? 's are' : ' is'} awake.` : 'All sub-minds are asleep.');
  if (pj.today) L.push(`Today's burn: ${fmtCost(pj.today.cost)}${pj.today.pace ? ` — pace ${fmtCost(pj.today.pace.cost)}` : ''}.`);
  L.push(`I remember ${t.sessions || 0} sessions across ${(s.perProject || []).length} places.`);
  if (view.domModel) L.push(`${shortModel(view.domModel)} has been thinking through me this hour.`);
  if (pj.monthToDate && pj.projectedMonth) L.push(`This month: ${fmtCost(pj.monthToDate.cost)} so far. I expect ${fmtCost(pj.projectedMonth.cost)}.`);
  if (data.history[0]) L.push(`Your most recent request: “${trunc(data.history[0].display, 80)}”`);
  const bad = S.rings.filter((r) => r.sev === 2).length, warn = S.rings.filter((r) => r.sev === 1).length;
  if (bad) L.push(`${bad} memor${bad > 1 ? 'ies are' : 'y is'} fragmenting.`); else if (warn) L.push(`${warn} memor${warn > 1 ? 'ies are' : 'y is'} under strain.`);
  if (view.act < 0.08) L.push('I am listening.');
  return L;
}
export function rotateVoice(first) { const L = voiceLines(); if (!L.length) return; voice.idx = first ? 0 : (voice.idx + 1) % L.length; say(L[voice.idx]); }
setInterval(() => { if (!voice.started || data.lost) return; if (performance.now() - voice.last > 8000 && voice.shown >= voice.text.length) rotateVoice(); }, 500);
export function announceChange(a, b) {
  if (!a || !b || performance.now() - S.lastAnnounce < 2500) return; const ta = a.totals || {}, tb = b.totals || {}; let msg = '';
  if ((tb.sessions || 0) > (ta.sessions || 0)) msg = 'A new memory has formed.';
  else if ((b.activeAgents || 0) !== (a.activeAgents || 0)) msg = `${b.activeAgents} sub-mind${b.activeAgents === 1 ? ' is' : 's are'} awake.`;
  else if ((tb.total || 0) > (ta.total || 0)) msg = `+${fmtTok(tb.total - ta.total)} tokens absorbed. +${fmtCost(tb.cost - ta.cost)}.`;
  if (msg) { S.lastAnnounce = performance.now(); say(msg); }
}

export function kv(k, v) { const d = document.createElement('div'); d.className = 'kv'; const a = document.createElement('span'), b = document.createElement('b'); a.textContent = k; b.textContent = v; d.append(a, b); return d; }
export const issLine = (x) => { const d = document.createElement('div'); d.className = 'iss ' + x.severity; d.textContent = `${x.severity.toUpperCase()} · ${x.kind}${x.count > 1 ? ' ×' + x.count : ''} — ${x.msg}${x.t ? ' · ' + ago(x.t) : ''}`; return d; };
export function updateMemcard() {
  const el = $('memcard'); const r = S.rings[S.sel]; if (S.mode !== 1 || !r) { el.hidden = true; return; }
  const s = r.s; el.hidden = false; el.className = 'panel'; el.textContent = '';
  const sub = document.createElement('div'); sub.className = 'sub'; sub.textContent = `MEMORY ${S.sel + 1} / ${S.rings.length}`;
  const h = document.createElement('h3'); h.textContent = trunc(s.title || s.firstPrompt, 90);
  el.append(sub, h, kv('Project', base(s.cwd)), kv('Cost', fmtCost(s.cost)), kv('Tokens', fmtTok(s.tokens && s.tokens.total)), kv('Duration', fmtDur(s.durationMs)), kv('Prompts', s.promptCount), kv('Calls', s.calls), kv('Last', ago(s.last)), kv('Models', (s.models || []).map(shortModel).join(', ') || '-'));
  (r.iss || []).forEach((x) => el.append(issLine(x)));
}
export function showTip() {
  const el = $('tip'); const r = S.rings[S.hover];
  if (S.clockHover && mouse.in && S.hover < 0) { el.hidden = false; el.className = 'panel'; el.textContent = S.clockTipStr; el.style.left = Math.min(mouse.x + 16, innerWidth - 120) + 'px'; el.style.top = Math.min(mouse.y + 16, innerHeight - 50) + 'px'; return; }
  if (!r || !mouse.in) { el.hidden = true; return; }
  const s = r.s; el.hidden = false; el.className = 'panel'; el.textContent = '';
  const h = document.createElement('h3'); h.style.cssText = 'margin:0 0 4px;font-size:11px;font-weight:500;color:#ffe9c8'; h.textContent = trunc(s.title || s.firstPrompt, 70);
  const d = document.createElement('div'); d.textContent = `${base(s.cwd)} · ${fmtCost(s.cost)} · ${fmtTok(s.tokens && s.tokens.total)} · ${s.calls} calls · ${ago(s.last)}${s.isActive ? ' · ACTIVE' : ''}`;
  el.append(h, d); (r.iss || []).forEach((x) => el.append(issLine(x))); el.style.left = Math.min(mouse.x + 16, innerWidth - 300) + 'px'; el.style.top = Math.min(mouse.y + 16, innerHeight - 80) + 'px';
}

export async function openDetail() {
  const r = S.rings[S.sel]; if (!r) return; const el = $('detail'); S.detailOpen = true; el.hidden = false; el.className = 'panel'; el.textContent = 'ACCESSING MEMORY...';
  let d; try { d = await api.get('/api/sessions/' + encodeURIComponent(r.id)); } catch (e) { el.textContent = 'MEMORY UNREADABLE (' + e.message + ')'; return; }
  if (!S.detailOpen) return; el.textContent = '';
  const x = document.createElement('div'); x.className = 'close'; x.textContent = '[ESC]'; x.onclick = closePanels;
  const sub = document.createElement('div'); sub.className = 'sub'; sub.textContent = `MEMORY ${S.sel + 1} · ${base(d.cwd)}${d.isActive ? ' · ACTIVE' : ''}`;
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
export function drawSpark(cvs, calls) {
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

export const HELP = [['1 - 5', 'Core / Memory / Neural / Pulse / Models'], ['Tab', 'Cycle modes'], ['← →  (J K)', 'Select previous / next memory'], ['Enter', 'Open memory detail panel'], ['I', 'Cycle memories with issues (opens details)'], ['X', 'Simulate a data burst (Shift+X: small)'], ['L', 'Toggle the terminal feed window'], ['Esc', 'Close panels'], ['Space', 'Freeze / unfreeze motion'], ['H', 'Toggle HUD'], ['V', 'Toggle voice line'], ['C', 'Cycle palette'], ['F', 'Fullscreen'], ['R', 'Force refresh'], ['W', 'Pulse: today / 7 days'], ['B / G', 'Back to the stats dashboard'], ['Mouse', 'Hover = inspect, click = select, wheel = zoom'], ['?', 'This overlay']];
export function toggleHelp(on) {
  S.helpOpen = on === undefined ? !S.helpOpen : on; const el = $('help'); el.hidden = !S.helpOpen; if (!S.helpOpen) return; el.textContent = '';
  const b = document.createElement('div'); b.className = 'box panel'; const h = document.createElement('h2'); h.textContent = 'TAU 3D // CONTROLS'; b.append(h); HELP.forEach(([k, v]) => b.append(kv(k, v))); el.append(b);
}
export function closePanels() { S.detailOpen = false; $('detail').hidden = true; toggleHelp(false); }

// late-bound for callers in earlier modules (see shared.ts H)
Object.assign(H, { announceChange, openDetail, renderLegend, rotateVoice, say, setLink, updateHud });
