// Shared mutable view state (every module imports S; ES module imports are read-only bindings, so writes go through this object).
import { clamp } from './util.ts';
import { params } from './dom.ts';
import { PALETTES, specStart } from './palettes.ts';

const KEY = 'tau3d.settings'; // view settings kept in localStorage (URL params still win for screenshots / shared links)
export const saved: { mode?: number; pal?: string; hudOn?: boolean; voiceOn?: boolean; pulse7?: boolean; cfg?: Partial<typeof CFG_DEFAULTS> } = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } })();
export function saveSettings(): void { try { localStorage.setItem(KEY, JSON.stringify({ mode: S.mode, pal: PALETTES[S.palIdx].name, hudOn: S.hudOn, voiceOn: S.voiceOn, pulse7: S.pulse7, cfg: CFG })); } catch { /* storage unavailable */ } }

// Tunable look & feel, edited in the settings panel (settings.ts) and saved with the other settings.
export const CFG_DEFAULTS = {
  breath: 1, motion: 1, camDrift: 1, bloom: 1, fps: 60, spectrumPeriod: 120, rectFrom: 0.3, blockW: 0.45,
  agentBox: true, agentOut: true, agentOpacity: 0.6, agentSpeed: 1,
};
export type CfgKey = keyof typeof CFG_DEFAULTS;
export const CFG: typeof CFG_DEFAULTS = { ...CFG_DEFAULTS };
for (const k of Object.keys(CFG_DEFAULTS) as CfgKey[]) { const v = saved.cfg && saved.cfg[k]; if (typeof v === typeof CFG_DEFAULTS[k]) (CFG as any)[k] = v; }

export const S = {
  palIdx: 0, refreshMs: 5000,
  mode: params.has('mode') ? clamp((parseInt(params.get('mode') ?? '', 10) || 1) - 1, 0, 4) : clamp(Number.isInteger(saved.mode) ? (saved.mode as number) : 0, 0, 4),
  sel: 0, hover: -1, frozen: false, hudOn: saved.hudOn !== false, voiceOn: saved.voiceOn !== false, pulse7: params.has('w') ? params.get('w') === '7d' : saved.pulse7 === true,
  detailOpen: false, helpOpen: false, zoom: 1, zoomCur: 1, clockTipStr: '', curAdt: 0,
  T: 0, lastActivity: performance.now(), clockHover: false, rings: [] as any[], // TODO(types): Ring
  camX: 0, camY: 0, flick: 1, hb: 0, lastAnnounce: 0, hue: specStart,
};

// Late-bound function registry: modules register functions that earlier modules need to call (avoids circular imports).
export const H: Record<string, (...a: any[]) => any> = {};
