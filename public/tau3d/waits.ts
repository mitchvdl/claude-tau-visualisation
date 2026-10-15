import * as THREE from 'three';
import { H, S } from './shared.ts';
import { TAU, clamp, lin, trunc } from './util.ts';
import { $, hm, hudEls } from './dom.ts';
import { api, data, demo2 } from './data.ts';
import { U, camera, core, frameG, scene } from './scene.ts';
import { alive, mdl, mdlNames, nodeNames, nodes, pointFS, pointVS } from './extras.ts';
import { G } from './post.ts';
import { beac } from './update.ts';
import { say } from './hud.ts';
import type { SummaryResponse, WaitingRow } from '../../src/types.ts';

/* ============================================================ waiting for the user (beacon ring + callout) */
// entry per wait: { key, w, sid, aid, born, gone, slot, side, ring, anchor(world), scr, blk }
// one entry per (session, sub-agent) waiting for the user; gone = performance.now() when it stopped waiting (0 while live)
export interface WaitItem { key: string; w: WaitingRow; sid: string; aid: string | null; born: number; gone: number; slot?: number; side?: number; anchor: THREE.Vector3; scr: number[]; blk: null; k: number; id?: number }
// one callout block in the left/right margin (3 max) plus its leader-line path
export interface WaitUI { path: SVGPathElement; el: HTMLDivElement; h: HTMLDivElement; r: HTMLDivElement; b: HTMLDivElement; o: HTMLDivElement; key: string; last: string[]; full?: string; opts?: string[]; used?: boolean }
export const waits = new Map<string, WaitItem>(); export let waitSeq = 0;
export const waitIds = () => { const s = new Set<string>(); for (const e of waits.values()) if (!e.gone) s.add(e.sid); return s; };
export function demoWaits(): WaitingRow[] {
  const ss = data.sessions || []; if (ss.length < 9) return [];
  const iso = (secAgo: number) => new Date(Date.now() - secAgo * 1000).toISOString();
  return [
    { sessionId: ss[5].id, sessionTitle: ss[5].title, kind: 'question', confidence: 'certain', tool: 'AskUserQuestion', since: iso(192), agentId: null, agentType: null, agentDescription: null, sessionName: 'qa', waitingFor: 'question', title: 'Which ADR', text: 'Which ADR should I turn into a specification?',
      questions: [{ header: 'Which ADR', question: 'Which ADR should I turn into a specification?', multiSelect: false, options: ['ADR-027 membership soft delete', 'ADR-013 cryptographic erasure', 'ADR-028 passkey sign-in', 'Revisit ADR-036/037 spec'] }] },
    { sessionId: ss[8].id, sessionTitle: ss[8].title, kind: 'permission', confidence: 'maybe', tool: 'Bash', since: iso(75), agentId: 'demo-agent', agentType: 'coder', agentDescription: 'Implement the feature', title: 'Bash · npm test -- --watch', questions: [], text: 'Bash npm test -- --watch', waitingFor: null, sessionName: null },
  ];
}
export const fmtElapsed = (iso: string) => { const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)); return s < 90 ? s + 's' : s < 5400 ? Math.round(s / 60) + 'm' : Math.floor(s / 3600) + 'h' + String(Math.round((s % 3600) / 60)).padStart(2, '0') + 'm'; };
export function syncWaitData() {
  const list = demo2 ? demoWaits() : ((data.summary && data.summary.waiting) || []);
  list.sort((a, b) => Number(b.confidence === 'certain') - Number(a.confidence === 'certain') || (a.since < b.since ? 1 : -1));
  const seen = new Set<string>();
  for (const w of list) {
    const key = w.sessionId + '|' + (w.agentId || ''); seen.add(key); let e = waits.get(key);
    if (!e) { e = { key, w, sid: w.sessionId, aid: w.agentId || null, born: performance.now(), gone: 0, slot: 0, anchor: new THREE.Vector3(), scr: [0, 0], blk: null, k: 0 }; waits.set(key, e); e.id = ++waitSeq;
      const who = w.agentType || 'main'; if (performance.now() - S.lastAnnounce > 1500 || true) { say(`Session ${trunc(w.sessionTitle, 40)} needs you.`); S.lastAnnounce = performance.now(); }
      H.feedPush('w', `? ${hm(Date.now())} waiting · ${who} · ${trunc(w.text || w.title, 80)}`); }
    else { e.w = w; if (e.gone) { e.gone = 0; } }
  }
  for (const e of waits.values()) if (!seen.has(e.key) && !e.gone) { e.gone = performance.now(); say('Resolved.'); H.feedPush('w', `✓ resolved · ${e.w.agentType || 'main'} · ${trunc(e.w.sessionTitle, 40)}`); }
  for (const r of S.rings) { r.wait = null; for (const e of waits.values()) if (e.sid === r.id && (!r.wait || (!e.gone && r.wait.gone))) r.wait = e; }
  const n = list.length; hudEls.wait.textContent = String(n); hudEls.wait.classList.toggle('bad', n > 0);
}
export async function pollWaits() { if (document.hidden || demo2) return; try { const s = await api.get<SummaryResponse>('/api/summary'); if (data.summary) data.summary.waiting = s.waiting || []; syncWaitData(); } catch (e) { /* ignore */ } }
setInterval(pollWaits, 7000);

