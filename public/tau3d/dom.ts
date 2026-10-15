// @ts-nocheck - TODO(types): remove once this module is typed


/* ============================================================ dom handles + tiny pure helpers */
export const $ = (id) => document.getElementById(id);
export const params = new URLSearchParams(location.search);
export const hudEls = { tok: $('hTokens'), cost: $('hCost'), cache: $('hCache'), ag: $('hAgents'), ses: $('hSess'), home: $('hHome'), scan: $('hScan'), link: $('hLink'), mode: $('hMode'), pal: $('hPal'), iss: $('hIssues'), wait: $('hWait') };
export const setC = (m, c) => { m.color.setRGB(c[0], c[1], c[2]); };
export const voice = { el: $('voice'), text: '', shown: 0, started: false, idx: 0, last: 0 };
export const feed = { on: params.get('feed') === '0' ? false : params.get('feed') === '1' ? true : true, lines: [], q: [], el: $('feed'), inn: $('feedIn'), typing: null, seen: new Set(), pre: [], flushed: false, lastLine: performance.now(), calls: new Map(), prm: new Map(), ag: new Map() };
export const hms = (t) => new Date(t).toTimeString().slice(0, 8), hm = (t) => hms(t).slice(0, 5);
