import * as THREE from 'three';
import { CFG, H, S } from './shared.ts';
import { TAU, clamp, ease, fmtCost, fmtTok, hash, lerp, lin, mix, shortModel } from './util.ts';
import { setC } from './dom.ts';
import { PALETTES, PAL_KEYS, modelColor, pal, spectrumAt } from './palettes.ts';
import { clockHours, data } from './data.ts';
import { envE, envW, ghosts, motion, mouse, mw, recv, shocks, view } from './state.ts';
import { FOV_T, U, camera, core, frameG, frames, gauges, mats, neon, setSeg, sparks, world } from './scene.ts';
import { TRAIL, clockCore, minuteHand, clockDot, clockState, clockStripes, dialLine, glint, glintMat, hourCap, hourLine, hourMat, hourTicks, minuteTicks, plasmaMat, pupilMesh, rim, rimMat, shockMat, trailGeo, voidMesh } from './core.ts';
import { buildRingObj, killRingObj } from './ringmesh.ts';
import { MAXSA, NN, addLineMat, mdl, mdlNames, modelsG, nPulseGeo, needleGeo, neuralG, nodeNames, nodes, pulseG, pulseGuideMat, pulseState, saGeo, syncExtras, syncWeb } from './extras.ts';
import { G, finish } from './post.ts';
import type { MatsWithRune } from './extras.ts';
import type { ProjectionData } from '../../src/types.ts';

// mouse parallax smoothing fields (sx/sy) are written here; state.ts declares only the raw mouse position
type MouseSmooth = typeof mouse & { sx?: number; sy?: number };

/* ============================================================ per-frame update */
export const v3 = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
export const wl = (x: number, y: number, z = 0, obj: THREE.Object3D = core) => obj.localToWorld(new THREE.Vector3(x, y, z));
export const _c = new THREE.Color(), _o = new THREE.Object3D(), _v = new THREE.Vector3();

