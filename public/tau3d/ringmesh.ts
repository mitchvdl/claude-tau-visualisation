import * as THREE from 'three';
import { TAU, hash } from './util.ts';
import { U } from './scene.ts';
import { ringsG } from './core.ts';

// per-ring record (owned by the ring/state code, shared with it as plain objects; only the fields touched here are declared)
export type RingMesh = THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
export interface RingRec { seed: number; obj?: RingMesh | null; objRect?: boolean; objN?: number; blocky?: boolean; rect?: boolean; cap?: number; segArr?: Float32Array; n?: number; nSeg?: number }

/* ----- memory rings: instanced arc segments, per-instance start/length/random, built in the vertex shader ----- */
export const CS_DIV = 8, CS_N = 6;
export const arcBase = (() => { // position = (t along arc, profile u, profile v); aN = profile normal
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [];
  for (let s = 0; s <= CS_DIV; s++) for (let k = 0; k < CS_N; k++) { const a = (k / CS_N) * TAU, u = Math.cos(a), v = Math.sin(a) * 0.62; pos.push(s / CS_DIV, u, v); const n = new THREE.Vector2(Math.cos(a), Math.sin(a) / 0.62).normalize(); nrm.push(n.x, n.y); }
  for (let s = 0; s < CS_DIV; s++) for (let k = 0; k < CS_N; k++) { const a = s * CS_N + k, b = s * CS_N + (k + 1) % CS_N, c = a + CS_N, d = b + CS_N; idx.push(a, c, b, b, c, d); }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx };
})();
export const ringVS = `attribute vec3 aSeg; attribute vec2 aN; uniform float uR,uTh,uA0,uSpan,uRot,uK,uJit,uTaper,uBlk; varying vec3 vN, vV; varying float vRand;
void main(){
  float xs=aSeg.x/uK; if(xs>=1.0){ gl_Position=vec4(2.,2.,2.,1.); return; }
  float t=position.x; float taper=1.-0.78*uTaper*pow(abs(2.*t-1.),5.);
  float ang=uA0+uRot+(xs+t*aSeg.y/uK)*uSpan;
  if(uBlk>0.){ float cell=aSeg.y/uK; float lf=min(uBlk*(0.75+0.5*aSeg.z)/(uR*uSpan), cell*0.85); ang=uA0+uRot+(xs+cell*0.5+(t-0.5)*lf)*uSpan; }
  float rr=uR+position.y*uTh*0.5*taper+uJit*(aSeg.z-.5)*0.012;
  vec3 pos=vec3(cos(ang)*rr, -sin(ang)*rr, position.z*uTh*0.5*taper+uJit*(aSeg.z-.5)*0.02);
  vec3 n=vec3(cos(ang)*aN.x, -sin(ang)*aN.x, aN.y);
  vN=normalMatrix*n; vRand=aSeg.z;
  vec4 mv=modelViewMatrix*vec4(pos,1.); vV=-mv.xyz; gl_Position=projectionMatrix*mv;
}`;
export const ringFS = `varying vec3 vN, vV; varying float vRand; uniform vec3 uColor,uHot; uniform float uAlpha,uInt,uSel,uBlink,uWarn,uErr,uDrop,uTime,uWait; uniform vec3 uBeacon;
void main(){
  vec3 N=normalize(vN), V=normalize(vV); float ndv=clamp(dot(N,V),0.,1.);
  float cr=pow(ndv,3.), rm=pow(1.-ndv,2.);
  vec3 col=uColor*(0.5+0.55*rm)+uHot*cr*0.5;
  col=mix(col, uBeacon*1.5+vec3(1.)*cr*.5, uWait*0.88);
  col=mix(col, vec3(1.,.30,.06)*1.25+uHot*cr*.3, uWarn*0.62);
  col=mix(col, vec3(1.,.95,.88)*1.7, uSel*0.78);
  col=mix(col, vec3(1.,.0,.0)*2.0+vec3(1.,.35,.25)*cr*.6, uErr*0.92);
  float vis=1.;
  if(uErr>0.01){ float h=fract(sin(vRand*91.7+floor(uTime*13.)*17.3)*437.5); vis=h<uDrop?0.06:1.; }
  gl_FragColor=vec4(col*uInt*uBlink*vis, uAlpha*(0.06+0.94*vis));
}`;
export const arcBlock = (() => { // rectangular cross-section for the expansion-ring blocks
  const pos: number[] = [], nrm: number[] = [], idx: number[] = [], cs = [[1, 0.4], [-1, 0.4], [-1, -0.4], [1, -0.4]];
  for (let s = 0; s <= CS_DIV; s++) cs.forEach(([u, v]) => { pos.push(s / CS_DIV, u, v); nrm.push(u * 0.7, v / 0.4 * 0.7); });
  for (let s = 0; s < CS_DIV; s++) for (let k = 0; k < 4; k++) { const a = s * 4 + k, b = s * 4 + (k + 1) % 4, c = a + 4, d = b + 4; idx.push(a, c, b, b, c, d); }
  return { pos: new Float32Array(pos), nrm: new Float32Array(nrm), idx };
})();
export function ringUniforms() { return { ...U, uR: { value: 0.2 }, uTh: { value: 0.01 }, uA0: { value: 0 }, uSpan: { value: TAU }, uRot: { value: 0 }, uK: { value: 1 }, uJit: { value: 0 }, uTaper: { value: 1 }, uBlk: { value: 0 }, uWait: { value: 0 }, uBeacon: { value: new THREE.Vector3(0.4, 0.8, 1) }, uColor: { value: new THREE.Vector3(1, 0.5, 0.1) }, uHot: U.uHot, uAlpha: { value: 1 }, uInt: { value: 1.6 }, uSel: { value: 0 }, uBlink: { value: 1 }, uWarn: { value: 0 }, uErr: { value: 0 }, uDrop: { value: 0.1 } }; }
export function buildRingObj(r: RingRec) {
  if (r.obj) { ringsG.remove(r.obj); r.obj.geometry.dispose(); r.obj.material.dispose(); }
  const B = r.blocky || r.rect ? arcBlock : arcBase; const g = new THREE.InstancedBufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(B.pos, 3)); g.setAttribute('aN', new THREE.BufferAttribute(B.nrm, 2)); g.setIndex(B.idx);
  const n = r.blocky ? r.cap : r.rect ? r.nSeg * 3 : r.nSeg, seg = r.blocky ? r.segArr : new Float32Array(n * 3);
  if (!r.blocky) for (let k = 0; k < n; k++) { const step = 1 / n, len = r.rect ? step : step * (0.42 + 0.46 * hash(r.seed, k)); seg[k * 3] = k * step + (step - len) * 0.5; seg[k * 3 + 1] = len; seg[k * 3 + 2] = hash(r.seed + 7, k); }
  g.setAttribute('aSeg', new THREE.InstancedBufferAttribute(seg, 3)); g.instanceCount = r.blocky ? r.n : n;
  const m: RingMesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: ringUniforms(), vertexShader: ringVS, fragmentShader: ringFS, transparent: true, depthWrite: true, side: THREE.DoubleSide }));
  if (r.blocky || r.rect) m.material.uniforms.uTaper.value = 0; r.objRect = !!r.rect; m.frustumCulled = false; m.renderOrder = 2; r.obj = m; r.objN = r.blocky ? n : r.nSeg; ringsG.add(m);
}
export function killRingObj(r: RingRec) { if (r.obj) { ringsG.remove(r.obj); r.obj.geometry.dispose(); r.obj.material.dispose(); r.obj = null; } }
