import * as THREE from 'three';
import { TAU } from './util.ts';
import { NOISE, U, core, hdr, mats, sphG } from './scene.ts';

/* ----- plasma disc + pupil ----- */
export const plasmaMat = new THREE.ShaderMaterial({
  uniforms: { ...U, uR0: { value: 0.46 }, uPupil: { value: 0.05 }, uFiber: { value: 1 }, uAlpha: { value: 1 } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  vertexShader: `varying vec2 vP; uniform float uR0; void main(){ vP=position.xy*uR0; gl_Position=projectionMatrix*modelViewMatrix*vec4(position.xy*uR0,position.z,1.); }`,
  fragmentShader: `varying vec2 vP; uniform float uR0,uPupil,uAct,uTime,uFiber,uAlpha; uniform vec3 uTint,uCore,uHot,uDim;
${NOISE}
void main(){
  float r=length(vP); float R=r/uR0; if(R>1.) discard;
  float a=atan(vP.y,vP.x);
  float ang=a+(1.-R)*2.4+uTime*0.10;
  vec2 sp=vec2(cos(ang),sin(ang))*r*9.;
  vec2 w1=vec2(fbm(sp+uTime*0.16), fbm(sp+vec2(5.2,1.3)-uTime*0.13));
  float n=fbm(sp+3.2*w1);
  float n2=fbm(sp*1.6+4.0*w1.yx+uTime*0.09);
  float fib=fbm(vec2(a*16.+uTime*0.15, r*20.));
  float prof=smoothstep(1.,.12,R);
  float edge=smoothstep(uPupil*0.9, uPupil*2.2, r);
  float I=(0.10+0.85*uAct)*prof*edge;
  vec3 tint=mix(uCore,uTint,0.5);
  vec3 c=mix(uDim, tint, smoothstep(.25,.85,n))*(0.5+1.2*n);
  c+=uHot*smoothstep(.5,.95,n2)*0.9;
  vec3 col=c*I*1.05;
  col+=mix(uCore,uHot,.2)*pow(fib,3.)*prof*0.5*uFiber*(0.25+0.6*uAct);
  float d=max(r-uPupil,0.);
  col+=mix(uCore,uTint,.3)*exp(-d*55.)*(0.5+1.0*uAct)*step(uPupil,r);
  col+=uTint*exp(-d*9.)*0.05*(0.4+uAct)*step(uPupil,r);
  gl_FragColor=vec4(col*uAlpha,1.);
}`,
});
export const plasma = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), plasmaMat); plasma.renderOrder = 0; plasma.frustumCulled = false; core.add(plasma);
export const pupilMesh = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, depthWrite: false })); pupilMesh.position.z = 0.004; pupilMesh.renderOrder = 1; core.add(pupilMesh);
export const voidMesh = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.ShaderMaterial({ transparent: true, depthWrite: false, vertexShader: `varying vec2 vP; void main(){ vP=position.xy; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`, fragmentShader: `varying vec2 vP; void main(){ gl_FragColor=vec4(0.,0.,0.,smoothstep(1.,0.4,length(vP))*0.92); }` })); voidMesh.position.z = 0.003; voidMesh.renderOrder = 0.5; core.add(voidMesh);
export const rimMat = hdr(1, { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
export const rim = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 96), rimMat); rim.position.z = 0.006; rim.renderOrder = 8; core.add(rim);
export const glintMat = hdr(1, { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
export const glint = new THREE.Mesh(new THREE.RingGeometry(0.8, 0.97, 24, 1, 1.0, 0.9), glintMat); glint.position.z = 0.007; glint.renderOrder = 9; core.add(glint);

/* ----- shock waves ----- */
export const shockMat = new THREE.ShaderMaterial({
  uniforms: { ...U, uS: { value: new Float32Array([2, 2, 2, 2, 2]) }, uPupil: { value: 0.05 } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
  vertexShader: `varying vec2 vP; void main(){ vP=position.xy*1.15; gl_Position=projectionMatrix*modelViewMatrix*vec4(position.xy*1.15,0.02,1.); }`,
  fragmentShader: `varying vec2 vP; uniform float uS[5]; uniform float uPupil; uniform vec3 uCore,uHot;
void main(){ float r=length(vP); vec3 c=vec3(0.);
  for(int i=0;i<5;i++){ float age=uS[i]; if(age>1.) continue; float rr=mix(uPupil,0.92,1.-pow(1.-age,2.)), f=1.-age; float w=0.004+0.014*f;
    float d=(r-rr); float k=exp(-d*d/(w*w)); c+=mix(uCore,uHot,.55)*k*f*f*2.6 + uHot*exp(-pow((r-rr*0.93)/0.004,2.))*f*0.6; }
  gl_FragColor=vec4(c,1.); }`,
});
export const shockQ = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), shockMat); shockQ.renderOrder = 11; shockQ.frustumCulled = false; core.add(shockQ);

/* ----- hour dial: 24 ticks + analog clock dot with comet trail ----- */
export const ringsG = new THREE.Group(); core.add(ringsG);
export const hourMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 1, 1) });
export const hourTicks = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), hourMat, 12); hourTicks.instanceMatrix.setUsage(THREE.DynamicDrawUsage); hourTicks.frustumCulled = false; core.add(hourTicks);
for (let i = 0; i < 12; i++) hourTicks.setColorAt(i, new THREE.Color(1, 1, 1));
export const clockStripes: { x: number; y: number; str: string }[] = [];
export const hourCap = new THREE.Mesh(sphG, hdr(1)); hourCap.scale.setScalar(0.0095); core.add(hourCap);
export const hourLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })); hourLine.frustumCulled = false; core.add(hourLine);
mats.min = new THREE.LineBasicMaterial({ color: 0xffffff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
export const minuteTicks = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 60 }, (_, i) => i % 5 ? i : -1).filter((i) => i >= 0).flatMap((i) => { const a = Math.PI / 2 - (i / 60) * TAU; return [new THREE.Vector3(Math.cos(a), Math.sin(a), 0), new THREE.Vector3(Math.cos(a) * 1.025, Math.sin(a) * 1.025, 0)]; })), mats.min); core.add(minuteTicks);
export const dialLine = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 160 }, (_, i) => new THREE.Vector3(Math.cos((i / 160) * TAU), Math.sin((i / 160) * TAU), 0))), mats.dial); core.add(dialLine);
export const TRAIL = 28;
export const trailGeo = new THREE.BufferGeometry(); trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3)); trailGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
export const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })); trail.frustumCulled = false; core.add(trail);
export const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.45)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
export const spriteMat = (k = 1) => new THREE.SpriteMaterial({ map: glowTex, color: new THREE.Color(k, k, k), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
export const clockDot = new THREE.Sprite(spriteMat(1)); clockDot.scale.setScalar(0.05); clockDot.renderOrder = 12; core.add(clockDot);
export const clockCore = new THREE.Mesh(sphG, hdr(1)); clockCore.scale.setScalar(0.0045); core.add(clockCore);
export const clockState = { x: 0, y: 0, str: '' };
