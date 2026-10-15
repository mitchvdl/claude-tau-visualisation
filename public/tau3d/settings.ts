// Settings panel (key O): tunable look / motion / interface options. Built lazily on first open from one declarative item list.
// Every change applies immediately and is saved to localStorage (saveSettings in shared.ts).
import { CFG, CFG_DEFAULTS, S, saveSettings } from './shared.ts';
import type { CfgKey } from './shared.ts';
import { $, feed, hudEls } from './dom.ts';
import { feedToggle } from './feed.ts';
import { PALETTES } from './palettes.ts';

type CfgNum = { [K in CfgKey]: (typeof CFG_DEFAULTS)[K] extends number ? K : never }[CfgKey];
type CfgBool = { [K in CfgKey]: (typeof CFG_DEFAULTS)[K] extends boolean ? K : never }[CfgKey];

interface Base { group: string; label: string; note?: string }
interface RangeItem extends Base { kind: 'range'; min: number; max: number; step: number; fmt: (v: number) => string; get: () => number; set: (v: number) => void }
interface ToggleItem extends Base { kind: 'toggle'; get: () => boolean; set: (v: boolean) => void }
interface SelectItem extends Base { kind: 'select'; options: { value: string; label: string }[]; get: () => string; set: (v: string) => void }
type Item = RangeItem | ToggleItem | SelectItem;
interface Row { item: Item; ctl: HTMLInputElement | HTMLSelectElement; out: HTMLElement }

/* ---- formatters + item helpers */
const f2 = (v: number): string => v.toFixed(2);
const pct = (v: number): string => Math.round(v * 100) + '%';
const num = (group: string, label: string, key: CfgNum, min: number, max: number, step: number, fmt: (v: number) => string, note?: string): RangeItem =>
  ({ group, label, note, kind: 'range', min, max, step, fmt, get: () => CFG[key], set: (v) => { CFG[key] = v; } });
const bool = (group: string, label: string, key: CfgBool, note?: string): ToggleItem =>
  ({ group, label, note, kind: 'toggle', get: () => CFG[key], set: (v) => { CFG[key] = v; } });

/* ---- the items, in display order (group = section title) */
const ITEMS: Item[] = [
  { group: 'Look', label: 'Palette', kind: 'select', options: PALETTES.map((p, i) => ({ value: String(i), label: p.name })),
    get: () => String(S.palIdx), set: (v) => { S.palIdx = Number(v); if (hudEls.pal) hudEls.pal.textContent = PALETTES[S.palIdx].name; } },
  num('Look', 'Spectrum lap (s)', 'spectrumPeriod', 20, 600, 10, (v) => v + ' s', 'seconds for one lap of the SPECTRUM colour wheel'),
  num('Look', 'Bloom', 'bloom', 0.3, 1.8, 0.05, f2),
  num('Look', 'Breathing', 'breath', 0, 2, 0.05, f2),
  num('Look', 'Bar width', 'blockW', 0.15, 1, 0.05, f2),
  num('Look', 'Blocks start at', 'rectFrom', 0, 1, 0.05, pct, 'rings from this fraction outward use rectangular bars'),
  { group: 'Motion', label: 'Motion speed', kind: 'range', min: 0, max: 1.5, step: 0.05, fmt: f2, get: () => CFG.motion, set: (v) => { CFG.motion = v; } },
  { group: 'Motion', label: 'Signal-loss effect', kind: 'range', min: 0, max: 1.5, step: 0.05, fmt: f2, get: () => CFG.signalLoss, set: (v) => { CFG.signalLoss = v; } },
  { group: 'Motion', label: 'Signal-loss speed', kind: 'range', min: 0.3, max: 3, step: 0.1, fmt: (v: number) => v.toFixed(1) + '×', get: () => CFG.signalSpeed, set: (v) => { CFG.signalSpeed = v; } },
  { group: 'Motion', label: 'Signal-loss jitter', kind: 'range', min: 0, max: 1, step: 0.05, fmt: f2, get: () => CFG.signalJitter, set: (v) => { CFG.signalJitter = v; } },
  { group: 'Motion', label: 'Camera drift', kind: 'range', min: 0, max: 2, step: 0.05, fmt: f2, get: () => CFG.camDrift, set: (v) => { CFG.camDrift = v; } },
  { group: 'Motion', label: 'Frame rate', kind: 'select', options: [{ value: '30', label: '30 fps' }, { value: '60', label: '60 fps' }],
    get: () => String(CFG.fps), set: (v) => { CFG.fps = Number(v); } },
  { group: 'Interface', label: 'HUD', kind: 'toggle', get: () => S.hudOn, set: (v) => { S.hudOn = v; $('hud')?.classList.toggle('off', !v); } },
  { group: 'Interface', label: 'Voice line', kind: 'toggle', get: () => S.voiceOn, set: (v) => { S.voiceOn = v; $('voice')?.classList.toggle('off', !v); } },
  { group: 'Interface', label: 'Terminal feed', kind: 'toggle', get: () => feed.on, set: (v) => { feedToggle(v); } },
  bool('Interface', 'Agent box', 'agentBox'),
  bool('Interface', 'Agent output text', 'agentOut'),
  num('Interface', 'Agent box opacity', 'agentOpacity', 0.2, 1, 0.05, f2),
  num('Interface', 'Agent scroll speed', 'agentSpeed', 0.3, 3, 0.1, (v) => v.toFixed(1) + '×'),
];

