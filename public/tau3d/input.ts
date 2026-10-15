import * as THREE from 'three';
import { S, saveSettings } from './shared.ts';
import { TAU, clamp } from './util.ts';
import { $, hudEls } from './dom.ts';
import { PALETTES } from './palettes.ts';
import { refresh } from './data.ts';
import { globalIssues, issuesChanged } from './issues.ts';
import { MODES, mouse, mw, shock, triggerReceive } from './state.ts';
import { camera, core, cv } from './scene.ts';
import { clockState, clockStripes } from './core.ts';
import { G, resize } from './post.ts';
import { closePanels, openDetail, renderLegend, say, showTip, toggleHelp, updateMemcard } from './hud.ts';
import { feedToggle } from './feed.ts';

/* ============================================================ input */
export function setMode(m: number) { S.mode = (m + 5) % 5; hudEls.mode.textContent = `${S.mode + 1} ${MODES[S.mode]}`; updateMemcard(); renderLegend(); say(['Core online.', 'Unravelling memory.', 'Mapping my sub-minds.', 'Listening to my own pulse.', 'The models that compose me.'][S.mode]); }
export function select(d: number) { if (!S.rings.length) return; S.sel = (S.sel + d + S.rings.length) % S.rings.length; updateMemcard(); if (S.detailOpen) openDetail(); }
export function cycleIssue() {
  (issuesChanged as () => void)(); const idx = S.rings.map((r, i) => (r.iss && r.iss.length ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) { const g = globalIssues(); say(g.length ? `Warning: ${g[0].msg}.` : 'No faults detected. Memory is intact.'); return; }
  const next = idx.find((i) => i > S.sel) ?? idx[0]; S.sel = next; updateMemcard(); openDetail();
  const r = S.rings[next], worst = r.iss.find((x) => x.severity === 'error') || r.iss[0]; say(worst.severity === 'error' ? `Memory ${next + 1} is fragmenting: ${worst.msg}.` : `Memory ${next + 1}: ${worst.msg}.`);
}
export const touch = () => { S.lastActivity = performance.now(); };
addEventListener('keydown', (e) => {
  touch(); if (e.metaKey || e.ctrlKey || e.altKey) return; const k = e.key;
  if (k >= '1' && k <= '5') setMode(+k - 1);
  else if (k === 'Tab') { e.preventDefault(); setMode(S.mode + (e.shiftKey ? -1 : 1)); }
  else if (k === 'ArrowRight' || k === 'k' || k === 'K') select(1);
  else if (k === 'ArrowLeft' || k === 'j' || k === 'J') select(-1);
  else if (k === 'Enter') openDetail();
  else if (k === 'i' || k === 'I') cycleIssue();
  else if (k === 'l' || k === 'L') (feedToggle as () => void)();
  else if (k === 'x' || k === 'X') triggerReceive(k === 'X' ? 0.2 : 1, {});
  else if (k === 'Escape') closePanels();
  else if (k === ' ') { e.preventDefault(); S.frozen = !S.frozen; }
  else if (k === 'h' || k === 'H') { S.hudOn = !S.hudOn; $('hud').classList.toggle('off', !S.hudOn); }
  else if (k === 'v' || k === 'V') { S.voiceOn = !S.voiceOn; $('voice').classList.toggle('off', !S.voiceOn); }
  else if (k === 'c' || k === 'C') { S.palIdx = (S.palIdx + 1) % PALETTES.length; hudEls.pal.textContent = PALETTES[S.palIdx].name; }
  else if (k === 'f' || k === 'F') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); }
  else if (k === 'r' || k === 'R') { shock(); refresh('manual'); }
  else if (k === 'w' || k === 'W') { if (S.mode === 3) { S.pulse7 = !S.pulse7; refresh('manual'); renderLegend(); } }
  else if (k === 'b' || k === 'B' || k === 'g' || k === 'G') { if (window.parent !== window) window.parent.postMessage({ type: 'tau3d:close' }, location.origin); else location.href = '/'; }
  
  else if (k === '?' || k === '/') (toggleHelp as () => void)();
  saveSettings();
});
// analytic "raycast": intersect the pointer ray with each ring's tilted plane, test radius/angle in ring space
export const ray = new THREE.Raycaster(), inv = new THREE.Matrix4();
export function ringAt(x: number, y: number): number {
  if (mw[0] + mw[1] < 0.5) return -1;
  ray.setFromCamera(new THREE.Vector2((x / G.W) * 2 - 1, -(y / G.H) * 2 + 1), camera); let best = -1, bd = 1e9; const margin = 0.006 / S.zoomCur;
  S.rings.forEach((r, i) => {
    if (!r.obj || r.alpha < 0.3) return; inv.copy(r.obj.matrixWorld).invert();
    const o = ray.ray.origin.clone().applyMatrix4(inv), d = ray.ray.direction.clone().transformDirection(inv); if (Math.abs(d.z) < 1e-6) return;
    const s = -o.z / d.z; const px = o.x + d.x * s, py = o.y + d.y * s; const rad = Math.hypot(px, py), dd = Math.abs(rad - r.r); if (dd > r.th * 0.5 + margin) return;
    const span = Math.min(r.span, TAU); if (span < TAU - 0.05) { const ang = Math.atan2(-py, px); if ((((ang - (r.a0 + r.rot * r.rotW)) % TAU) + TAU) % TAU > span) return; }
    if (dd < bd) { bd = dd; best = i; }
  });
  return best;
}
export function onMove(e: MouseEvent) {
  touch(); mouse.x = e.clientX; mouse.y = e.clientY; mouse.in = true; mouse.nx = (e.clientX / G.W - 0.5) * 2; mouse.ny = -(e.clientY / G.H - 0.5) * 2;
  S.hover = ringAt(e.clientX, e.clientY);
  const q = core.localToWorld(new THREE.Vector3(clockState.x, clockState.y, 0.004)).project(camera); const cx = (q.x * 0.5 + 0.5) * G.W, cy = (-q.y * 0.5 + 0.5) * G.H;
  S.clockHover = S.hover < 0 && Math.hypot(e.clientX - cx, e.clientY - cy) < 12; S.clockTipStr = S.clockHover ? clockState.str : '';
  if (S.hover < 0 && !S.clockHover) for (const st of clockStripes) { const p = core.localToWorld(new THREE.Vector3(st.x, st.y, 0)).project(camera); if (Math.hypot(e.clientX - (p.x * 0.5 + 0.5) * G.W, e.clientY - (-p.y * 0.5 + 0.5) * G.H) < 10) { S.clockHover = true; S.clockTipStr = st.str; break; } }
  cv.style.cursor = S.hover >= 0 ? 'pointer' : 'default'; showTip();
}
cv.addEventListener('mousemove', onMove);
cv.addEventListener('mouseleave', () => { mouse.in = false; S.hover = -1; S.clockHover = false; mouse.nx = mouse.ny = 0; showTip(); });
cv.addEventListener('click', (e) => { touch(); const i = ringAt(e.clientX, e.clientY); if (i >= 0) { S.sel = i; updateMemcard(); if (S.detailOpen) openDetail(); } });
cv.addEventListener('wheel', (e) => { touch(); e.preventDefault(); S.zoom = clamp(S.zoom * Math.exp(-e.deltaY * 0.001), 0.75, 1.4); }, { passive: false });
$('help').addEventListener('click', (e) => { if (e.target === $('help')) toggleHelp(false); });
addEventListener('resize', resize);
