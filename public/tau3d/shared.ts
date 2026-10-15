// Shared mutable view state (every module imports S; ES module imports are read-only bindings, so writes go through this object).
import { clamp } from './util.ts';
import { params } from './dom.ts';

export const S = {
  palIdx: 0, refreshMs: 5000,
  mode: clamp((parseInt(params.get('mode'), 10) || 1) - 1, 0, 4),
  sel: 0, hover: -1, frozen: false, hudOn: true, voiceOn: true, pulse7: params.get('w') === '7d',
  detailOpen: false, helpOpen: false, zoom: 1, zoomCur: 1, clockTipStr: '', curAdt: 0,
  T: 0, lastActivity: performance.now(), clockHover: false, rings: [],
  camX: 0, camY: 0, flick: 1, hb: 0, lastAnnounce: 0,
};

// Late-bound function registry: modules register functions that earlier modules need to call (avoids circular imports).
export const H: Record<string, (...a: any[]) => any> = {};