export function update(dt: number, adt: number) {
  const k = 1 - Math.exp(-dt / 0.22);
  for (let m = 0; m < 5; m++) mw[m] += ((m === S.mode ? 1 : 0) - mw[m]) * k;
  S.zoomCur += (S.zoom - S.zoomCur) * (1 - Math.exp(-dt / 0.15));
  S.hue = (S.hue + dt / Math.max(5, CFG.spectrumPeriod)) % 1; const P = PALETTES[S.palIdx].name === 'SPECTRUM' ? spectrumAt(S.hue) : PALETTES[S.palIdx], kp = 1 - Math.exp(-dt / 0.25);
  for (const key of PAL_KEYS) for (let i = 0; i < 3; i++) pal[key][i] += (P[key][i] - pal[key][i]) * kp;
  pal.grain += (P.grain - pal.grain) * kp;
  { const tb = S.palIdx === 1 ? [255, 255, 255] : S.palIdx === 2 ? [190, 255, 225] : [170, 238, 255]; for (let i = 0; i < 3; i++) beac[i] += (tb[i] - beac[i]) * kp; document.documentElement.style.setProperty('--bc', beac.map(Math.round).join(',')); }
  document.documentElement.style.setProperty('--f', pal.frame.map(Math.round).join(',')); document.documentElement.style.setProperty('--c', pal.core.map(Math.round).join(','));
  if (recv.on || view.ex > 0.001) { // advance the receiving envelope
    let e = 0, w = 0; if (recv.on) { if (!recv.frozen) recv.t += dt; const p = recv.t / recv.dur; if (p >= 1) { recv.on = false; } else { e = envE(p) * recv.peak; w = envW(p); } }
    if (recv.frozen) { const f = recv.phase; e = recv.peak * ease(clamp((f - 0.05) / 0.55, 0, 1)); w = ease(clamp(f * 1.4, 0, 1)); }
    view.ex += (e - view.ex) * (1 - Math.exp(-dt / (recv.frozen ? 0.01 : 0.18))); view.wg = w; if (!recv.on && view.ex < 0.002) view.ex = 0;
    recv.sk = recv.on && !recv.frozen ? clamp((recv.t / recv.dur - 0.62) / 0.38, 0, 1) : 0;
  } else view.wg = 0;
  recv.sparkle = Math.max(0, recv.sparkle - dt * 0.7);
  const exM = S.mode === 0 ? view.ex : 0;
  const cT = S.mode === 0 ? 1 + 0.2 * exM : S.mode === 1 ? 1 : 0.55, dT = S.mode === 0 ? 0.40 * (1 + 0.2 * exM) : S.mode === 1 ? 0.40 : 0.225;
  view.cs += (cT - view.cs) * k; view.dialR += (dT - view.dialR) * k; view.fiberA += ((S.mode === 0 ? 1 : S.mode === 1 ? 0.15 : 0.5) - view.fiberA) * k;
  const ak = 1 - Math.exp(-dt * (view.actT > view.act ? 1.6 : 0.25)); view.act += (view.actT - view.act) * ak;
  for (let i = 0; i < 3; i++) { view.g[i] += (view.gT[i] - view.g[i]) * (1 - Math.exp(-dt / 0.6)); view.tint[i] += ((view.tintT[i] || 0) - view.tint[i]) * kp; }
  const n = S.rings.length, cs = cT;
  const total = S.rings.reduce((a, r) => a + 0.5 + r.nl * 1.5, 0) || 1; const rIn = 0.10, rOut = 0.37, gap = 0.005; const avail = rOut - rIn - gap * Math.max(0, n - 1);
  const memGap = 0.004, memW = (i) => 0.25 + (n > 1 ? i / (n - 1) : 0), memSum = S.rings.reduce((a, _, i) => a + memW(i), 0) || 1, memAvail = 0.38 - 0.095 - memGap * Math.max(0, n - 1);
  let acc = rIn, memEdge = 0.095; // memory mode: inner rings thin and tight, outer rings taller bars with more room
  S.rings.forEach((r, i) => {
    const w = 0.5 + r.nl * 1.5, thc = (avail * w) / total; const rc = acc + thc / 2; acc += thc + gap;
    let tr, tth, ta0, tsp, tal, trw;
    if (S.mode === 1) { tth = memAvail * memW(i) / memSum; tr = memEdge + tth * 0.5; memEdge = tr + tth * 0.5 + memGap; ta0 = -Math.PI / 2 + i * 1.05; tsp = 0.9 + 1.7 * r.nl; tal = 0.95; trw = 0.03; }
    else { tr = rc * cs; tth = thc * cs; ta0 = 0; tsp = TAU; tal = S.mode === 0 ? 1 : 0.6; trw = 1; }
    r.r += (tr - r.r) * k; r.th += (tth - r.th) * k; r.a0 += (ta0 - r.a0) * k; r.span += (tsp - r.span) * k; r.alpha += (tal - r.alpha) * k; r.rotW += (trw - r.rotW) * k;
    const s = r.s; const rec = Math.exp(-(Date.now() - new Date(s.last).getTime()) / 21600000);
    r.speed = (0.04 + 0.22 * rec + (s.isActive ? 0.18 : 0)) * (1 + 2.2 * exM) * (1 - 0.55 * r.idleK); // idle = calm
    r.rot += r.dir * r.speed * adt * (1 - r.waitK) * (1 - 0.95 * S.freeze); // frozen while the link is down
    r.act += ((s.isActive ? 1 : 0) - r.act) * k;
    r.selK += ((i === S.sel ? 1 : 0) - r.selK) * (1 - Math.exp(-dt / 0.12)); r.hovK += ((i === S.hover ? 1 : 0) - r.hovK) * (1 - Math.exp(-dt / 0.1));
    r.idleK += ((r.s.live && r.s.live.status === 'idle' ? 1 : 0) - r.idleK) * k;
    r.waitK += ((r.wait && !r.wait.gone ? (r.wait.w.confidence === 'certain' ? 1 : 0.55) : 0) - r.waitK) * k;
    r.errK = (r.errK || 0) + ((r.sev === 2 ? 1 : 0) - (r.errK || 0)) * k; r.warnK = (r.warnK || 0) + ((r.sev === 1 ? 1 : 0) - (r.warnK || 0)) * k;
  });
  for (let i = ghosts.length - 1; i >= 0; i--) { const g = ghosts[i]; g.alpha -= dt * 1.2; g.rot += g.dir * 0.05 * adt; if (g.alpha <= 0.01) { killRingObj(g); ghosts.splice(i, 1); } }
  // camera: lissajous drift + mouse parallax + zoom
  const ms = mouse as MouseSmooth; ms.sx = (ms.sx || 0) + (mouse.nx - (ms.sx || 0)) * (1 - Math.exp(-dt / 0.35)); ms.sy = (ms.sy || 0) + (mouse.ny - (ms.sy || 0)) * (1 - Math.exp(-dt / 0.35));
  S.camX = Math.sin(S.T * 0.11) * 0.10 * motion * CFG.camDrift + ms.sx * 0.12; S.camY = Math.cos(S.T * 0.083) * 0.06 * motion * CFG.camDrift + ms.sy * 0.07;
  const aspect = G.W / G.H, needH = Math.max(1.8, 2.0 / aspect); G.camD = needH / 2 / FOV_T / S.zoomCur;
  camera.position.set(S.camX, S.camY, G.camD); camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
  G.pxu = G.H / (2 * G.camD * FOV_T); U.uPx.value = (G.H * G.dpr) / (2 * FOV_T);
  world.rotation.set(-S.camY * 0.5 - 0.02, S.camX * 0.45, Math.sin(S.T * 0.12) * 0.012 * (1 + 0.6 * (1 - clamp(mw[0], 0, 1)))); // eased with the mode weight so switching modes never jolts the triangle
  U.uTime.value = S.T;
}

