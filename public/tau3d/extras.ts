import * as THREE from 'three';
import { H, S } from './shared.ts';
import { TAU, clamp, ease, hash, lerp, lin, mix } from './util.ts';
import { params, setC } from './dom.ts';
import { pal } from './palettes.ts';
import { data } from './data.ts';
import { mulberry32, recv, sessAnchor } from './state.ts';
import { U, VA, core, frameG, hdr, mats, world } from './scene.ts';
import { spriteMat } from './core.ts';
import { buildRingObj } from './ringmesh.ts';
import type { RingMesh, RingRec } from './ringmesh.ts';
import type { Mats } from './scene.ts';
import type { BurstCtx } from './state.ts';

// the rune line material is added to mats here (not in the scene.ts literal)
export type MatsWithRune = Mats & { rune: THREE.LineBasicMaterial };
// anything setRingU can drive: a dash ring with its own mesh, segment count and tilt
export interface RingHost { nSeg: number; obj: RingMesh | null; objN: number; tilt: number[] }
// idle corner arc (one per vertex and radius step)
export interface CornerArc extends RingHost { seed: number; a0: number; span: number; r: number; j: number; v: number }
// expansion ring (7 per burst); segArr holds (start, length, seed) triples in XCAP slots
export interface XRing extends RingHost { blocky: boolean; cap: number; n: number; segArr: Float32Array; on: boolean; dir: number; speed: number; rot: number; i: number; span: number; rOff: number; thK: number; colT: number }
// one per-model spike/line pair in the PULSE group
export interface PulseItem { spk: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>; ln: THREE.Line<THREE.BufferGeometry, THREE.LineBasicMaterial>; kk: number }
export interface PulseState {
  key: unknown; items: PulseItem[]; guides: THREE.Group; needle: null; circ?: (r: number) => THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>; guideBuilt?: boolean;
  c?: { l: THREE.LineLoop<THREE.BufferGeometry, THREE.LineBasicMaterial>; q: number }[];
}

/* ----- idle ornaments: rune glyphs + corner ring arcs; receiving: expansion rings, red marker, plexus web ----- */
(mats as MatsWithRune).rune = new THREE.LineBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
{
  const pts = []; const stroke = (a, b) => pts.push(a, b);
  for (let v = 0; v < 3; v++) {
    const ang = VA[v], ux = Math.cos(ang), uy = -Math.sin(ang), px = -uy, py = ux;
    [[0.66, 0], [0.615, 0.075], [0.615, -0.075]].forEach(([ax, lat], q) => {
      const seed = v * 7 + q * 3 + 1, sc = 0.0105, ox = ux * ax + px * lat, oy = uy * ax + py * lat; // glyph: stem + branches on a 3x5 grid, oriented along the vertex axis
      const P = (gx, gy) => new THREE.Vector3(ox + (ux * (gy - 2) + px * gx) * sc, oy + (uy * (gy - 2) + py * gx) * sc, 0.02);
      stroke(P(0, 0), P(0, 4));
      for (let k = 0; k < 3; k++) { const gy = Math.floor(hash(seed, k) * 4), side = hash(seed, k + 9) < 0.5 ? -1 : 1, up = hash(seed, k + 19) < 0.5 ? 1 : -1; if (gy + up >= 0 && gy + up <= 4) stroke(P(0, gy), P(side, gy + up)); if (hash(seed, k + 29) < 0.35) stroke(P(side, gy), P(side, Math.min(4, gy + 2))); }
      if (q === 0) { stroke(P(-1, 4), P(1, 4)); }
    });
  }
  frameG.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), (mats as MatsWithRune).rune));
}
export const cornerArcs: CornerArc[] = []; // idle band: curved dash arcs hugging each corner
for (let v = 0; v < 3; v++) for (let j = 0; j < 3; j++) {
  const r = 0.50 + j * 0.055; let half = 0.02; for (let th = 0.02; th < 0.7; th += 0.01) { if (r * Math.sin(th) <= (1 - r * Math.cos(th)) * 0.577 * 0.78) half = th; else break; }
  cornerArcs.push({ nSeg: 5 + j * 3, seed: 400 + v * 10 + j, obj: null, objN: 0, tilt: [0, 0, 0], a0: VA[v] - half, span: half * 2, r, j, v });
}
export const XCAP = 96;
export const xr: XRing[] = Array.from({ length: 7 }, (_, i) => ({ blocky: true, cap: XCAP, nSeg: XCAP, n: 0, segArr: new Float32Array(XCAP * 3), obj: null, objN: 0, on: true, dir: i % 2 ? -1 : 1, speed: 0.15, rot: hash(i, 77) * TAU, i, span: TAU, rOff: 0, thK: 1, colT: 0.3, tilt: [0, 0, 0] }));
// per burst: which rings appear, speeds/directions, dash length distribution (long bars vs short ticks), partial arcs, tilt
export function genXr(rng: () => number) {
  let cnt = 0; xr.forEach((x, i) => {
    x.on = rng() < 0.82; if (x.on) cnt++; x.dir = rng() < 0.5 ? -1 : 1; x.speed = (0.06 + rng() * 0.34) * (0.8 + 0.5 * recv.amp); x.span = rng() < 0.3 ? TAU * (0.5 + 0.45 * rng()) : TAU; x.rOff = (rng() - 0.5) * 0.03; x.thK = 0.7 + rng() * 0.9; x.colT = rng();
    x.tilt[0] = (rng() - 0.5) * 0.34; x.tilt[1] = (rng() - 0.5) * 0.34; x.rot = rng() * TAU;
    const ty = rng(), a = x.segArr; let c = rng() * 0.02, n = 0;
    while (c < 1 && n < XCAP) { let len, gap; const longB = ty < 0.33 || (ty < 0.66 && rng() < 0.25);
      if (longB) { len = 0.02 + rng() * 0.06; gap = 0.012 + rng() * 0.04; } else { len = 0.004 + rng() * 0.012; gap = 0.006 + rng() * 0.016; }
      len = Math.min(len, 1 - c); a[n * 3] = c; a[n * 3 + 1] = len; a[n * 3 + 2] = rng(); n++; c += len + gap; }
    x.n = n; if (x.obj) { x.obj.geometry.attributes.aSeg.needsUpdate = true; x.obj.geometry.instanceCount = n; }
  });
  if (cnt < 4) for (let i = 0; i < 4; i++) xr[i].on = true;
}
genXr(mulberry32(7));
export const markerMat = new THREE.LineBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
export const marker = new THREE.Group(); marker.position.set(0, -0.52, 0.02); core.add(marker);
[0, 1].forEach((k) => marker.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.028 + k * 0.006, 0.03 - k * 0.02, 0), new THREE.Vector3(0, -0.012 - k * 0.012, 0), new THREE.Vector3(0.028 - k * 0.006, 0.03 - k * 0.02, 0)]), markerMat)));
marker.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(-0.012, 0.06, 0), new THREE.Vector3(0.012, 0.06, 0), new THREE.Vector3(0, 0.044, 0)]), markerMat));
marker.visible = false;

