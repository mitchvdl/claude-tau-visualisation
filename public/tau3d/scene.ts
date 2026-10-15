import * as THREE from 'three';
import { lin } from './util.ts';
import { $ } from './dom.ts';

/* ============================================================ three.js setup */
export const cv = $('cv') as HTMLCanvasElement;
export let renderer: THREE.WebGLRenderer;
try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false, powerPreference: 'high-performance', alpha: false }); } catch (e) {
  const d = document.createElement('div'); d.id = 'nogl'; d.innerHTML = 'WEBGL UNAVAILABLE &nbsp;·&nbsp; <a class="back" href="/">BACK TO STATS</a>'; document.body.append(d); throw e;
}
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.setClearColor(0x020103, 1);
export const scene = new THREE.Scene();
export const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 40);
export const FOV_T = Math.tan((35 * Math.PI) / 360);
export const world = new THREE.Group(); world.position.y = 0.25; scene.add(world); // triangle bbox centred on screen, core sits above centre
export const core = new THREE.Group(); world.add(core);

// shared uniforms (palette in linear light, driven per frame)
export const U = {
  uTime: { value: 0 }, uFrame: { value: new THREE.Vector3() }, uCore: { value: new THREE.Vector3() }, uHot: { value: new THREE.Vector3() }, uDim: { value: new THREE.Vector3() },
  uTint: { value: new THREE.Vector3() }, uBgBase: { value: new THREE.Vector3() }, uBgVein: { value: new THREE.Vector3() }, uGrain: { value: 0 }, uAct: { value: 0 }, uPull: { value: 0 }, uPx: { value: 800 }, uCoreP: { value: new THREE.Vector2(0, 0.25) },
};

export const NOISE = `
float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h21(i),h21(i+vec2(1.,0.)),f.x),mix(h21(i+vec2(0.,1.)),h21(i+vec2(1.,1.)),f.x),f.y); }
float fbm(vec2 p){ float a=.5,s=0.; mat2 m=mat2(1.6,1.2,-1.2,1.6); for(int i=0;i<5;i++){ s+=a*vn(p); p=m*p; a*=.5; } return s; }
float fbm3(vec2 p){ float a=.5,s=0.; mat2 m=mat2(1.6,1.2,-1.2,1.6); for(int i=0;i<3;i++){ s+=a*vn(p); p=m*p; a*=.5; } return s; }
`;