export const beac = [170, 238, 255];
const stripeOff: number[] = new Array(12).fill(0.5); let stripeH = -1;
export function syncScene(now: number) {
  const act = Math.max(view.act, 0.8 * view.ex), cs = view.cs;
  S.flick = 0.93 + 0.05 * Math.sin(S.T * 23.1) * Math.sin(S.T * 7.3) + 0.03 * Math.sin(S.T * 3.1) - (Math.sin(S.T * 0.7) > 0.985 ? 0.25 : 0);
  { const ph = (S.T * 0.85) % 1; S.hb = Math.pow(Math.max(0, Math.sin(ph * Math.PI * 2 * 1.0)), 6) + 0.6 * Math.pow(Math.max(0, Math.sin(ph * Math.PI * 2 - 1.2)), 6); }
  const exv = view.ex; let triK = 1 - 0.93 * ease(clamp((exv - 0.12) / 0.55, 0, 1)); // triangle dissolves as the web densifies
  if (exv > 0.04 && exv < 0.96) triK *= 1 - 0.6 * clamp(exv * (1 - exv) * 4, 0, 1) * (hash(Math.floor(S.T * 24), 5) < 0.45 ? 1 : 0);
  const fk = S.flick * triK; frameG.visible = triK > 0.012;
  const F = pal.frame, Hh = pal.hot, tint = mix(view.tint, pal.core, 0.35);
  U.uFrame.value.fromArray(lin(F)); U.uCore.value.fromArray(lin(pal.core)); U.uHot.value.fromArray(lin(Hh)); U.uDim.value.fromArray(lin(pal.dim)); U.uTint.value.fromArray(lin(view.tint)); U.uAct.value = Math.min(act, 0.42); U.uBgBase.value.fromArray(pal.bgBase); U.uBgVein.value.fromArray(pal.bgVein); U.uGrain.value = pal.grain; finish.uniforms.uLift.value.set(...pal.lift);
  const dim = 1 - 0.2 * (1 - clamp(mw[0], 0, 1));
  setC(mats.tubeOut, neon(F, 2.2 * fk * dim)); setC(mats.tubeIn, neon(F, 1.7 * fk * dim)); setC(mats.white, lin(mix(F, [255, 200, 190], 0.6), 1.7 * fk));
  setC(mats.gaugeBase, lin(F, 0.8 * triK)); setC((mats as MatsWithRune).rune, lin(F, 1.5 * fk)); setC(mats.gaugeLit, lin(mix(F, Hh, 0.5), 3.2 * fk)); setC(mats.spark, lin([255, 225, 215], 1.6 * fk));
  setC(mats.tick, lin(F, 1.0 * fk)); mats.chev.forEach((m, kk) => setC(m, lin(F, (2.2 - kk * 0.5) * fk * (0.7 + 0.3 * Math.sin(S.T * 2 - kk * 0.8)))));
  setC(mats.dial, lin(pal.core, 0.5));
  // gauges
  const vi = frames[1].v, vo = frames[0].v;
  gauges.forEach((g, gi) => {
    const A = vi[g.a], B = vi[g.b]; const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, ml = Math.hypot(mx, my); const nx = -mx / ml, ny = -my / ml, off = 0.028;
    const P = (t) => v3(lerp(A.x, B.x, t) + nx * off, lerp(A.y, B.y, t) + ny * off, -0.045);
    const t0 = 0.07, t1 = 0.93, val = view.g[gi], f = clamp(val, 0, 1), te = lerp(t0, t1, f);
    setSeg(g.base_, P(t0), P(t1)); g.base_.scale.x = g.base_.scale.z = 0.0022;
    if (f > 0.002) { setSeg(g.lit, P(t0), P(te)); g.lit.scale.x = g.lit.scale.z = 0.0068; g.lit.visible = g.dot.visible = true; g.dot.position.copy(P(te)); g.dot.scale.setScalar(0.0105 + 0.0035 * Math.sin(S.T * 4 + gi)); } else g.lit.visible = g.dot.visible = false;
  });
  sparks.forEach((m, e) => { const A = vo[e], B = vo[(e + 1) % 3]; const t = (S.T * 0.05 + e / 3) % 1, t2 = Math.min(1, t + 0.05); setSeg(m, new THREE.Vector3().lerpVectors(A, B, t), new THREE.Vector3().lerpVectors(A, B, t2)); m.scale.x = m.scale.z = 0.006; m.position.z += 0.002; });
  // pupil / plasma
  const breath = Math.sin(S.T * 0.9) * 0.09 * CFG.breath * (1 - act * 0.4);
  const rp = 0.07 * (0.7 + 0.3 * cs) * (1 + breath + act * 0.14); view.pupil = rp;
  plasmaMat.uniforms.uR0.value = 0.46 * (0.55 + 0.45 * cs) * (1 + 0.025 * CFG.breath * Math.sin(S.T * 0.9)); plasmaMat.uniforms.uPupil.value = rp; plasmaMat.uniforms.uFiber.value = view.fiberA;
  pupilMesh.scale.setScalar(rp * 1.01); rim.scale.setScalar(rp * 1.04); glint.scale.setScalar(rp * 1.04);
  setC(rimMat, lin(mix(pal.core, tint, 0.3), (0.9 + 1.1 * Math.min(act, 0.42)) * S.flick)); setC(glintMat, lin(mix(pal.core, Hh, 0.3), 1.2)); voidMesh.scale.setScalar(rp * 2.1);
  // shock waves
  const nowS = performance.now() / 1000; const arr = shockMat.uniforms.uS.value;
  for (let i = shocks.length - 1; i >= 0; i--) if ((nowS - shocks[i]) / 2.4 > 1) shocks.splice(i, 1);
  for (let i = 0; i < 5; i++) arr[i] = i < shocks.length ? (nowS - shocks[i]) / 2.4 : 2; shockMat.uniforms.uPupil.value = rp;
  // hour ticks + clock
  const dR = view.dialR, nd = new Date(), curH = nd.getHours(); const fm = nd.getMinutes() + nd.getSeconds() / 60, fs = nd.getSeconds() + nd.getMilliseconds() / 1000; // minute position (0..60), seconds position (0..60)
  // analog hour hand: the current hour's stripe glides through its hour wedge, finished hours rest mid-wedge (eased when the hour rolls over)
  if (stripeH !== curH) { if (stripeH >= 0) stripeOff.unshift(stripeOff.pop() as number); stripeOff[0] = 0; stripeH = curH; }
  const ek = 1 - Math.exp(-Math.max(S.curAdt, 0.016) / 0.5); stripeOff.forEach((o, k) => { stripeOff[k] = o + ((k === 0 ? fm / 60 : 0.5) - o) * ek; });
  const ch = clockHours(); let mxh = 1; for (const c of ch) if (c.calls > mxh) mxh = c.calls; clockStripes.length = 0;
  setC(hourMat, lin(pal.core, 2.0 * S.flick)); const cH = lin(Hh, 3.2), cC = lin(pal.core, 2.0);
  ch.forEach((c, i) => {
    const th = Math.PI / 2 - ((c.pos + stripeOff[c.k]) / 12) * TAU, v = c.calls / mxh, cur = c.k === 0; let len = 0.01 + 0.04 * Math.sqrt(v); if (cur) { len = (0.045 + 0.04 * Math.sqrt(v)) * (1 + 0.05 * Math.sin(S.T * 4)); hourCap.position.set(Math.cos(th) * (dR + len + 0.004), Math.sin(th) * (dR + len + 0.004), 0.003); const la = hourLine.geometry.attributes.position.array, r0 = view.pupil * 1.5; la[0] = Math.cos(th) * r0; la[1] = Math.sin(th) * r0; la[3] = Math.cos(th) * dR; la[4] = Math.sin(th) * dR; hourLine.geometry.attributes.position.needsUpdate = true; }
    _o.position.set(Math.cos(th) * (dR + len / 2), Math.sin(th) * (dR + len / 2), 0); _o.rotation.set(0, 0, th - Math.PI / 2); _o.scale.set(cur ? 0.0075 : 0.0038, len, 0.005); _o.updateMatrix(); hourTicks.setMatrixAt(i, _o.matrix);
    const b = cur ? 1 : 0.28 + 0.72 * Math.pow(1 - c.k / 12, 1.5); // recent = brighter, fading toward 12h ago
    _c.setRGB((cur ? cH[0] / cC[0] : 1) * b, (cur ? cH[1] / cC[1] : 1) * b, (cur ? cH[2] / cC[2] : 1) * b); hourTicks.setColorAt(i, _c);
    clockStripes.push({ x: Math.cos(th) * (dR + len / 2), y: Math.sin(th) * (dR + len / 2), str: `${String(c.hour).padStart(2, '0')}:00–${String((c.hour + 1) % 24).padStart(2, '0')}:00 · ${Math.round(c.calls)} calls · ${fmtCost(c.cost)}` });
  });
  hourTicks.instanceMatrix.needsUpdate = true; hourTicks.instanceColor.needsUpdate = true;
  setC(hourCap.material, lin(Hh, 3.0)); setC(hourLine.material, lin(pal.core, 0.35)); minuteTicks.scale.setScalar(dR - 0.002 + 0.003 * CFG.breath * Math.sin(S.T * 0.9 - 0.9)); setC(mats.min, lin(pal.core, 0.9));
  dialLine.scale.setScalar(dR - 0.002);
  { const tm = Math.PI / 2 - (fm / 60) * TAU, mr = dR - 0.002 - 0.022; minuteHand.position.set(Math.cos(tm) * mr, Math.sin(tm) * mr, 0.002); minuteHand.rotation.set(0, 0, tm - Math.PI / 2); minuteHand.scale.set(0.0065, 0.044, 0.005); setC(minuteHand.material, lin(Hh, 4.2));
    const th = Math.PI / 2 - (fs / 60) * TAU, rr = dR - 0.002; clockState.x = Math.cos(th) * rr; clockState.y = Math.sin(th) * rr; clockState.str = String(curH).padStart(2, '0') + ':' + String(nd.getMinutes()).padStart(2, '0') + ':' + String(nd.getSeconds()).padStart(2, '0');
    const pa = trailGeo.attributes.position.array, ca = trailGeo.attributes.color.array, tc = lin(Hh, 1.5);
    for (let i = 0; i < TRAIL; i++) { const a = th + i * 0.02, f = Math.pow(1 - i / TRAIL, 1.6); pa[i * 3] = Math.cos(a) * rr; pa[i * 3 + 1] = Math.sin(a) * rr; pa[i * 3 + 2] = 0.002; ca[i * 3] = tc[0] * f; ca[i * 3 + 1] = tc[1] * f; ca[i * 3 + 2] = tc[2] * f; }
    trailGeo.attributes.position.needsUpdate = trailGeo.attributes.color.needsUpdate = true;
    clockDot.position.set(clockState.x, clockState.y, 0.004); clockCore.position.copy(clockDot.position); setC(clockDot.material, lin(Hh, 0.55)); setC(clockCore.material, lin([255, 245, 225], 1.6)); }
  // rings
  const nR = S.rings.length; let saN = 0; const sa = saGeo.attributes.position.array, sc = saGeo.attributes.aC.array; const s1 = ease(clamp(mw[1], 0, 1));
  const doRing = (r, i, ghost) => {
    const t = nR > 1 ? Math.min(1, i / (nR - 1)) : 0;
    r.rect = !ghost && t >= CFG.rectFrom; // outer memory rings: many small rectangular blocks instead of ovals
    if (!r.obj || r.objN !== r.nSeg || (!ghost && r.objRect !== r.rect)) buildRingObj(r);
    const u = r.obj.material.uniforms; const breathR = Math.sin(S.T * 0.9 - i * 0.3); // ring breathing, slight phase lag per ring
    let col = mix(mix(pal.core, Hh, 0.1 * (1 - t)), pal.dim, t * 0.7); col = mix(col, view.tint, 0.18 * (1 - t));
    const pulse = 0.5 + 0.5 * Math.sin(S.T * 3 + i * 0.9); let A = r.alpha * (0.88 - 0.38 * t) * S.flick;
    A *= (1 + r.act * (0.3 + 0.3 * pulse) + r.hovK * 0.5) * (1 - 0.28 * r.idleK) * (1 - 0.3 * S.sig * CFG.signalLoss);
    const selv = clamp(r.selK * 0.4 + r.hovK * 0.35, 0, 1);
    const span = Math.min(r.span, TAU);
    u.uColor.value.set(...lin(col, 0.9)); u.uAlpha.value = clamp(r.alpha, 0, 1); u.uInt.value = 0.7 * (0.55 + A * 0.7) + r.selK * 0.9; u.uSel.value = selv;
    u.uR.value = r.r * (1 + 0.012 * CFG.breath * breathR); u.uTh.value = Math.max(0.0045, r.th * (span > TAU - 0.05 ? (r.rect ? 0.85 : 1.25) : 1)) * (1 + r.selK * 0.35 + r.waitK * 0.4 + 0.06 * CFG.breath * breathR); u.uBlk.value = r.rect ? u.uTh.value * CFG.blockW : 0; u.uA0.value = r.a0; u.uSpan.value = span; u.uRot.value = r.rot * r.rotW; u.uK.value = span > TAU - 0.05 ? 1 : clamp(span / TAU, 0.22, 1);
    // issues: error = hard red + irregular glitch/blink, warn = slow amber-red pulse
    const ek = r.errK || 0, wk = r.warnK || 0;
    if (ek > 0.01) { const burst = hash(Math.floor(S.T * 0.9), r.seed * 0.01) > 0.62; const slot = Math.floor(S.T * (burst ? 19 : 2.6)); const h = hash(slot, r.seed * 0.01 + 3); u.uBlink.value = lerp(1, h < (burst ? 0.5 : 0.1) ? 0.1 : 1.35, ek); u.uDrop.value = burst ? 0.62 : 0.14; u.uJit.value = burst && h < 0.35 ? ek : 0; }
    else { u.uBlink.value = 1; u.uJit.value = 0; u.uDrop.value = 0; }
    u.uLoss.value = S.sig * CFG.signalLoss * (0.35 + 0.65 * S.jit); u.uWait.value = r.waitK; u.uBeacon.value.set(...lin(beac, 1)); if (r.waitK > 0.01) u.uInt.value *= 1 + 0.9 * S.hb * r.waitK;
    u.uErr.value = ek; u.uWarn.value = wk * (0.35 + 0.65 * (0.5 + 0.5 * Math.sin(S.T * 1.7 + i)));
    const o = r.obj, tk = r.rect ? 0 : 1; o.rotation.set(r.tilt[0] * (0.7 + 0.3 * Math.sin(S.T * 0.13 + r.tilt[2])) * (1 - 0.8 * s1) * tk, r.tilt[1] * (0.7 + 0.3 * Math.cos(S.T * 0.11 + r.tilt[2])) * (1 - 0.8 * s1) * tk, 0); // block rings stay flat and concentric o.position.z = r.rect ? 0 : s1 * (i * 0.014 - 0.1); o.updateMatrix();
    o.visible = r.alpha > 0.02;
    if (ghost) return;
    r.col = col; r.A = A;
    // sub-agent glow points
    const rr = r.r, nsa = Math.min(r.s.subagents || 0, 8); const sol = lin(mix(col, [255, 248, 235], 0.5), 2.2);
    for (let q = 0; q < nsa && saN < MAXSA; q++) {
      const ang = S.Td * (0.5 + 0.12 * q) * -r.dir + q * 2.4 + r.seed; const on = span > TAU - 0.1 || ((ang - (r.a0 + r.rot * r.rotW)) % TAU + TAU) % TAU < span * 1.0;
      if (!on && S.mode === 1) continue;
      _v.set(Math.cos(ang) * rr, -Math.sin(ang) * rr, 0).applyMatrix4(o.matrix); sa[saN * 3] = _v.x; sa[saN * 3 + 1] = _v.y; sa[saN * 3 + 2] = _v.z;
      const aa = Math.min(1, A) * r.alpha; sc[saN * 4] = sol[0]; sc[saN * 4 + 1] = sol[1]; sc[saN * 4 + 2] = sol[2]; sc[saN * 4 + 3] = aa; saN++;
    }
    // warning glyph
    if (r.sev > 0 && r.alpha > 0.3 && (mw[0] + mw[1]) > 0.4) {
      const ga = span > TAU - 0.05 ? hash(r.i, 5) * TAU : r.a0 + r.rot * r.rotW + span * 0.5, gr = rr + r.th * 0.5 + 0.022; _v.set(Math.cos(ga) * gr, -Math.sin(ga) * gr, 0).applyMatrix4(o.matrix);
      const blink = r.sev === 2 ? (u.uBlink.value > 0.5 ? 1 : 0.25) : 0.55 + 0.45 * Math.sin(S.T * 2.4 + i);
      H.label('⚠', core.localToWorld(_v.clone()), blink * (mw[0] + mw[1]) * r.alpha, r.sev === 2 ? [255, 50, 36] : [255, 170, 70], 1.35, { warn: true });
    }
  };
  for (const g of ghosts) doRing(g, nR, true);
  for (let i = 0; i < nR; i++) doRing(S.rings[i], i, false);
  saGeo.setDrawRange(0, saN); saGeo.attributes.position.needsUpdate = saGeo.attributes.aC.needsUpdate = true;
  // particles
  U.uPull.value = clamp(view.act * 0.9, 0, 1) * 0.9;
  // mode groups
  core.getWorldPosition(_v); sphereMats.forEach((m) => m.uniforms.uCorePos.value.copy(_v));
  syncExtras(view.ex * mw[0], triK); syncWeb(view.wg);
  syncNeural(ease(clamp(mw[2], 0, 1))); syncPulse(ease(clamp(mw[3], 0, 1))); syncModels(ease(clamp(mw[4], 0, 1)));
  // gauge + hour labels
  const s = data.summary, pj = ((s && s.projection) || {}) as Partial<ProjectionData>;
  const gtx = [
    s ? `TODAY ${fmtCost(pj.today ? pj.today.cost : 0)} / PACE ${fmtCost(pj.today && pj.today.pace ? pj.today.pace.cost : 0)}` : 'TODAY -',
    s ? `CACHE ${((s.totals.cacheHit || 0) * 100).toFixed(1)}%` : 'CACHE -',
    s ? `MONTH ${fmtCost(pj.monthToDate ? pj.monthToDate.cost : 0)} / PROJ ${fmtCost(pj.projectedMonth ? pj.projectedMonth.cost : 0)}` : 'MONTH -'];
  gauges.forEach((g, gi) => {
    const A = vi[g.a], B = vi[g.b]; const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, ml = Math.hypot(mx, my), nx = -mx / ml, ny = -my / ml, out = 0.085, val = view.g[gi];
    H.label(gtx[gi] + (val ? `  ${Math.round(val * 100)}%` : ''), wl(mx - nx * out, my - ny * out, 0, world), 0.9 * triK, mix(F, [255, 255, 255], 0.4), 1, { edge: [wl(A.x, A.y, 0, world), wl(B.x, B.y, 0, world)] });
  });
}
export const sphereMats = [...nodes.map((n) => n.mat), ...mdl.map((m) => m.mat)];