export const wsvg = $('wsvg'), wblk = $('wblk'); export const wUI: WaitUI[] = [0, 1, 2].map(() => {
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('fill', 'none'); wsvg.append(path);
  const el = document.createElement('div'); el.className = 'wb'; const h = document.createElement('div'), r = document.createElement('div'), b = document.createElement('div'), o = document.createElement('div'); h.className = 'wh'; r.className = 'wr'; b.className = 'wt'; o.className = 'wo'; el.append(h, r, b, o); wblk.append(el);
  return { path, el, h, r, b, o, key: '', last: [] };
});
export const wmore = document.createElement('div'); wmore.className = 'wb wmore'; wblk.append(wmore);
export const _wv = new THREE.Vector3();
export function waitAnchor(e: WaitItem) { // world position the leader line points at
  const w = e.w, ring = S.rings.find((r) => r.id === e.sid); const side = e.side;
  if (S.mode === 2) { const ty = w.agentType || 'main', i = nodeNames.indexOf(ty); if (i >= 0) return core.localToWorld(e.anchor.copy(nodes[i].mesh.position)); }
  else if (S.mode === 4) { const sess = (data.sessions || []).find((x) => x.id === e.sid); const mi = sess && sess.models ? mdlNames.indexOf(sess.models[0]) : -1; if (mi >= 0) return core.localToWorld(e.anchor.copy(mdl[mi].mesh.position)); }
  if ((S.mode === 0 || S.mode === 1) && ring && ring.obj) {
    const o = ring.obj, span = Math.min(ring.span, TAU); let ang: number, rr = ring.r;
    if (w.agentId && (ring.s.subagents || 0) > 0) { const nsa = Math.min(ring.s.subagents, 8); let hsh = 0; for (const ch of w.agentId) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0; const q = hsh % nsa; ang = S.T * (0.5 + 0.12 * q) * -ring.dir + q * 2.4 + ring.seed; }
    else ang = span < TAU - 0.05 ? ring.a0 + ring.rot * ring.rotW + span * 0.5 : (side > 0 ? -0.2 : Math.PI + 0.2) + (e.slot % 2 ? 0.25 : -0.1);
    _wv.set(Math.cos(ang) * rr, -Math.sin(ang) * rr, 0).applyMatrix4(o.matrix); return core.localToWorld(e.anchor.copy(_wv));
  }
  return core.localToWorld(e.anchor.set(0, 0, 0));
}
export const waitPG = new THREE.BufferGeometry(); waitPG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 3), 3)); waitPG.setAttribute('aC', new THREE.BufferAttribute(new Float32Array(3 * 4), 4)); waitPG.setDrawRange(0, 0);
export const waitPts = new THREE.Points(waitPG, new THREE.ShaderMaterial({ uniforms: { ...U, uSize: { value: 0.05 } }, vertexShader: pointVS, fragmentShader: pointFS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); waitPts.frustumCulled = false; waitPts.renderOrder = 9; scene.add(waitPts);
export function syncWaits() {
  const W = G.W, H = G.H, now = performance.now(); const ents = [...waits.values()].sort((a, b) => a.id - b.id); let shown = 0, more = 0; const col = `rgb(${beac.map(Math.round).join(',')})`;
  // margins outside the triangle
  const pr = (x: number, y: number) => { _wv.set(x, y, 0); frameG.localToWorld(_wv); _wv.project(camera); return (_wv.x * 0.5 + 0.5) * W; };
  const xl = pr(-1.0, 0.5), xr_ = pr(1.0, 0.5); const bw = clamp(Math.min(xl, W - xr_) - 26, 150, 270);
  let yR = H * 0.17, yL = H * 0.17; const wpA = waitPG.attributes.position.array, wpC = waitPG.attributes.aC.array; let np = 0; const hbp = 0.55 + 0.45 * Math.min(1, S.hb);
  ents.forEach((e) => {
    const alive = !e.gone, p = alive ? clamp((now - e.born) / 700, 0, 1) : clamp(1 - (now - e.gone) / 500, 0, 1);
    if (!alive && p <= 0) { waits.delete(e.key); const r = S.rings.find((q) => q.id === e.sid); if (r && r.wait === e) r.wait = null; return; }
    if (shown >= 3) { if (alive) more++; return; }
    const ui = wUI[shown]; e.slot = shown; e.side = shown % 2 === 0 ? 1 : -1; const w = e.w, maybe = w.confidence !== 'certain';
    waitAnchor(e); const v = _wv.copy(e.anchor).project(camera); const ax = (v.x * 0.5 + 0.5) * W, ay = (-v.y * 0.5 + 0.5) * H;
    // content (rebuilt only when it changes)
    const ck = e.key + '|' + w.title + '|' + w.text + (w.questions ? w.questions.length : 0); const who = w.agentType || 'main';
    if (ui.key !== ck) {
      ui.key = ck; ui.b.textContent = ''; ui.o.textContent = '';
      ui.full = w.kind === 'plan' ? w.text : maybe ? '(possibly waiting)' : (w.text || (w.questions[0] && w.questions[0].question) || '');
      ui.opts = w.kind === 'question' && w.questions[0] ? w.questions[0].options.map((o) => (w.questions[0].multiSelect ? '□ ' : '○ ') + o) : [];
      if (w.kind === 'question' && w.questions.length > 1) ui.opts.push(`(+${w.questions.length - 1} more question${w.questions.length > 2 ? 's' : ''})`);
      ui.b.className = 'wt' + (maybe ? ' dim' : '');
    }
    ui.h.textContent = `${w.kind === 'plan' ? 'PLAN APPROVAL' : maybe ? 'PERMISSION?' : 'AWAITING INPUT'} · ${fmtElapsed(w.since)} · ${w.kind === 'plan' || maybe ? trunc(w.title, 34) : (w.sessionName || trunc(w.sessionTitle, 30))}${w.kind === 'plan' || maybe ? '' : ' · ' + who}${maybe ? ' · ' + who : ''}`; const rl = !maybe && w.waitingFor ? w.waitingFor : ''; if (ui.last[2] !== rl) { ui.r.textContent = rl; ui.r.style.display = rl ? '' : 'none'; ui.last[2] = rl; }
    const tb = alive ? clamp((now - e.born - 650) / 1000, 0, 1e3) : 1e3, nch = Math.floor(tb * 140); const bTxt = ui.full.slice(0, nch); if (ui.last[0] !== bTxt) { ui.b.textContent = bTxt; ui.last[0] = bTxt; }
    let rem = Math.max(0, nch - ui.full.length), oTxt = ''; for (const o of ui.opts) { if (rem <= 0) break; oTxt += o.slice(0, rem) + '\n'; rem -= o.length; } if (ui.last[1] !== oTxt) { ui.o.textContent = oTxt.trimEnd(); ui.last[1] = oTxt; }
    // layout: leader line = diagonal from the ring marker, then horizontal into the block
    const right = e.side > 0, bx = right ? W - bw - 22 : 22, by = right ? yR : yL; ui.el.style.width = bw + 'px';
    const vis = p > 0.55; ui.el.style.opacity = String(vis ? (maybe ? 0.78 : 1) * clamp((p - 0.55) / 0.45, 0, 1) : 0); ui.el.style.transform = `translate(${bx}px,${by}px)`; ui.el.style.color = col; ui.el.style.borderColor = col;
    const hH = ui.el.offsetHeight || 90; if (right) yR += hH + 18; else yL += hH + 18;
    const ex = right ? bx - 4 : bx + bw + 4, ey = by + 11, kx = ex + (right ? -34 : 34); const d = `M${ax.toFixed(1)} ${ay.toFixed(1)} L${kx.toFixed(1)} ${ey.toFixed(1)} L${ex.toFixed(1)} ${ey.toFixed(1)}`;
    const len = Math.hypot(kx - ax, ey - ay) + Math.abs(ex - kx);
    ui.path.setAttribute('d', d); ui.path.style.stroke = col; ui.path.style.strokeWidth = maybe ? '1' : '1.4'; ui.path.style.filter = `drop-shadow(0 0 4px ${col})`; ui.path.style.opacity = String(maybe ? 0.7 : 0.95);
    ui.path.style.strokeDasharray = maybe ? `5 4` : `${len} ${len}`; ui.path.style.strokeDashoffset = String(maybe ? 0 : len * (1 - clamp(p, 0, 1))); if (maybe) ui.path.style.opacity = String(0.7 * p);
    // marker node on the ring
    if (np < 3) { wpA[np * 3] = e.anchor.x; wpA[np * 3 + 1] = e.anchor.y; wpA[np * 3 + 2] = e.anchor.z; const b = (maybe ? 1.4 : 2.6) * hbp * p; const bl = lin(beac, 1); wpC[np * 4] = bl[0] * b; wpC[np * 4 + 1] = bl[1] * b; wpC[np * 4 + 2] = bl[2] * b; wpC[np * 4 + 3] = 1; np++; }
    ui.used = true; shown++;
  });
  for (let i = shown; i < 3; i++) { wUI[i].el.style.opacity = '0'; wUI[i].path.style.opacity = '0'; wUI[i].key = ''; }
  wmore.style.opacity = String(more ? 0.9 : 0); if (more) { wmore.textContent = `+${more} more waiting`; wmore.style.color = col; wmore.style.borderColor = col; wmore.style.transform = `translate(${W - bw - 22}px,${Math.max(yR, H * 0.17)}px)`; wmore.style.width = bw + 'px'; }
  waitPG.setDrawRange(0, np); waitPG.attributes.position.needsUpdate = waitPG.attributes.aC.needsUpdate = true;
}

// late-bound for callers in earlier modules (see shared.ts H)
Object.assign(H, { syncWaitData, waitIds });
