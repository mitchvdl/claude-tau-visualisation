import { clamp, mix } from './util.ts';

/* ============================================================ palettes + model identity */
export interface Palette { name: string; frame: number[]; core: number[]; hot: number[]; dim: number[]; bgBase: number[]; bgVein: number[]; lift: number[]; grain: number }
export type PalKey = 'frame' | 'core' | 'hot' | 'dim' | 'bgBase' | 'bgVein' | 'lift';
export const PALETTES: Palette[] = [
  { name: 'TAU', frame: [255, 42, 30], core: [255, 150, 40], hot: [255, 228, 160], dim: [255, 84, 36], bgBase: [0.052, 0.032, 0.026], bgVein: [0.95, 0.52, 0.14], lift: [0, 0, 0], grain: 0 },
  { name: 'ICE', frame: [40, 210, 255], core: [100, 220, 255], hot: [225, 250, 255], dim: [40, 120, 255], bgBase: [0.026, 0.040, 0.052], bgVein: [0.55, 0.85, 1.0], lift: [0, 0, 0], grain: 0 },
  { name: 'VIOLET', frame: [170, 70, 255], core: [220, 130, 255], hot: [248, 225, 255], dim: [120, 60, 255], bgBase: [0.040, 0.028, 0.060], bgVein: [0.80, 0.55, 1.0], lift: [0, 0, 0], grain: 0 },
  // NAVY: film look - dark navy marble, pale bluish veins, grainy grey floor, cool grade; core stays warm, triangle stays red neon
  { name: 'NAVY', frame: [255, 42, 30], core: [255, 150, 40], hot: [255, 228, 160], dim: [255, 84, 36], bgBase: [0.011, 0.030, 0.105], bgVein: [0.72, 0.86, 1.0], lift: [0.004, 0.014, 0.042], grain: 1 },
];
export const palIndexOf = (v: string | number | null): number => { if (v == null) return 0; const i = PALETTES.findIndex((q) => q.name.toLowerCase() === String(v).toLowerCase()); return i >= 0 ? i : clamp(parseInt(String(v), 10) || 0, 0, PALETTES.length - 1); };
export const PAL_KEYS: PalKey[] = ['frame', 'core', 'hot', 'dim', 'bgBase', 'bgVein', 'lift'];
export const pal: Palette = JSON.parse(JSON.stringify(PALETTES[0]));
export const FAMILY: Record<string, number[]> = { fable: [255, 90, 200], opus: [255, 80, 50], sonnet: [255, 190, 55], haiku: [110, 225, 255], other: [200, 190, 170] };
export const famOf = (m: string): string => { m = String(m || '').toLowerCase(); for (const k of ['fable', 'opus', 'sonnet', 'haiku']) if (m.includes(k)) return k; return 'other'; };
export const modelColorCache = new Map<string, number[]>(); export const famSeen: Record<string, number> = {};
export function modelColor(m: string): number[] {
  if (!modelColorCache.has(m)) { const f = famOf(m); const n = famSeen[f] = (famSeen[f] || 0) + 1; modelColorCache.set(m, n === 1 ? FAMILY[f] : mix(FAMILY[f], n % 2 ? [255, 255, 255] : [60, 30, 20], 0.35)); }
  return modelColorCache.get(m);
}