/* ---- DOM helpers + readouts */
function mk<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e;
}
function readText(it: Item): string {
  if (it.kind === 'range') return it.fmt(it.get());
  if (it.kind === 'toggle') return it.get() ? 'ON' : 'OFF';
  const v = it.get(); return (it.options.find((o) => o.value === v) || { label: v }).label;
}
function makeControl(it: Item): { node: HTMLElement; ctl: HTMLInputElement | HTMLSelectElement } {
  if (it.kind === 'select') {
    const sel = mk('select', 'sx-sel');
    for (const o of it.options) { const op = mk('option', '', o.label); op.value = o.value; sel.append(op); }
    return { node: sel, ctl: sel };
  }
  if (it.kind === 'range') {
    const inp = mk('input'); inp.type = 'range'; inp.min = String(it.min); inp.max = String(it.max); inp.step = String(it.step);
    return { node: inp, ctl: inp };
  }
  const lab = mk('label', 'sx-sw'), inp = mk('input'), knob = mk('span');
  inp.type = 'checkbox'; lab.append(inp, knob);
  return { node: lab, ctl: inp };
}
function syncRow(r: Row): void {
  const it = r.item;
  if (it.kind === 'range') (r.ctl as HTMLInputElement).value = String(it.get());
  else if (it.kind === 'toggle') (r.ctl as HTMLInputElement).checked = it.get();
  else r.ctl.value = it.get();
  r.out.textContent = readText(it);
}
function commit(r: Row): void { // a control changed: apply to the live state, refresh the readout, save
  const it = r.item;
  if (it.kind === 'range') it.set(parseFloat((r.ctl as HTMLInputElement).value));
  else if (it.kind === 'toggle') it.set((r.ctl as HTMLInputElement).checked);
  else it.set(r.ctl.value);
  r.out.textContent = readText(it); saveSettings();
}

/* ---- panel */
let built = false;
const rows: Row[] = [];
function resetDefaults(): void {
  Object.assign(CFG, CFG_DEFAULTS);
  S.hudOn = true; S.voiceOn = true; $('hud')?.classList.toggle('off', false); $('voice')?.classList.toggle('off', false);
  if (!feed.on) feedToggle(true);
  syncSettings(); saveSettings(); // palette is deliberately left alone
}
function build(root: HTMLElement): void {
  if (built) return; built = true;
  // keys typed into the panel's inputs stay there, except Escape and O (those still reach the global handler)
  root.addEventListener('keydown', (e) => {
    const t = e.target;
    if ((t instanceof HTMLInputElement || t instanceof HTMLSelectElement) && e.key !== 'Escape' && e.key !== 'o' && e.key !== 'O') e.stopPropagation();
  });
  const head = mk('div', 'sx-head'), x = mk('button', 'sx-x', '×');
  x.type = 'button'; x.setAttribute('aria-label', 'Close settings'); x.addEventListener('click', () => openSettings(false));
  head.append(mk('h2', 'sx-title', 'SETTINGS'), x);

  const body = mk('div', 'sx-body'), groups = new Map<string, HTMLElement>();
  for (const it of ITEMS) {
    let g = groups.get(it.group);
    if (!g) { g = mk('section', 'sx-grp'); g.append(mk('h3', 'sx-gt', it.group)); groups.set(it.group, g); body.append(g); }
    const row = mk('div', 'sx-row'), hd = mk('div', 'sx-hd'), out = mk('span', 'sx-v');
    hd.append(mk('span', 'sx-l', it.label), out);
    const { node, ctl } = makeControl(it);
    row.append(hd, node);
    if (it.note) row.append(mk('div', 'sx-note', it.note));
    const r: Row = { item: it, ctl, out }; rows.push(r);
    ctl.addEventListener('input', () => commit(r));
    g.append(row);
  }

  const foot = mk('div', 'sx-foot'), reset = mk('button', 'sx-btn', 'Reset to defaults');
  reset.type = 'button'; reset.addEventListener('click', resetDefaults);
  foot.append(reset, mk('div', 'sx-fh', 'O or Esc closes · saved in this browser'));
  root.append(head, body, foot);
}

export function openSettings(on?: boolean): void {
  const root = $('settings'); if (!root) return;
  const open = on === undefined ? root.hidden : on;
  if (open) { build(root); syncSettings(); }
  root.hidden = !open;
}
export function settingsOpen(): boolean { const root = $('settings'); return !!root && !root.hidden; }
export function syncSettings(): void { for (const r of rows) syncRow(r); }
