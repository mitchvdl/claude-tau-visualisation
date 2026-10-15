import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { camera, renderer, scene } from './scene.ts';

/* ----- post-processing ----- */
export const FinishShader = {
  uniforms: { tDiffuse: { value: null }, uLift: { value: new THREE.Vector3() }, uTime: { value: 0 }, uVig: { value: 0.62 }, uGrain: { value: 0.028 }, uRes: { value: new THREE.Vector2(1, 1) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `varying vec2 vUv; uniform sampler2D tDiffuse; uniform float uTime,uVig,uGrain; uniform vec2 uRes; uniform vec3 uLift;
  float hh(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
  void main(){ vec2 c=vUv-.5; float d=dot(c,c); vec2 off=c*d*0.014;
    vec3 col=vec3(texture2D(tDiffuse,vUv+off).r, texture2D(tDiffuse,vUv).g, texture2D(tDiffuse,vUv-off).b);
    col+=uLift*(1.-smoothstep(0.,0.55,dot(col,vec3(0.333))));
    float r=length(c)*1.414; col*=1.-uVig*smoothstep(0.38,1.1,r);
    col+=(hh(vUv*uRes+fract(uTime)*91.)-.5)*uGrain;
    gl_FragColor=vec4(col,1.); }`,
};
export let composer: EffectComposer, bloom: UnrealBloomPass, finish: ShaderPass;
export const rtMS = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
composer = new EffectComposer(renderer, rtMS);
composer.addPass(new RenderPass(scene, camera));
bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.5, 0.5, 0.85); composer.addPass(bloom);
composer.addPass(new OutputPass());
finish = new ShaderPass(FinishShader); composer.addPass(finish);
export const BLOOM = { base: 0.5, radius: 0.5, thr: 0.85 };

export const G = { W: 1, H: 1, dpr: 1, camD: 2.6, pxu: 800 };
export function resize() {
  G.dpr = Math.min(window.devicePixelRatio || 1, 2); G.W = innerWidth; G.H = innerHeight;
  renderer.setPixelRatio(G.dpr); renderer.setSize(G.W, G.H, false); composer.setPixelRatio(G.dpr); composer.setSize(G.W, G.H);
  camera.aspect = G.W / G.H; camera.updateProjectionMatrix(); finish.uniforms.uRes.value.set(G.W * G.dpr, G.H * G.dpr);
}
