import { CFG, bumpActivity } from './shared.ts';
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
    const isNew = !t, young = performance.now() > 6000; // ignore the agents that already exist when the page loads
    if (!t) { t = { key, type: '', model: '', desc: '', prompt: '', seen: '', text: '', active: false, startedAt: Date.parse(a.first || '') || now, doneAt: 0, rev: 0 }; tracks.set(key, t); }
    if (t.active && !a.isActive) t.doneAt = now; else if (a.isActive) t.doneAt = 0;
    if (young && a.isActive && (isNew || !t.active)) bumpActivity(0.35); // a new agent spawned
    t.active = !!a.isActive; t.type = a.type || 'agent'; t.model = shortModel((a.models || [])[0]); t.desc = a.description || ''; t.prompt = a.prompt || t.prompt;
    appendTail(t, a.tail || '');
  }
}

// every active agent (plus recently finished ones), newest first; the first becomes the big box, the next few small boxes
function visibleTracks(): Track[] {
  const now = Date.now(), list: Track[] = [];
  for (const t of tracks.values()) if (t.active || (t.doneAt && now - t.doneAt < LINGER_MS)) list.push(t);
  return list.sort((a, b) => (Number(b.active) - Number(a.active)) || (b.startedAt - a.startedAt));
}
function paintHead(t: Track) { head.textContent = `${t.type}${t.model ? ' · ' + t.model : ''}`; desc.textContent = t.desc; }

interface Small { el: HTMLElement; h: HTMLElement; d: HTMLElement; s: HTMLElement; l: HTMLElement; rev: number }
const stack = $('agentstack'), smalls = new Map<string, Small>(); let sig = '';
const lastLine = (t: Track): string => { const ls = t.text.split('\n').filter((x) => x.trim()); return ls.length ? ls[ls.length - 1] : t.prompt ? '> ' + t.prompt.replace(/\s+/g, ' ') : ''; };
function mkSmall(): Small {
  const el = document.createElement('div'), row = document.createElement('div'), h = document.createElement('b'), d = document.createElement('i'), s = document.createElement('span'), l = document.createElement('div');
  el.className = 'abs'; row.className = 'sh'; s.className = 'ss'; l.className = 'sl'; row.append(h, d, s); el.append(row, l); return { el, h, d, s, l, rev: -1 };
}
function syncSmalls(list: Track[]) {
  const want = list.slice(0, Math.max(0, Math.round(CFG.agentStack) - 1)); const keys = want.map((t) => t.key);
  for (const [k, sm] of smalls) if (!keys.includes(k)) { smalls.delete(k); sm.el.classList.remove('on'); setTimeout(() => sm.el.remove(), 1400); }
  want.forEach((t) => {
    let sm = smalls.get(t.key); if (!sm) { sm = mkSmall(); smalls.set(t.key, sm); stack.append(sm.el); requestAnimationFrame(() => sm && sm.el.classList.add('on')); }
    sm.h.textContent = `${t.type}${t.model ? ' · ' + t.model : ''}`; sm.d.textContent = t.desc; sm.s.textContent = t.active ? '●' : '✓'; sm.s.classList.toggle('done', !t.active); sm.el.style.setProperty('--ab', String(CFG.agentOpacity));
    if (sm.rev !== t.rev) { sm.l.textContent = lastLine(t); sm.rev = t.rev; }
  });
  const nsig = keys.join('|'); if (nsig !== sig) { sig = nsig; want.forEach((t) => { const sm = smalls.get(t.key); if (sm) stack.append(sm.el); }); } // column-reverse: later children sit higher
}
function frame(ms: number) {
  requestAnimationFrame(frame);
  if (document.hidden) { lastT = 0; return; }
  const dt = lastT ? Math.min(0.1, (ms - lastT) / 1000) : 0.016; lastT = ms;
  const list = CFG.agentBox ? visibleTracks() : [], next = list[0] || null;
  if (next !== focus) { focus = next; shownRev = -1; typed = 0; inn.textContent = ''; prm.textContent = ''; if (focus) { paintHead(focus); out.scrollTop = 0; } }
  syncSmalls(list.slice(1));
  box.classList.toggle('on', !!focus); box.style.setProperty('--ab', String(CFG.agentOpacity)); out.hidden = !CFG.agentOut;
  if (!focus) return;
  stat.textContent = focus.active ? '● active' : '✓ done'; stat.classList.toggle('done', !focus.active); paintHead(focus);
  if (typed < focus.prompt.length) { typed = Math.min(focus.prompt.length, typed + dt * 140); prm.textContent = '> ' + focus.prompt.slice(0, Math.floor(typed)).replace(/\s+/g, ' '); }
  if (focus.rev !== shownRev) { inn.style.paddingTop = Math.round(out.clientHeight * 0.5) + 'px'; inn.textContent = focus.text; shownRev = focus.rev; }
  if (CFG.agentOut) { const target = out.scrollHeight - out.clientHeight; if (out.scrollTop < target) out.scrollTop = Math.min(target, out.scrollTop + dt * 18 * CFG.agentSpeed); }
}
requestAnimationFrame(frame);

