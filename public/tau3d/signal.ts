import { CFG, H, S } from './shared.ts';
import { $, demoLost, hudEls, voice } from './dom.ts';
import { clamp } from './util.ts';
import { data } from './data.ts';

/* ============================================================ signal loss: staged glitch + frozen memory + typography */
// stage by how long the link has been down: <3 s light glitch, 3-15 s ramps up with banner, >15 s full effect plus standby dim
const banner = $('siglost'), frameEl = $('sigframe'), GLYPHS = '▓▒░█#/\\|<>=+';
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export const lostFor = () => (data.lost ? (Date.now() - data.lostSince) / 1000 : 0);
let bannerTxt = '', msgIdx = 0, nextEv = 0, evEnd = 0, evAmp = 0, rate = 1, rateT = 1, nextDip = 0, nextHDip = 0;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

export function tickSignal(dt: number) {
  const lf = lostFor(); let target = 0;
  if (data.lost) target = lf < 3 ? 0.35 : lf < 15 ? 0.35 + 0.65 * ((lf - 3) / 12) : 1;
  S.sig += (target - S.sig) * (1 - Math.exp(-dt / (target > S.sig ? 0.8 : 0.5)));
  S.standby += ((data.lost && lf >= 15 ? 1 : 0) - S.standby) * (1 - Math.exp(-dt / 2));
  S.flash = Math.max(0, S.flash - dt * 1.4);
  S.freeze = clamp(S.sig * CFG.signalLoss * 1.4, 0, 1);
  // irregular timing: the glitch clock speed random-walks, and glitches come as bursts at random intervals (jitter 0 = steady)
  const j = CFG.signalJitter, spd = Math.max(0.1, CFG.signalSpeed), now = performance.now() / 1000;
  if (Math.random() < dt * 1.5) rateT = rnd(0.15, 2.8);
  rate += (rateT - rate) * (1 - Math.exp(-dt / 0.25));
  S.lt += dt * spd * (1 + j * (rate - 1));
  if (S.sig > 0.05 && now > nextEv) { evEnd = now + rnd(0.08, 0.9); evAmp = rnd(0.5, 1); nextEv = evEnd + ((1 - j) * 1.2 + j * rnd(0.25, 5 - 3.2 * S.sig)) / spd; }
  S.glitch += ((now < evEnd ? evAmp : 0) - S.glitch) * (1 - Math.exp(-dt / (now < evEnd ? 0.03 : 0.25)));
  S.jit = (1 - j) + j * (0.15 + 0.85 * S.glitch);
  const show = data.lost && lf >= 3;
  if (show && now > nextDip) { banner.classList.add('dip'); setTimeout(() => banner.classList.remove('dip'), rnd(50, 220)); nextDip = now + rnd(0.3, 3.2) / spd; }
  if (S.sig > 0.3 && now > nextHDip) { $('hud').classList.add('hdip'); setTimeout(() => $('hud').classList.remove('hdip'), rnd(40, 180)); nextHDip = now + rnd(0.25, 2.6) / spd; }
  if (show) { const t = `▲ NO SIGNAL · ${mmss(lf)}\nmemory frozen at ${new Date(data.lastOk || data.lostSince).toLocaleTimeString([], { hour12: false })} · retrying`; if (t !== bannerTxt) { bannerTxt = t; banner.textContent = t; } }
  banner.classList.toggle('on', show); frameEl.classList.toggle('on', show);
}

// HUD numbers: digits flicker to dashes / random digits while the link is down (updateHud stores the true text in data-real)
const HUD_VALUES = [hudEls.tok, hudEls.cost, hudEls.cache, hudEls.ag, hudEls.ses, hudEls.scan];
const later = (fn: () => void, lo: number, hi: number) => { const go = () => { fn(); setTimeout(go, rnd(lo, hi) / Math.max(0.1, CFG.signalSpeed)); }; setTimeout(go, rnd(lo, hi)); }; // self-rescheduling timer with a random gap
later(() => {
  const p = data.lost ? (0.1 + 0.45 * S.sig) * (0.3 + 0.7 * S.jit) : 0;
  for (const el of HUD_VALUES) {
    const real = el.dataset.real; if (real == null) continue;
    if (p > 0.12) { el.dataset.scr = '1'; el.textContent = real.replace(/\d/g, (d) => (Math.random() < p ? (Math.random() < 0.45 ? '-' : String(Math.floor(Math.random() * 10))) : d)); }
    else if (el.dataset.scr) { el.textContent = real; delete el.dataset.scr; }
  }
}, 60, 340);

// voice line: while down it cycles status messages and the letters corrupt now and then
const lostMsgs = () => ['Signal lost. Searching...', `No carrier. Memory frozen at ${new Date(data.lastOk || data.lostSince).toLocaleTimeString([], { hour12: false })}.`, `Retrying link · ${mmss(lostFor())}`];
later(() => {
  if (!data.lost) return;
  const done = voice.shown >= voice.text.length;
  if (done && performance.now() - voice.last > 5000) { const m = lostMsgs(); msgIdx = (msgIdx + 1) % m.length; H.say(m[msgIdx]); return; }
  if (done && S.sig > 0.1) { const p = (0.02 + 0.07 * S.sig) * (0.2 + 0.8 * S.jit); voice.el.textContent = voice.text.replace(/[^\s]/g, (c) => (Math.random() < p ? GLYPHS[Math.floor(Math.random() * GLYPHS.length)] : c)); }
}, 50, 260);
void demoLost;