export function syncNeural(e: number) {
  neuralG.visible = e > 0.01; if (!neuralG.visible) return;
  const s = data.summary; const ents = s && s.perAgentType ? Object.entries(s.perAgentType).sort((a, b) => b[1].tokens - a[1].tokens).slice(0, NN) : [];
  const maxT = Math.max(1, ...ents.map((x) => x[1].tokens)), n = ents.length, rp = view.pupil;
  const pa = nPulseGeo.attributes.position.array, pc = nPulseGeo.attributes.aC.array; pc.fill(0);
  nodes.forEach((nd, i) => {
    const on = i < n; nd.mesh.visible = nd.halo.visible = nd.shell.visible = nd.link.visible = on; if (!on) return;
    const [name, v] = ents[i]; nodeNames[i] = name; const ang = -Math.PI / 2 + (i / n) * TAU + S.T * 0.035 + 0.3, orbit = (0.34 + 0.09 * (i % 2)) * e;
    const x = Math.cos(ang) * orbit, y = -Math.sin(ang) * orbit, z = (hash(i, 8) - 0.5) * 0.22 * e; const sz = (0.013 + 0.05 * Math.sqrt(v.tokens / maxT)) * e + 0.002;
    const col = mix(pal.core, mix(pal.dim, pal.hot, hash(i, 5)), 0.55);
    nd.mesh.position.set(x, y, z); nd.mesh.scale.setScalar(sz); nd.mat.uniforms.uCol.value.set(...lin(mix(col, [255, 255, 245], 0.15), 1.5)); nd.mat.uniforms.uA.value = e;
    const pulse = 1 + 0.12 * Math.sin(S.T * 2.5 + i); nd.halo.position.copy(nd.mesh.position); nd.halo.scale.setScalar(sz * 7 * pulse); setC(nd.halo.material, lin(col, 0.75 * e));
    nd.shell.position.copy(nd.mesh.position); nd.shell.scale.setScalar(sz); nd.shell.rotation.z = S.T * 0.6 + i; setC(nd.shell.material, lin(col, 3 * e));
    const sx = Math.cos(ang) * rp * 1.1, sy = -Math.sin(ang) * rp * 1.1, cx = (sx + x) / 2 - Math.sin(ang) * orbit * 0.18, cy = (sy + y) / 2 - Math.cos(ang) * orbit * 0.18; // control point
    const la = nd.link.geometry.attributes.position.array;
    for (let q = 0; q < 32; q++) { const t = q / 31, u = 1 - t; la[q * 3] = u * u * sx + 2 * u * t * cx + t * t * x; la[q * 3 + 1] = u * u * sy + 2 * u * t * cy + t * t * y; la[q * 3 + 2] = t * t * z; }
    nd.link.geometry.attributes.position.needsUpdate = true; setC(nd.link.material, lin(col, (0.55 + 0.25 * Math.sin(S.T * 2 + i)) * e * 1.4));
    const np = 1 + Math.min(3, Math.floor(Math.log10(1 + v.runs))); const pl = lin([255, 240, 220], 2.4);
    for (let p = 0; p < 4; p++) { const idx = i * 4 + p; if (p >= np) continue; const t = (S.T * (0.25 + 0.05 * i) + p / np + i * 0.17) % 1, u = 1 - t; pa[idx * 3] = u * u * sx + 2 * u * t * cx + t * t * x; pa[idx * 3 + 1] = u * u * sy + 2 * u * t * cy + t * t * y; pa[idx * 3 + 2] = t * t * z; pc[idx * 4] = pl[0]; pc[idx * 4 + 1] = pl[1]; pc[idx * 4 + 2] = pl[2]; pc[idx * 4 + 3] = e; }
    H.label(name.toUpperCase(), wl(x, y - sz * 1.9 - 0.04, z), 0.9 * e, [255, 235, 210], 1);
    H.label(`${v.runs} runs · ${fmtCost(v.cost)}`, wl(x, y - sz * 1.9 - 0.068, z), 0.6 * e, col, 0.88);
  });
  nPulseGeo.attributes.position.needsUpdate = nPulseGeo.attributes.aC.needsUpdate = true;
}