export const WN = 250, WL = 600;
export const webHome = new Float32Array(WN * 3), webPh = new Float32Array(WN), webIg = new Float32Array(WN), webSz = new Float32Array(WN), webDr = new Float32Array(WN * 2), webPar = new Int16Array(WN).fill(-1);
export const PATTERNS = ['shock', 'sweep', 'tendril', 'cluster'];
export const _best = new Float32Array(WN), _bpar = new Int16Array(WN), _in = new Uint8Array(WN), _dep = new Uint8Array(WN), _cl = new Int8Array(WN), _jit = new Float32Array(WN);
// regenerate the whole web layout, ignition order, settle style and expansion rings for one burst (no per-frame work, no new buffers)
export function genBurst(ctx: BurstCtx) {
  const sp = params.get('seed'), seed = sp != null && sp !== '' ? (+sp >>> 0) : (((Math.random() * 4294967296) >>> 0) ^ (Date.now() >>> 0)); recv.seed = seed; const rng = mulberry32(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(rng() + 1e-6)) * Math.cos(TAU * rng());
  const tool = ctx.toolRatio != null ? ctx.toolRatio : 0.9 + rng() * 0.9, outpc = ctx.outPerCall != null ? ctx.outPerCall : rng() * 3000;
  const tooly = clamp((tool - 1.0) * 2.5, 0, 1), outy = clamp((outpc - 800) / 2500, 0, 1);
  const wts = [1 + outy * 3, 1, 1 + tooly * 3, 1 + tooly * 0.8]; let pat = PATTERNS.indexOf(String(params.get('pattern') || ''));
  if (pat < 0) { let r = rng() * (wts[0] + wts[1] + wts[2] + wts[3]); pat = 0; while (pat < 3 && r > wts[pat]) { r -= wts[pat]; pat++; } }
  recv.pattern = PATTERNS[pat]; recv.sizeK = 1 + 0.6 * outy; recv.briK = 1 + 0.3 * outy; recv.th = 0.27 + 0.07 * tooly - 0.03 * outy; recv.degCap = 4 + (tooly > 0.5 ? 1 : 0) - (outy > 0.5 ? 1 : 0);
  recv.nodes = clamp(Math.round(lerp(24, 250, Math.pow(recv.amp, 1.3)) * (1 + 0.3 * tooly) * (1 - 0.35 * outy) * (0.75 + 0.4 * rng())), 16, WN); recv.settleMode = Math.floor(rng() * 3);
  // origins: sessions that produced the delta (or random for demo keys)
  const org = []; const dfs = ctx.diffs && ctx.diffs.length ? ctx.diffs : [{ ang: rng() * TAU, rad: 0.2 + rng() * 0.3 }, ...(rng() < 0.4 ? [{ ang: rng() * TAU, rad: 0.3 }] : [])];
  for (const d of dfs) org.push([Math.cos(d.ang) * d.rad, -Math.sin(d.ang) * d.rad, d.ang]);
  const dirA = org[0][2], dx = Math.cos(dirA), dy = -Math.sin(dirA);
  // hubs: around sessions with awake sub-agents (count ~ activeAgents)
  const hubA = []; for (const sd of data.sessions || []) { const k = Math.min(3, sd.activeAgents || 0); if (!k) continue; const an = sessAnchor(sd.id).ang; for (let q = 0; q < k && hubA.length < 10; q++) hubA.push(an); }
  if (hubA.length < 2) { const n0 = 2 + Math.floor(rng() * 3); while (hubA.length < n0) hubA.push(rng() * TAU); }
  const hubN = recv.hubN = hubA.length;
  // clusters / constellations
  const nCl = 3 + Math.floor(rng() * 5), cl = []; for (let k = 0; k < nCl; k++) cl.push({ a: k < org.length ? org[k][2] + (rng() - 0.5) * 0.7 : rng() * TAU, d: 0.35 + rng() * 1.1, sp: 0.12 + rng() * 0.28, w: 0.3 + rng(), rank: k });
  for (let k = nCl - 1; k > 0; k--) { const j = Math.floor(rng() * (k + 1)); const t = cl[k].rank; cl[k].rank = cl[j].rank; cl[j].rank = t; }
  let cw = 0; for (const c of cl) cw += c.w; const loner = 0.15 + 0.3 * rng();
  for (let i = 0; i < WN; i++) {
    let x, y; _cl[i] = -1;
    if (i < hubN) { const a = hubA[i] + (rng() - 0.5) * 0.6, r = 0.35 + 0.5 * rng(); x = Math.cos(a) * r; y = -Math.sin(a) * r; }
    else if (rng() < loner) { const a = rng() * TAU, r = 0.2 + 1.5 * Math.sqrt(rng()); x = Math.cos(a) * r * 0.98; y = -Math.sin(a) * r * 0.85; }
    else { let q = rng() * cw, k = 0; while (k < nCl - 1 && q > cl[k].w) { q -= cl[k].w; k++; } const c = cl[k]; _cl[i] = k; x = Math.cos(c.a) * c.d + gauss() * c.sp; y = -Math.sin(c.a) * c.d + gauss() * c.sp * 0.85; }
    x = clamp(x, -1.6, 1.6); y = clamp(y, -1.15, 0.65); webHome[i * 3] = x; webHome[i * 3 + 1] = y; webHome[i * 3 + 2] = (rng() - 0.5) * 0.5; webPh[i] = rng(); webSz[i] = 0.6 + rng() * 0.9; _jit[i] = rng();
    const rd = Math.hypot(x, y) + 1e-3, da = rng() * TAU; webDr[i * 2] = x / rd * 0.5 + Math.cos(da) * 0.5; webDr[i * 2 + 1] = y / rd * 0.5 + Math.sin(da) * 0.5; webPar[i] = -1;
  }
  // ignition order (0 = lit first) by growth pattern
  if (pat === 0) for (let i = 0; i < WN; i++) { const x = webHome[i * 3], y = webHome[i * 3 + 1]; let d = Math.hypot(x, y); for (const o of org) d = Math.min(d, Math.hypot(x - o[0], y - o[1]) + 0.15); webIg[i] = clamp(d / 1.7 + (_jit[i] - 0.5) * 0.06, 0, 0.95); }
  else if (pat === 1) for (let i = 0; i < WN; i++) webIg[i] = clamp(((webHome[i * 3] * dx + webHome[i * 3 + 1] * dy) + 0.5) / 2.3 + (_jit[i] - 0.5) * 0.05, 0, 0.95);
  else if (pat === 2) { // nearest-neighbour spanning tree grown outward from the origins (Prim); ignition = tree depth
    for (let i = 0; i < WN; i++) { let d = Math.hypot(webHome[i * 3], webHome[i * 3 + 1]); for (const o of org) d = Math.min(d, Math.hypot(webHome[i * 3] - o[0], webHome[i * 3 + 1] - o[1])); _best[i] = d + _jit[i] * 0.08; _bpar[i] = -1; _in[i] = 0; }
    let maxD = 1;
    for (let it = 0; it < WN; it++) { let bi = -1, bd = 1e9; for (let i = 0; i < WN; i++) if (!_in[i] && _best[i] < bd) { bd = _best[i]; bi = i; } _in[bi] = 1; webPar[bi] = _bpar[bi]; _dep[bi] = _bpar[bi] < 0 ? 1 : Math.min(250, _dep[_bpar[bi]] + 1); if (_dep[bi] > maxD) maxD = _dep[bi];
      for (let k = 0; k < WN; k++) if (!_in[k]) { const d = Math.hypot(webHome[bi * 3] - webHome[k * 3], webHome[bi * 3 + 1] - webHome[k * 3 + 1], (webHome[bi * 3 + 2] - webHome[k * 3 + 2]) * 0.5) + _jit[k] * 0.08; if (d < _best[k]) { _best[k] = d; _bpar[k] = bi; } } }
    for (let i = 0; i < WN; i++) webIg[i] = _dep[i] / maxD * 0.9;
  } else for (let i = 0; i < WN; i++) webIg[i] = _cl[i] >= 0 ? 0.1 + cl[_cl[i]].rank / nCl * 0.6 + _jit[i] * 0.12 : 0.2 + _jit[i] * 0.7;
  for (let i = 0; i < hubN; i++) webIg[i] = Math.min(webIg[i], 0.03 + _jit[i] * 0.05); // hubs light first
  genXr(rng);
}

