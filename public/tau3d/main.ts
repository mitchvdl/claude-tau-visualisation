import { S } from './shared.ts';
import { clamp } from './util.ts';
import { hudEls, params } from './dom.ts';
import { PALETTES, pal, palIndexOf } from './palettes.ts';
import { connectEvents, refresh } from './data.ts';
import { issuesChanged } from './issues.ts';
import { DTMAX, MODES, motion, recv, reduced, triggerReceive, view } from './state.ts';
import { scene } from './scene.ts';
import { genBurst } from './extras.ts';
import { BLOOM, bloom, composer, finish, resize } from './post.ts';
import { syncScene, update } from './update.ts';
import { flushLabels } from './labels.ts';
import { renderLegend, say, toggleHelp, updateMemcard } from './hud.ts';
import { syncWaitData, syncWaits } from './waits.ts';

// side-effect imports run the setup of each module in dependency order
import './util.ts';
import './dom.ts';
import './palettes.ts';
import './data.ts';
import './issues.ts';
import './state.ts';
import './scene.ts';
import './core.ts';
import './ringmesh.ts';
import './extras.ts';
import './post.ts';
import './update.ts';
import './labels.ts';
import './hud.ts';
import './waits.ts';
import './feed.ts';
import './input.ts';

/* ============================================================ main loop */
export let last = 0, lastRender = 0, idle = false;
export function frame(ms: number) {
  requestAnimationFrame(frame);
  if (document.hidden) { last = 0; return; }
  idle = (performance.now() - S.lastActivity > 90000 && view.act < 0.08);
  const fps = reduced || idle ? 30 : 60; if (ms - lastRender < 1000 / fps - 3) return; lastRender = ms;
  const now = ms / 1000; const dt = last ? Math.min(DTMAX, now - last) : 0.016; last = now;
  const adt = S.frozen ? 0 : dt * motion; S.T += adt;
  S.curAdt = adt; update(dt, adt); syncScene(now);
  bloom.strength += ((BLOOM.base * (reduced || idle ? 0.6 : 1) * (0.92 + 0.25 * view.act) * (1 + 0.4 * view.ex)) - bloom.strength) * 0.1; bloom.radius = BLOOM.radius; bloom.threshold = BLOOM.thr;
  finish.uniforms.uTime.value = S.T;
  scene.updateMatrixWorld(); flushLabels(); syncWaits();
  composer.render(dt);
}
document.addEventListener('visibilitychange', () => { last = 0; });
setInterval(() => (issuesChanged as () => void)(), 4000);

resize(); hudEls.mode.textContent = `${S.mode + 1} ${MODES[S.mode]}`;
if (params.has('pal')) { S.palIdx = palIndexOf(params.get('pal')); hudEls.pal.textContent = PALETTES[S.palIdx].name; Object.assign(pal, JSON.parse(JSON.stringify(PALETTES[S.palIdx]))); }
if (params.get('sel')) S.sel = +params.get('sel') || 0;
if (params.get('help') === '1') toggleHelp(true);
if (params.has('phase')) { recv.frozen = recv.on = true; recv.amp = 1; recv.peak = 1; recv.dur = 9; recv.phase = clamp(+params.get('phase') || 0, 0, 1); genBurst({}); }
else if (params.get('demo') === 'receive') setTimeout(() => triggerReceive(1, {}), 2500);
if (params.has('zoom')) S.zoom = S.zoomCur = +params.get('zoom') || 1;
say('Waking...');
requestAnimationFrame(frame);
refresh('init').then(() => { syncWaitData(); if (params.get('sel')) S.sel = clamp(+params.get('sel') || 0, 0, Math.max(0, S.rings.length - 1)); updateMemcard(); renderLegend(); (issuesChanged as () => void)(); });
if (params.get('nosse') !== '1') connectEvents();
setInterval(() => { if (!document.hidden) refresh('poll'); }, Math.max(15000, S.refreshMs * 6));
setInterval(() => { if (S.mode === 1 && S.rings[S.sel]) updateMemcard(); }, 30000);