export function syncPulse(e: number) {
  pulseG.visible = e > 0.01; if (!pulseG.visible) return;
  const sr = S.pulse7 && data.series7 ? data.series7 : data.series; if (!sr || !sr.n) return;
  const key = sr; if (pulseState.key !== key) { // rebuild per-model geometry
    pulseState.items.forEach((it) => { pulseG.remove(it.spk, it.ln); it.spk.geometry.dispose(); it.ln.geometry.dispose(); it.spk.material.dispose(); it.ln.material.dispose(); }); pulseState.items = [];
    sr.models.forEach((m, kk) => {
      const N = sr.n; const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3)); const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      const spk = new THREE.LineSegments(sg, addLineMat()), ln = new THREE.Line(lg, addLineMat()); spk.frustumCulled = ln.frustumCulled = false; pulseG.add(spk, ln); pulseState.items.push({ spk, ln, kk });
    });
    pulseState.key = key; H.renderLegend();
    if (!pulseState.guideBuilt) { pulseState.guideBuilt = true; const pts = []; for (let i = 0; i < 24; i++) { const a = (i / 24) * TAU - Math.PI / 2; pts.push(v3(Math.cos(a) * 0.281, -Math.sin(a) * 0.281), v3(Math.cos(a) * (0.285 + 0.15 * 1.06), -Math.sin(a) * (0.285 + 0.15 * 1.06))); } pulseState.guides.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), pulseGuideMat)); pulseState.c = [0, 0.5, 1, -1].map((q) => { const l = pulseState.circ(1); pulseState.guides.add(l); return { l, q }; }); }
  }
  const base_ = 0.285, amp = 0.15 * e, N = sr.n; const span = Math.max(N, Math.round((S.pulse7 ? 7 * 864e5 : 864e5) / sr.bucketMs));
  setC(pulseGuideMat, lin(pal.core, 0.35 * e)); pulseState.c.forEach(({ l, q }) => l.scale.setScalar(q < 0 ? base_ : base_ + amp * q));
  pulseState.items.forEach(({ spk, ln, kk }) => {
    const arr = sr.vals[kk], col = modelColor(sr.models[kk]); const sp = spk.geometry.attributes.position.array, lp = ln.geometry.attributes.position.array, zo = kk * 0.008;
    for (let i = 0; i < N; i++) { const a = (i / span) * TAU - Math.PI / 2, v = Math.sqrt(arr[i] / sr.max), r1 = base_ + amp * (v < 0.004 ? 0 : v) * (1 + 0.04 * Math.sin(S.T * 6 + i * 1.7)); const c = Math.cos(a), s = -Math.sin(a), z = (v < 0.004 ? 0 : v) * amp * 0.5 + zo;
      sp[i * 6] = c * base_; sp[i * 6 + 1] = s * base_; sp[i * 6 + 2] = zo; sp[i * 6 + 3] = c * r1; sp[i * 6 + 4] = s * r1; sp[i * 6 + 5] = z; lp[i * 3] = c * r1; lp[i * 3 + 1] = s * r1; lp[i * 3 + 2] = z; }
    spk.geometry.attributes.position.needsUpdate = ln.geometry.attributes.position.needsUpdate = true;
    setC(spk.material, lin(col, 0.7 * e)); setC(ln.material, lin(col, 3.2 * e));
  });
  const fr = clamp((Date.now() - sr.t0) / (span * sr.bucketMs), 0, 1); const na = needleGeo.attributes.position.array, nc = needleGeo.attributes.color.array, hc = lin(pal.hot, 1);
  for (let q = 0; q < 30; q++) { const a = (fr - q * 0.0007) * TAU - Math.PI / 2, c = Math.cos(a), s = -Math.sin(a), f = (q === 0 ? 1.1 : 0.035 * (1 - q / 30)) * e; na.set([c * base_ * 0.9, s * base_ * 0.9, 0, c * (base_ + amp * 0.7), s * (base_ + amp * 0.7), 0], q * 6); nc.set([hc[0] * f, hc[1] * f, hc[2] * f, hc[0] * f, hc[1] * f, hc[2] * f], q * 6); }
  needleGeo.attributes.position.needsUpdate = needleGeo.attributes.color.needsUpdate = true;
  H.label(S.pulse7 ? '7 DAYS · W TOGGLES' : 'TODAY · W FOR 7D', wl(0, -(base_ - 0.06), 0), 0.55 * e, pal.core, 0.9);
}

