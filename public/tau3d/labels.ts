import type * as THREE from 'three';
import { H } from './shared.ts';
import { clamp, rgba } from './util.ts';
import { $ } from './dom.ts';
import { camera } from './scene.ts';
import { G } from './post.ts';

/* ============================================================ HTML label layer (projected from 3D) */
// pooled label element (custom fields cache the last text / warn state)
export interface LabelEl extends HTMLDivElement { _t?: string; _w?: boolean; _on?: boolean }
export interface LabelOpts { warn?: boolean; edge?: THREE.Vector3[] }
export interface Label { txt: string; pos: THREE.Vector3; a: number; col: number[]; size: number; o: LabelOpts }
export const lblEl = $('lbls'); export const lblPool: LabelEl[] = []; export let lblQ: Label[] = [];
export function label(txt: string, pos: THREE.Vector3, a: number, col: number[], size: number, o?: LabelOpts) { lblQ.push({ txt, pos, a, col, size, o: o || {} }); }
export function flushLabels() {
  const W = G.W, H = G.H, fs = clamp(G.pxu * 0.021, 9, 13);
  const scr = (p: THREE.Vector3): number[] => { const q = p.clone().project(camera); return [(q.x * 0.5 + 0.5) * W, (-q.y * 0.5 + 0.5) * H, q.z]; };
  lblQ.forEach((l, i) => {
    let el = lblPool[i]; if (!el) { el = document.createElement('div'); el.className = 'lbl'; lblEl.append(el); lblPool[i] = el; }
    if (el._t !== l.txt) { el.textContent = l.txt; el._t = l.txt; }
    const warn = !!l.o.warn; if (el._w !== warn) { el.classList.toggle('warn', warn); el._w = warn; }
    const [x, y] = scr(l.pos); let ang = 0;
    if (l.o.edge) { const a = scr(l.o.edge[0]), b = scr(l.o.edge[1]); ang = Math.atan2(b[1] - a[1], b[0] - a[0]); if (Math.cos(ang) < -0.01 || (Math.abs(Math.cos(ang)) < 0.01 && Math.sin(ang) < 0)) ang += Math.PI; }
    el.style.display = 'block'; el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px) translate(-50%,-50%) rotate(${ang.toFixed(4)}rad)`;
    el.style.opacity = clamp(l.a, 0, 1).toFixed(3); el.style.color = rgba(l.col, 1); el.style.fontSize = (warn ? fs * 2.1 : Math.round(fs * l.size)) + 'px';
  });
  for (let i = lblQ.length; i < lblPool.length; i++) if (lblPool[i]._on !== false) { lblPool[i].style.display = 'none'; }
  lblQ = [];
}

// late-bound for callers in earlier modules (see shared.ts H)
Object.assign(H, { label });