export const webG = new THREE.Group(); webG.visible = false; core.add(webG);
export const wPG = new THREE.BufferGeometry(); wPG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(WN * 3), 3)); wPG.setAttribute('aC', new THREE.BufferAttribute(new Float32Array(WN * 4), 4)); wPG.setAttribute('aS', new THREE.BufferAttribute(new Float32Array(WN * 2), 2));
export const webPts = new THREE.Points(wPG, new THREE.ShaderMaterial({
  uniforms: { ...U, uSize: { value: 0.034 } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  vertexShader: `attribute vec4 aC; attribute vec2 aS; varying vec4 vC; uniform float uPx,uSize; void main(){ vC=aC; vec4 mv=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*mv; gl_PointSize=max(3.,uSize*aS.x*uPx/-mv.z); }`,
  fragmentShader: `varying vec4 vC; void main(){ vec2 p=gl_PointCoord-.5; float d=length(p); float glow=exp(-d*d*70.)*.8; float cr=(exp(-abs(p.x)*55.)*exp(-abs(p.y)*6.)+exp(-abs(p.y)*55.)*exp(-abs(p.x)*6.))*.9; float hot=exp(-d*d*900.)*1.6; gl_FragColor=vec4(vC.rgb*(glow+cr)+vec3(1.,.9,.7)*vC.a*hot*0.6*dot(vC.rgb,vec3(.33)),1.); }`,
})); wPG.setDrawRange(0, WN); webPts.frustumCulled = false; webPts.renderOrder = 7; webG.add(webPts);
export const wLG = new THREE.BufferGeometry(); wLG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(WL * 6), 3)); wLG.setAttribute('color', new THREE.BufferAttribute(new Float32Array(WL * 6), 3));
export const webLines = new THREE.LineSegments(wLG, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })); webLines.frustumCulled = false; webLines.renderOrder = 6; webG.add(webLines);
export const alive = new Int16Array(WN), deg = new Uint8Array(WN), webCol = [1, 0.5, 0.1], lineA = new Int16Array(WL), lineB = new Int16Array(WL);
export const GX = 18, GY = 11, CELL = 0.36, gridHead = new Int16Array(GX * GY), gridNext = new Int16Array(WN), cellOf = new Int16Array(WN);
export const SPN = 40, spA = new Int16Array(SPN), spB = new Int16Array(SPN), spT = new Float32Array(SPN).fill(2), spV = new Float32Array(SPN);
export const sPG = new THREE.BufferGeometry(); sPG.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPN * 3), 3)); sPG.setAttribute('aC', new THREE.BufferAttribute(new Float32Array(SPN * 4), 4)); sPG.setAttribute('aS', new THREE.BufferAttribute(new Float32Array(SPN * 2).fill(1.3), 2));
export const sparkPts = new THREE.Points(sPG, webPts.material); sparkPts.frustumCulled = false; sparkPts.renderOrder = 8; webG.add(sparkPts);