export function syncModels(e: number) {
  modelsG.visible = e > 0.01; if (!modelsG.visible) return;
  const s = data.summary; const ms = s && s.perModel ? s.perModel.slice().sort((a, b) => b.total - a.total).slice(0, 8) : []; const n = ms.length;
  mdl.forEach((o, i) => {
    const on = i < n; o.mesh.visible = o.halo.visible = o.orbit.visible = on; if (!on) return; const m = ms[i];
    const orbit = (0.30 + 0.15 * (n > 1 ? i / (n - 1) : 0)) * e, ang = hash(i, 21) * TAU + S.T * 0.22 / Math.sqrt(orbit + 0.1) * (i % 2 ? -1 : 1);
    const share = m.costShare || 0, sz = (0.014 + 0.062 * Math.sqrt(share)) * e + 0.0015; mdlNames[i] = m.model; const x = Math.cos(ang) * orbit, y = -Math.sin(ang) * orbit, z = ((i % 3) - 1) * 0.05 * e, col = modelColor(m.model);
    o.mesh.position.set(x, y, z); o.mesh.scale.setScalar(sz); o.mat.uniforms.uCol.value.set(...lin(col, 1.15)); o.mat.uniforms.uA.value = e; o.mat.uniforms.uEm.value = 0.2;
    o.halo.position.copy(o.mesh.position); o.halo.scale.setScalar(sz * 6); setC(o.halo.material, lin(col, 0.5 * e));
    o.orbit.scale.setScalar(Math.max(0.001, orbit)); o.orbit.position.z = z * 0.0; setC(o.orbit.material, lin(col, 0.5 * e));
    H.label(shortModel(m.model).toUpperCase(), wl(x, y - sz - 0.04, z), 0.92 * e, [255, 235, 210], 1);
    H.label(`${fmtCost(m.cost)} · ${(share * 100).toFixed(0)}% · ${fmtTok(m.total)}`, wl(x, y - sz - 0.068, z), 0.6 * e, col, 0.88);
  });
}
