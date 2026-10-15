import { CFG } from './shared.ts';
import { $, params } from './dom.ts';
import { shortModel } from './util.ts';
import type { SessionDetail, SessionSummary } from '../../src/types.ts';

/* ============================================================ agent box (bottom-right): newest sub-agent's prompt + its output text drifting upward, faded */
interface Track { key: string; type: string; model: string; desc: string; prompt: string; seen: string; text: string; active: boolean; startedAt: number; doneAt: number; rev: number }
const tracks = new Map<string, Track>();
const LINGER_MS = 25000;
const box = $('agentbox'), head = $('abHead'), stat = $('abStat'), desc = $('abDesc'), prm = $('abPrompt'), out = $('abOut'), inn = $('abIn');
let focus: Track | null = null, shownRev = -1, typed = 0, lastT = 0;

// the server sends a rolling tail of the agent's text; append only what we have not shown yet
function appendTail(t: Track, tail: string) {
  if (!tail || tail === t.seen) return;
  let fresh = tail;
  if (t.seen) { const probe = t.seen.slice(-60), i = tail.lastIndexOf(probe); if (i >= 0) fresh = tail.slice(i + probe.length); }
  if (fresh.trim()) { t.text = (t.text ? t.text + '\n' : '') + fresh.trim(); if (t.text.length > 6000) t.text = t.text.slice(-6000); t.rev++; }
  t.seen = tail;
}
export function agentIngest(s: SessionSummary, d: SessionDetail) {
  const now = Date.now();
  for (const a of d.agents || []) {
    const key = s.id + ':' + a.id; let t = tracks.get(key);
    if (!t) { t = { key, type: '', model: '', desc: '', prompt: '', seen: '', text: '', active: false, startedAt: Date.parse(a.first || '') || now, doneAt: 0, rev: 0 }; tracks.set(key, t); }
    if (t.active && !a.isActive) t.doneAt = now; else if (a.isActive) t.doneAt = 0;
    t.active = !!a.isActive; t.type = a.type || 'agent'; t.model = shortModel((a.models || [])[0]); t.desc = a.description || ''; t.prompt = a.prompt || t.prompt;
    appendTail(t, a.tail || '');
  }
}

function pick(): Track | null {
  const now = Date.now(); let best: Track | null = null;
  for (const t of tracks.values()) if (t.active && (!best || t.startedAt > best.startedAt)) best = t;
  if (best) return best;
  if (focus && focus.doneAt && now - focus.doneAt < LINGER_MS) return focus; // keep the finished agent on screen for a while
  return null;
}
function paintHead(t: Track) { head.textContent = `${t.type}${t.model ? ' · ' + t.model : ''}`; desc.textContent = t.desc; }
function frame(ms: number) {
  requestAnimationFrame(frame);
  if (document.hidden) { lastT = 0; return; }
  const dt = lastT ? Math.min(0.1, (ms - lastT) / 1000) : 0.016; lastT = ms;
  const next = CFG.agentBox ? pick() : null;
  if (next !== focus) { focus = next; shownRev = -1; typed = 0; inn.textContent = ''; prm.textContent = ''; if (focus) { paintHead(focus); out.scrollTop = 0; } }
  box.classList.toggle('on', !!focus); box.style.setProperty('--ab', String(CFG.agentOpacity)); out.hidden = !CFG.agentOut;
  if (!focus) return;
  stat.textContent = focus.active ? '● active' : '✓ done'; stat.classList.toggle('done', !focus.active); paintHead(focus);
  if (typed < focus.prompt.length) { typed = Math.min(focus.prompt.length, typed + dt * 140); prm.textContent = '> ' + focus.prompt.slice(0, Math.floor(typed)).replace(/\s+/g, ' '); }
  if (focus.rev !== shownRev) { inn.style.paddingTop = Math.round(out.clientHeight * 0.5) + 'px'; inn.textContent = focus.text; shownRev = focus.rev; }
  if (CFG.agentOut) { const target = out.scrollHeight - out.clientHeight; if (out.scrollTop < target) out.scrollTop = Math.min(target, out.scrollTop + dt * 18 * CFG.agentSpeed); }
}
requestAnimationFrame(frame);

if (params.get('demo') === 'agent') { // ?demo=agent: a fake agent that "streams" text, for screenshots
  const t: Track = { key: 'demo', type: 'coder', model: 'sonnet-5-5', desc: 'Implement the BFF pass', prompt: 'You are the coder for pass 5. Read the brief in full first, then implement the handler, the actions, the events and the migration. Keep the tests green and report back with a short summary of what changed.', seen: '', text: '', active: true, startedAt: Date.now(), doneAt: 0, rev: 0 };
  tracks.set('demo', t);
  const lines = ['Reading the brief and the existing handler.', 'Now patch the remaining parts: lengths, item flags, description IDs.', 'Adding MigrationContractTest and OpenApiTest.', 'The foreign write-back needs a transaction; wrapping it.', 'Running the focused test suite.', 'Two failures in ApiTestCase, fixing the fixture ids.', 'All green. Writing the summary.'];
  for (let k = 0; k < 6; k++) t.text += (t.text ? '\n' : '') + lines[k % lines.length]; t.rev++;
  let i = 0; setInterval(() => { t.text += (t.text ? '\n' : '') + lines[i % lines.length] + ' ' + lines[(i + 3) % lines.length]; t.rev++; i++; }, 900);
}