export function putLine(la: { [i: number]: number }, n: number, pa: ArrayLike<number>, i: number, j: number) { const o = n * 6; la[o] = pa[i * 3]; la[o + 1] = pa[i * 3 + 1]; la[o + 2] = pa[i * 3 + 2]; la[o + 3] = pa[j * 3]; la[o + 4] = pa[j * 3 + 1]; la[o + 5] = pa[j * 3 + 2]; }
export function syncWeb(wg: number) {
  webG.visible = wg > 0.003; if (!webG.visible) return;
  const pa = wPG.attributes.position.array, ca = wPG.attributes.aC.array, sa = wPG.attributes.aS.array, la = wLG.attributes.position.array, lc = wLG.attributes.color.array;
  const wc = lin(mix(pal.core, pal.hot, 0.35), 1); webCol[0] = wc[0]; webCol[1] = wc[1]; webCol[2] = wc[2];
  const sm = ease(wg), sk = ease(recv.sk), nAct = recv.nodes, hubN = recv.hubN, spk = recv.sparkle, TH = recv.th, bri = recv.briK, szk = recv.sizeK, sm0 = recv.settleMode; let na = 0;
  const s = sm0 === 0 ? 0.2 + 0.8 * sm : (0.9 + 0.1 * sm) * (sm0 === 2 ? 1 + 0.5 * sk : 1), dv = sm0 === 2 ? sk * 0.45 : 0; // settle: 0 collapse into the core, 1 fade in place, 2 drift away
  gridHead.fill(-1);
  for (let i = 0; i < WN; i++) {
    const ph = webPh[i], a = i < nAct ? clamp((wg * 1.25 - webIg[i]) * 5, 0, 1) : 0, hub = i < hubN, hx = webHome[i * 3], hy = webHome[i * 3 + 1], hz = webHome[i * 3 + 2];
    // living plexus: nodes drift on a smooth analytic flow field, so proximity lines form and break
    const fx = Math.sin(S.T * 0.19 + hy * 1.9 + ph * 6.28) * 0.035 + Math.sin(S.T * 0.11 + hx * 2.3 - hy) * 0.022, fy = Math.cos(S.T * 0.17 + hx * 1.7 + ph * 9.1) * 0.035 + Math.cos(S.T * 0.13 + hy * 2.1 + hx) * 0.022;
    const x = hx * s + fx + webDr[i * 2] * dv, y = hy * s + fy + webDr[i * 2 + 1] * dv, z = hz * s; pa[i * 3] = x; pa[i * 3 + 1] = y; pa[i * 3 + 2] = z;
    const tw = (0.65 + 0.35 * Math.sin(S.T * (2 + ph * 3) + ph * 20)) * a * (hub ? 1.7 : 1.0) * 1.5 * bri * (1 + spk * 1.2 * (0.5 + 0.5 * Math.sin(S.T * 9 + ph * 40)));
    ca[i * 4] = webCol[0] * tw; ca[i * 4 + 1] = webCol[1] * tw; ca[i * 4 + 2] = webCol[2] * tw; ca[i * 4 + 3] = a; sa[i * 2] = (hub ? 2.3 : webSz[i]) * szk; sa[i * 2 + 1] = ph;
    if (a > 0.02) { alive[na++] = i; const c = clamp(((y + 1.9) / CELL) | 0, 0, GY - 1) * GX + clamp(((x + 2.6) / CELL) | 0, 0, GX - 1); cellOf[i] = c; gridNext[i] = gridHead[c]; gridHead[c] = i; }
  }
  deg.fill(0); let nl = 0;
  for (let q = 0; q < na && nl < WL; q++) { // tree edges (tendrils) first
    const i = alive[q], p = webPar[i]; if (p < 0 || ca[p * 4 + 3] < 0.02) continue; const dx = pa[i * 3] - pa[p * 3], dy = pa[i * 3 + 1] - pa[p * 3 + 1]; if (dx * dx + dy * dy > 0.5) continue;
    const f = 0.6 * Math.min(ca[i * 4 + 3], ca[p * 4 + 3]) * 1.7; putLine(la, nl, pa, i, p);
    for (let c = 0; c < 2; c++) { lc[nl * 6 + c * 3] = webCol[0] * f; lc[nl * 6 + c * 3 + 1] = webCol[1] * f; lc[nl * 6 + c * 3 + 2] = webCol[2] * f; } lineA[nl] = i; lineB[nl] = p; nl++;
  }
  const th2 = TH * TH, cap = recv.degCap;
  for (let q = 0; q < na && nl < WL; q++) { // proximity edges via a uniform grid (3x3 cell neighbourhood)
    const i = alive[q]; if (deg[i] >= cap) continue; const c0 = cellOf[i], cx = c0 % GX, cy = (c0 / GX) | 0;
    for (let oy = -1; oy <= 1 && nl < WL; oy++) { const yy = cy + oy; if (yy < 0 || yy >= GY) continue;
      for (let ox = -1; ox <= 1; ox++) { const xx = cx + ox; if (xx < 0 || xx >= GX) continue;
        for (let j = gridHead[yy * GX + xx]; j >= 0 && nl < WL; j = gridNext[j]) { if (j <= i || deg[j] >= cap || deg[i] >= cap) continue;
          const dx = pa[i * 3] - pa[j * 3], dy = pa[i * 3 + 1] - pa[j * 3 + 1], dz = pa[i * 3 + 2] - pa[j * 3 + 2], d2 = dx * dx + dy * dy + dz * dz; if (d2 > th2) continue;
          const f = (1 - Math.sqrt(d2) / TH) * Math.min(ca[i * 4 + 3], ca[j * 4 + 3]) * 1.7; deg[i]++; deg[j]++;
          putLine(la, nl, pa, i, j);
          for (let c = 0; c < 2; c++) { lc[nl * 6 + c * 3] = webCol[0] * f; lc[nl * 6 + c * 3 + 1] = webCol[1] * f; lc[nl * 6 + c * 3 + 2] = webCol[2] * f; } lineA[nl] = i; lineB[nl] = j; nl++; } } }
  }
  // sparks travelling along random lines toward the core
  const spp = sPG.attributes.position.array, spc = sPG.attributes.aC.array;
  for (let k = 0; k < SPN; k++) {
    if (spT[k] >= 1 && nl > 0) { let a = lineA[(Math.random() * nl) | 0], b = lineB[(Math.random() * nl) | 0]; const l = (Math.random() * nl) | 0; a = lineA[l]; b = lineB[l]; if (Math.hypot(pa[b * 3], pa[b * 3 + 1]) > Math.hypot(pa[a * 3], pa[a * 3 + 1])) { const t = a; a = b; b = t; } spA[k] = a; spB[k] = b; spT[k] = -Math.random() * 0.8; spV[k] = 0.5 + Math.random() * 0.9; }
    spT[k] += S.curAdt * spV[k] * (1 + spk); const t = clamp(spT[k], 0, 1), on = spT[k] >= 0 && spT[k] < 1 && ca[spA[k] * 4 + 3] > 0.05 && ca[spB[k] * 4 + 3] > 0.05;
    const i = spA[k], j = spB[k]; spp[k * 3] = lerp(pa[i * 3], pa[j * 3], t); spp[k * 3 + 1] = lerp(pa[i * 3 + 1], pa[j * 3 + 1], t); spp[k * 3 + 2] = lerp(pa[i * 3 + 2], pa[j * 3 + 2], t);
    const b = on ? Math.sin(Math.PI * t) * 2.4 : 0; spc[k * 4] = webCol[0] * b; spc[k * 4 + 1] = webCol[1] * b; spc[k * 4 + 2] = webCol[2] * b; spc[k * 4 + 3] = b > 0 ? 1 : 0;
  }
  sPG.attributes.position.needsUpdate = sPG.attributes.aC.needsUpdate = true;
  wLG.setDrawRange(0, nl * 2); wLG.attributes.position.needsUpdate = wLG.attributes.color.needsUpdate = true; wPG.attributes.position.needsUpdate = wPG.attributes.aC.needsUpdate = wPG.attributes.aS.needsUpdate = true;
}
export function setRingU(x: RingHost, r: number, th: number, a0: number, span: number, rot: number, col: number[], int: number, alpha: number, tiltK: number) {
  if (!x.obj || x.objN !== x.nSeg) buildRingObj(x as unknown as RingRec); const u = x.obj.material.uniforms;
  u.uColor.value.set(col[0], col[1], col[2]); u.uInt.value = int; u.uAlpha.value = alpha; u.uR.value = r; u.uTh.value = th; u.uA0.value = a0; u.uSpan.value = span; u.uRot.value = rot; u.uK.value = span > TAU - 0.05 ? 1 : clamp(span / TAU, 0.22, 1);
  u.uSel.value = 0; u.uBlink.value = 1; u.uErr.value = 0; u.uWarn.value = 0; u.uJit.value = 0; x.obj.rotation.set(x.tilt[0] * tiltK, x.tilt[1] * tiltK, 0); x.obj.visible = alpha > 0.01;
}
export function syncExtras(ex: number, triK: number) {
  const e = ease(clamp(ex, 0, 1)); const chot = pal.hot, cc = pal.core;
  // idle corner arcs (fade with the triangle)
  for (const c of cornerArcs) { const k = triK * (S.mode === 0 || S.mode === 1 ? 1 : 0.5); setRingU(c, c.r, 0.0042, c.a0, c.span, Math.sin(S.T * 0.2 + c.v + c.j) * 0.03, lin(mix(cc, pal.dim, 0.5), 1), 0.75 + 0.12 * Math.sin(S.T * 1.3 + c.j), clamp(k, 0, 1) * 0.9, 1); }
  // expansion rings: chunky segmented dashes at different speeds
  xr.forEach((x, i) => {
    if (e < 0.01 || !x.on) { if (x.obj) x.obj.visible = false; return; }
    x.rot += x.dir * x.speed * S.curAdt * (0.6 + e); const rr = 0.50 + i * 0.05 + x.rOff + 0.008 * Math.sin(S.T * 0.6 + i);
    setRingU(x, rr, (0.009 + 0.0018 * ((i * 3) % 5)) * x.thK, 0, x.span, x.rot, lin(mix(cc, chot, 0.12 + 0.5 * x.colT), 1), 0.5 + 0.8 * e * (0.8 + 0.2 * Math.sin(S.T * 2 + i)), e * (0.65 + 0.35 * x.colT), 1);
  });
  // red marker beside the core
  marker.visible = e > 0.02; if (marker.visible) setC(markerMat, lin(pal.frame, 3.4 * e * (0.8 + 0.2 * Math.sin(S.T * 5))));
}