if (params.get('demo') === 'agent' || params.get('demo') === 'agents') stack.dataset.demo = '1'; // fake demo text is not private, so privacy mode leaves it readable
if (params.get('demo') === 'agent') { // ?demo=agent: a fake agent that "streams" text, for screenshots
  const t: Track = { key: 'demo', type: 'coder', model: 'sonnet-5-5', desc: 'Implement the BFF pass', prompt: 'You are the coder for pass 5. Read the brief in full first, then implement the handler, the actions, the events and the migration. Keep the tests green and report back with a short summary of what changed.', seen: '', text: '', active: true, startedAt: Date.now(), doneAt: 0, rev: 0 };
  tracks.set('demo', t);
  const lines = ['Reading the brief and the existing handler.', 'Now patch the remaining parts: lengths, item flags, description IDs.', 'Adding MigrationContractTest and OpenApiTest.', 'The foreign write-back needs a transaction; wrapping it.', 'Running the focused test suite.', 'Two failures in ApiTestCase, fixing the fixture ids.', 'All green. Writing the summary.'];
  for (let k = 0; k < 6; k++) t.text += (t.text ? '\n' : '') + lines[k % lines.length]; t.rev++;
  let i = 0; setInterval(() => { t.text += (t.text ? '\n' : '') + lines[i % lines.length] + ' ' + lines[(i + 3) % lines.length]; t.rev++; i++; }, 900);
}

if (params.get('demo') === 'agents') { // ?demo=agents: four fake agents, one big box and three small ones
  const mk = (key: string, type: string, model: string, desc: string, age: number, prompt: string, lines: string[]): Track => { const t: Track = { key, type, model, desc, prompt, seen: '', text: lines.join('\n'), active: true, startedAt: Date.now() - age * 1000, doneAt: 0, rev: 1 }; tracks.set(key, t); return t; };
  mk('d1', 'coder', 'sonnet-5-5', 'Implement the BFF pass', 5, 'You are the coder for pass 5. Read the brief in full first, then implement the handler, the actions, the events and the migration.', ['Reading the brief and the existing handler.', 'Now patch the remaining parts: lengths, item flags, description IDs.', 'Adding MigrationContractTest and OpenApiTest.', 'Running the focused test suite.']);
  mk('d2', 'qa', 'opus-5-5', 'QA pass 4 against the spec', 30, 'Review the pass 4 changes against the acceptance criteria.', ['Checked the OpenAPI diff, two endpoints missing examples.', 'Verifying the migration is reversible.']);
  mk('d3', 'general-purpose', 'sonnet-5-5', '/code-review medium', 70, 'Review the staged diff for correctness issues.', ['Scanning the diff for null handling regressions.', 'No blocking issues in the handler; one nit in the mapper.']);
  mk('d4', 'explore', 'haiku-5-5', 'Find usages of the legacy transport', 110, 'Search the repo for callers of the legacy transport client.', ['Found 14 call sites across 6 modules.']);
}