/* ----- marble background (world-space plane behind everything: parallax with the camera drift) ----- */
export const bgMat = new THREE.ShaderMaterial({
  uniforms: U, depthWrite: false, depthTest: false,
  vertexShader: `varying vec3 vWP; void main(){ vec4 w=modelMatrix*vec4(position,1.); vWP=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
  fragmentShader: `varying vec3 vWP; uniform float uTime,uAct,uGrain; uniform vec3 uTint,uCore,uBgBase,uBgVein; uniform vec2 uCoreP;
${NOISE}
void main(){
  vec2 p=vWP.xy*0.85; float t=uTime*0.012;
  vec2 w=vec2(fbm(p*1.2+t), fbm(p*1.2+5.2-t));
  float b=fbm(p*1.0+w*1.7);
  vec3 col=mix(uBgBase*0.08, uBgBase, smoothstep(.28,.85,b));
  float f1=fbm(p*1.55+w*2.4+3.1), f2=fbm(p*3.3-w*1.7+8.3), f3=fbm3(p*7.0+w*3.0);
  float v1=1.-smoothstep(0.,fwidth(f1)*1.3+0.0004,abs(f1-0.5)), g1=1.-smoothstep(0.,0.04,abs(f1-0.5));
  float v2=1.-smoothstep(0.,fwidth(f2)*1.1+0.0004,abs(f2-0.5));
  float v3=(1.-smoothstep(0.,fwidth(f3)*1.0+0.0004,abs(f3-0.5)))*0.5;
  float r=length(vWP.xy-uCoreP);
  float sh=0.72+0.28*sin(uTime*0.45+f1*22.+f2*9.);
  vec3 gold=uBgVein;
  float lit=1.+2.2*exp(-r*1.3)*(0.5+uAct);
  col+=gold*(v1*0.15+v2*0.05+v3*0.02)*sh*lit + gold*g1*0.004;
  col+=uTint*exp(-r*r*2.2)*(0.018+0.05*uAct);
  // fine grainy floor panel (film look); fades out toward the edges so marble frames it
  float panel=smoothstep(2.0,1.15,length(vWP.xy*vec2(0.78,1.0)));
  float gr=h21(floor(vWP.xy*520.))*0.65+vn(vWP.xy*140.)*0.35;
  vec3 floorC=vec3(0.020,0.026,0.045)+vec3(0.030,0.036,0.055)*gr;
  col=mix(col, floorC+col*0.35, uGrain*panel*0.92);
  gl_FragColor=vec4(col,1.);
}`,
});
export const bg = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), bgMat); bg.position.z = -1.3; bg.renderOrder = -10; bg.frustumCulled = false; scene.add(bg);

/* ----- neon triangle ----- */
export const VA: number[] = [210, 330, 90].map((d) => (d * Math.PI) / 180);
export const verts3 = (R: number, z = 0): THREE.Vector3[] => VA.map((a) => new THREE.Vector3(Math.cos(a) * R, -Math.sin(a) * R, z));
export const Y = new THREE.Vector3(0, 1, 0);
export const _d = new THREE.Vector3();
export function setSeg(m: THREE.Object3D, A: THREE.Vector3, B: THREE.Vector3) { _d.subVectors(B, A); const L = _d.length(); m.position.addVectors(A, B).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(Y, _d.multiplyScalar(1 / (L || 1))); m.scale.set(1, L, 1); }
export const cylG = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true), sphG = new THREE.SphereGeometry(1, 12, 8);
export const neon = (F: number[], k?: number) => lin([F[0], F[1] * 0.45, F[2] * 0.4], k); // keep reds red through ACES
export const hdr = (r = 1, o: THREE.MeshBasicMaterialParameters = {}) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, r, r), toneMapped: true, ...o });
export interface Mats {
  tubeOut: THREE.MeshBasicMaterial; tubeIn: THREE.MeshBasicMaterial; white: THREE.MeshBasicMaterial; gaugeBase: THREE.MeshBasicMaterial; gaugeLit: THREE.MeshBasicMaterial; spark: THREE.MeshBasicMaterial;
  tick: THREE.LineBasicMaterial; chev: THREE.LineBasicMaterial[]; dial: THREE.LineBasicMaterial; min?: THREE.LineBasicMaterial; // min: set in core.ts
}
export const mats: Mats = { tubeOut: hdr(), tubeIn: hdr(), white: hdr(), gaugeBase: hdr(), gaugeLit: hdr(), spark: hdr(), tick: new THREE.LineBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }), chev: [0, 1, 2].map(() => new THREE.LineBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })), dial: new THREE.LineBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }) };
export const frameG = new THREE.Group(); world.add(frameG);
export interface FrameSpec { R: number; z: number; rad: number; mat: THREE.MeshBasicMaterial }
export const FR: FrameSpec[] = [{ R: 0.995, z: 0.045, rad: 0.0062, mat: mats.tubeOut }, { R: 0.93, z: -0.045, rad: 0.0046, mat: mats.tubeIn }];
export const frames: { v: THREE.Vector3[]; f: FrameSpec }[] & { chev?: THREE.Line[] } = FR.map((f) => {
  const v = verts3(f.R, f.z), g = new THREE.Group(); const segs: THREE.Mesh[] = [];
  for (let e = 0; e < 3; e++) {
    const A = v[e], B = v[(e + 1) % 3];
    const m = new THREE.Mesh(cylG, f.mat); setSeg(m, A, B); m.scale.x = m.scale.z = f.rad; g.add(m);
    const w = new THREE.Mesh(cylG, mats.white); setSeg(w, A, B); w.scale.x = w.scale.z = f.rad * 0.34; w.position.z += 0.001; g.add(w);
    const j = new THREE.Mesh(sphG, f.mat); j.position.copy(A); j.scale.setScalar(f.rad * 1.02); g.add(j);
    segs.push(m);
  }
  frameG.add(g); return { v, f };
});
{ // ticks between the two edges + corner chevrons + corner spikes
  const vo = frames[0].v, vi = frames[1].v, pts = [];
  for (let e = 0; e < 3; e++) { const A = vo[e], B = vo[(e + 1) % 3], A2 = vi[e], B2 = vi[(e + 1) % 3]; const N = 42;
    for (let i = 1; i < N; i++) { const t = i / N, long = i % 6 === 0; const o = new THREE.Vector3().lerpVectors(A, B, t), n = new THREE.Vector3().lerpVectors(A2, B2, t);
      if (long) pts.push(o, n); else pts.push(n, new THREE.Vector3().lerpVectors(n, o, 0.45));
      const dir = n.clone().setZ(0).normalize(); pts.push(n, n.clone().addScaledVector(dir, -(long ? 0.009 : 0.004))); } }
  frameG.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), mats.tick));
  for (let e = 0; e < 3; e++) { const a = VA[e], ux = Math.cos(a), uy = -Math.sin(a), px = -uy, py = ux;
    for (let k = 0; k < 3; k++) { const d = 0.80 - k * 0.045, w = 0.03 - k * 0.006;
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ux * d + px * w * 1.6, uy * d + py * w * 1.6, 0.03), new THREE.Vector3(ux * (d + w), uy * (d + w), 0.03), new THREE.Vector3(ux * d - px * w * 1.6, uy * d - py * w * 1.6, 0.03)]);
      const m = new THREE.Line(g, mats.chev[k]); m.userData = { e, k }; frameG.add(m); frames.chev = (frames.chev || []).concat(m); }
    const sp = new THREE.Mesh(cylG, mats.tubeOut); setSeg(sp, new THREE.Vector3(ux * 1.01, uy * 1.01, 0.045), new THREE.Vector3(ux * 1.07, uy * 1.07, 0.045)); sp.scale.x = sp.scale.z = 0.005; frameG.add(sp); }
}
// gauges (on the inner edge, drawn inwards) + travelling highlights
export const gauges = [[2, 0], [2, 1], [0, 1]].map(([a, b]) => {
  const base_ = new THREE.Mesh(cylG, mats.gaugeBase), lit = new THREE.Mesh(cylG, mats.gaugeLit), dot = new THREE.Mesh(sphG, mats.gaugeLit);
  frameG.add(base_, lit, dot); return { a, b, base_, lit, dot };
});
export const sparks = [0, 1, 2].map(() => { const m = new THREE.Mesh(cylG, mats.spark); frameG.add(m); return m; });