/* ----- sub-agent glow points ----- */
export const MAXSA = 16 * 8 + 16;
export const saGeo = new THREE.BufferGeometry(); saGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAXSA * 3), 3)); saGeo.setAttribute('aC', new THREE.BufferAttribute(new Float32Array(MAXSA * 4), 4)); saGeo.setDrawRange(0, 0);
export const pointVS = `attribute vec4 aC; varying vec4 vC; uniform float uPx, uSize; void main(){ vC=aC; vec4 mv=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*mv; gl_PointSize=max(2.,uSize*uPx/-mv.z); }`;
export const pointFS = `varying vec4 vC; void main(){ float d=length(gl_PointCoord-.5); if(d>.5) discard; float a=smoothstep(.5,0.,d); gl_FragColor=vec4(vC.rgb*(a*a*1.2+pow(a,8.)*2.2)*vC.a, 1.); }`;
export const saPts = new THREE.Points(saGeo, new THREE.ShaderMaterial({ uniforms: { ...U, uSize: { value: 0.016 } }, vertexShader: pointVS, fragmentShader: pointFS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); saPts.frustumCulled = false; saPts.renderOrder = 5; core.add(saPts);

/* ----- dust / ember particles (GPU) ----- */
export const NP = 4200;
export const pGeo = new THREE.BufferGeometry(); { const p = new Float32Array(NP * 3), q = new Float32Array(NP * 4); for (let i = 0; i < NP; i++) { p[i * 3] = (hash(i, 1) - 0.5) * 3.0; p[i * 3 + 1] = (hash(i, 2) - 0.5) * 2.6; p[i * 3 + 2] = (hash(i, 3) - 0.5) * 1.0 + 0.05; q[i * 4] = hash(i, 4); q[i * 4 + 1] = hash(i, 5); q[i * 4 + 2] = hash(i, 6); q[i * 4 + 3] = hash(i, 7); } pGeo.setAttribute('position', new THREE.BufferAttribute(p, 3)); pGeo.setAttribute('aR', new THREE.BufferAttribute(q, 4)); }
export const dust = new THREE.Points(pGeo, new THREE.ShaderMaterial({
  uniforms: { ...U }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  vertexShader: `attribute vec4 aR; uniform float uTime,uPull,uPx,uAct; uniform vec3 uCore,uHot; uniform vec2 uCoreP; varying vec3 vCol;
  void main(){
    vec3 p=position; float sp=0.018+0.05*aR.x;
    p.y=mod(p.y+uTime*sp+1.3,2.6)-1.3; p.x+=sin(uTime*0.13+aR.y*6.283)*0.07; p.z+=sin(uTime*0.09+aR.y*9.)*0.06;
    vec2 c=p.xy-uCoreP; float rr=length(c);
    float ang=uPull*1.1*smoothstep(1.5,0.1,rr); float cs=cos(ang), sn=sin(ang); c=mat2(cs,-sn,sn,cs)*c; c*=1.-uPull*0.5*smoothstep(1.4,0.12,rr);
    rr=length(c); p.xy=c+uCoreP;
    bool inside = c.y<0.5 && abs(c.x)*1.732<c.y+1.0;
    float tw=0.5+0.5*sin(uTime*1.3+aR.y*40.);
    float a=(inside?1.:0.32)*(0.35+0.65*tw)*(0.45+0.55*aR.w);
    vCol=mix(uCore,uHot,aR.w*0.55)*a*(0.9+2.6*uAct*exp(-rr*3.));
    vec4 mv=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv; gl_PointSize=max(1.,(0.0016+0.0034*aR.z)*uPx/-mv.z*(inside?1.:0.8));
  }`,
  fragmentShader: `varying vec3 vCol; void main(){ float d=length(gl_PointCoord-.5); if(d>.5) discard; float a=smoothstep(.5,.0,d); gl_FragColor=vec4(vCol*a*a,1.); }`,
}));
dust.frustumCulled = false; dust.renderOrder = 6; world.add(dust);

/* ----- NEURAL group: agent-type nodes ----- */
export const sphereMat = (col: [number, number, number]) => new THREE.ShaderMaterial({
  uniforms: { uCol: { value: new THREE.Vector3(...col) }, uCorePos: { value: new THREE.Vector3() }, uA: { value: 1 }, uEm: { value: 0.25 } }, transparent: true,
  vertexShader: `varying vec3 vN, vW; void main(){ vN=mat3(modelMatrix)*normal; vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `varying vec3 vN, vW; uniform vec3 uCol,uCorePos; uniform float uA,uEm;
  void main(){ vec3 N=normalize(vN); vec3 L=normalize(uCorePos-vW); vec3 V=normalize(cameraPosition-vW); float l=max(dot(N,L),0.); float rim=pow(1.-max(dot(N,V),0.),2.5); vec3 H=normalize(L+V); float sp=pow(max(dot(N,H),0.),40.);
    vec3 c=uCol*(uEm+1.15*l)+uCol*rim*1.4+vec3(1.,.95,.9)*sp*0.8; gl_FragColor=vec4(c*uA, uA); }`,
});
export const nodeNames = [], mdlNames = [];
export const neuralG = new THREE.Group(); core.add(neuralG);
export const NN = 8; export const nodes = Array.from({ length: NN }, (_, i) => {
  const mat = sphereMat([1, 0.5, 0.1]); const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18), mat); mesh.renderOrder = 4;
  const halo = new THREE.Sprite(spriteMat(1)); halo.renderOrder = 3;
  const shell = new THREE.Mesh(new THREE.RingGeometry(1.35, 1.45, 48, 1, 0, 4.2), hdr(1, { transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(32 * 3), 3));
  const link = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })); link.frustumCulled = false;
  neuralG.add(mesh, halo, shell, link); return { mesh, halo, shell, link, mat, pts: [] };
});
export const nPulseGeo = new THREE.BufferGeometry(); nPulseGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NN * 4 * 3), 3)); nPulseGeo.setAttribute('aC', new THREE.BufferAttribute(new Float32Array(NN * 4 * 4), 4));
export const nPulse = new THREE.Points(nPulseGeo, new THREE.ShaderMaterial({ uniforms: { ...U, uSize: { value: 0.008 } }, vertexShader: pointVS, fragmentShader: pointFS, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); nPulse.frustumCulled = false; neuralG.add(nPulse);

/* ----- PULSE group ----- */
export const pulseG = new THREE.Group(); core.add(pulseG);
export const pulseState: PulseState = { key: null, items: [], guides: null, needle: null };
export function addLineMat(opts = {}) { return new THREE.LineBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, ...opts }); }
export const pulseGuideMat = addLineMat();
{ const g = new THREE.Group(); const circ = (r) => { const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 120 }, (_, i) => new THREE.Vector3(Math.cos((i / 120) * TAU) * r, Math.sin((i / 120) * TAU) * r, 0))), pulseGuideMat); return l; };
  pulseState.guides = g; pulseG.add(g); pulseState.circ = circ; }
export const needleGeo = new THREE.BufferGeometry(); needleGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(30 * 2 * 3), 3)); needleGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(30 * 2 * 3), 3));
export const needle = new THREE.LineSegments(needleGeo, addLineMat({ vertexColors: true })); needle.frustumCulled = false; pulseG.add(needle);

/* ----- MODELS group ----- */
export const modelsG = new THREE.Group(); core.add(modelsG);
export const mdl = Array.from({ length: 8 }, () => {
  const mat = sphereMat([1, 1, 1]); const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 24), mat); mesh.renderOrder = 4;
  const halo = new THREE.Sprite(spriteMat(1)); halo.renderOrder = 3;
  const orbit = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 128 }, (_, i) => new THREE.Vector3(Math.cos((i / 128) * TAU), Math.sin((i / 128) * TAU), 0))), addLineMat());
  modelsG.add(mesh, halo, orbit); return { mesh, halo, orbit, mat };
});

// late-bound for callers in earlier modules (see shared.ts H)
Object.assign(H, { genBurst });
