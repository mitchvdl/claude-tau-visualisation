// Shared mutable view state (every module imports S; ES module imports are read-only bindings, so writes go through this object).
import { clamp } from './util.ts';
import { params } from './dom.ts';
import { PALETTES, specStart } from './palettes.ts';

const KEY = 'tau3d.settings'; // view settings kept in localStorage (URL params still win for screenshots / shared links)
export const saved: { mode?: number; pal?: string; hudOn?: boolean; voiceOn?: boolean; pulse7?: boolean; cfg?: Partial<typeof CFG_DEFAULTS> } = (() => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } })();
export function saveSettings(): void { try { localStorage.setItem(KEY, JSON.stringify({ mode: S.mode, pal: PALETTES[S.palIdx].name, hudOn: S.hudOn, voiceOn: S.voiceOn, pulse7: S.pulse7, cfg: CFG })); } catch { /* storage unavailable */ } }

// Tunable look & feel, edited in the settings panel (settings.ts) and saved with the other settings.
export const CFG_DEFAULTS = {
  breath: 1, spikeHeight: 1.5, autoHeight: 1, spikeFraction: 0.08, autoFraction: 1, spikeSpeed: 1, autoSpeed: 1, signalLoss: 1, signalSpeed: 1, signalJitter: 0.8, motion: 1, camDrift: 1, bloom: 1, fps: 60, spectrumPeriod: 120, rectFrom: 0.3, blockW: 0.45,
  bootScreen: true, agentBox: true, agentStack: 4, agentOut: true, agentOpacity: 0.6, agentSpeed: 1,
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
  privacy: false, pulse: 0, spikeAct: 0, spikeT: 0, sig: 0, lt: 0, glitch: 0, jit: 1, standby: 0, flash: 0, freeze: 0, Td: 0, stutterUntil: 0, // signal-loss state (see signal.ts): effect level, standby dim, reconnect flash, data-freeze level, frozen data clock
};

// incoming activity (calls, new agents, prompts) feeds S.pulse; update.ts turns it into S.spikeAct for the auto-spike effect
export const bumpActivity = (x: number): void => { S.pulse = Math.min(1.2, S.pulse + x); };

// privacy mode (key P): blurs titles, prompts, paths and agent text. The flag is shared with the dashboard through localStorage.
const PRIV_KEY = 'claude-stats-privacy';
const readPriv = (): boolean => { try { return localStorage.getItem(PRIV_KEY) === '1'; } catch { return false; } };
const applyPriv = (on: boolean): void => { S.privacy = on; document.body.classList.toggle('privacy', on); };
export function setPrivacy(on?: boolean): void { const v = on === undefined ? !S.privacy : on; applyPriv(v); try { localStorage.setItem(PRIV_KEY, v ? '1' : '0'); } catch { /* storage unavailable */ } }
applyPriv(params.has('privacy') ? params.get('privacy') === '1' : readPriv());
addEventListener('storage', (e) => { if (e.key === PRIV_KEY) applyPriv(e.newValue === '1'); });

// Late-bound function registry: modules register functions that earlier modules need to call (avoids circular imports).
export const H: Record<string, (...a: any[]) => any> = {};
