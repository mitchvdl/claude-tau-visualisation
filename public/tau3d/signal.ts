import { CFG, H, S } from './shared.ts';
import { $, demoLost, hudEls, voice } from './dom.ts';
import { clamp } from './util.ts';
import { data } from './data.ts';

/* ============================================================ signal loss: staged glitch + frozen memory + typography */
// stage by how long the link has been down: <3 s light glitch, 3-15 s ramps up with banner, >15 s full effect plus standby dim
const banner = $('siglost'), frameEl = $('sigframe'), GLYPHS = '▓▒░█#/\\|<>=+';
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const lostFor = () => (data.lost ? (Date.now() - data.lostSince) / 1000 : 0);
let bannerTxt = '', msgIdx = 0;

export function tickSignal(dt: number) {
  const lf = lostFor(); let target = 0;
  if (data.lost) target = lf < 3 ? 0.35 : lf < 15 ? 0.35 + 0.65 * ((lf - 3) / 12) : 1;
  S.sig += (target - S.sig) * (1 - Math.exp(-dt / (target > S.sig ? 0.8 : 0.5)));
  S.standby += ((data.lost && lf >= 15 ? 1 : 0) - S.standby) * (1 - Math.exp(-dt / 2));
  S.flash = Math.max(0, S.flash - dt * 1.4);
  S.freeze = clamp(S.sig * CFG.signalLoss * 1.4, 0, 1);
  const show = data.lost && lf >= 3;
  if (show) { const t = `▲ NO SIGNAL · ${mmss(lf)}\nmemory frozen at ${new Date(data.lastOk || data.lostSince).toLocaleTimeString([], { hour12: false })} · retrying`; if (t !== bannerTxt) { bannerTxt = t; banner.textContent = t; } }
  banner.classList.toggle('on', show); frameEl.classList.toggle('on', show);
  $('hud').classList.toggle('sigloss', S.sig > 0.3);
}

// HUD numbers: digits flicker to dashes / random digits while the link is down (updateHud stores the true text in data-real)
const HUD_VALUES = [hudEls.tok, hudEls.cost, hudEls.cache, hudEls.ag, hudEls.ses, hudEls.scan];
setInterval(() => {
  const p = data.lost ? 0.1 + 0.45 * S.sig : 0;
  for (const el of HUD_VALUES) {
    const real = el.dataset.real; if (real == null) continue;
    if (p > 0.12) { el.dataset.scr = '1'; el.textContent = real.replace(/\d/g, (d) => (Math.random() < p ? (Math.random() < 0.45 ? '-' : String(Math.floor(Math.random() * 10))) : d)); }
    else if (el.dataset.scr) { el.textContent = real; delete el.dataset.scr; }
  }
}, 110);

// voice line: while down it cycles status messages and the letters corrupt now and then
const lostMsgs = () => ['Signal lost. Searching...', `No carrier. Memory frozen at ${new Date(data.lastOk || data.lostSince).toLocaleTimeString([], { hour12: false })}.`, `Retrying link · ${mmss(lostFor())}`];
setInterval(() => {
  if (!data.lost) return;
  const done = voice.shown >= voice.text.length;
  if (done && performance.now() - voice.last > 5000) { const m = lostMsgs(); msgIdx = (msgIdx + 1) % m.length; H.say(m[msgIdx]); return; }
  if (done && S.sig > 0.1) { const p = 0.02 + 0.07 * S.sig; voice.el.textContent = voice.text.replace(/[^\s]/g, (c) => (Math.random() < p ? GLYPHS[Math.floor(Math.random() * GLYPHS.length)] : c)); }
}, 90);
void demoLost;
