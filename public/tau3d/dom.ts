
/* ============================================================ dom handles + tiny pure helpers */
export interface Voice { el: HTMLElement | null; text: string; shown: number; started: boolean; idx: number; last: number }
export interface FeedLine { kind: string; text: string; dim: string; instant: boolean }
export interface FeedRow { it: FeedLine; m: HTMLElement; d: HTMLElement; n: number; len: number }
export interface FeedAgentState { act: boolean; calls: number; tools: number; tok: number; at: number }
export interface Feed {
  on: boolean; lines: FeedLine[]; q: FeedLine[]; el: HTMLElement; inn: HTMLElement; typing: FeedRow | null; seen: Set<string>;
  pre: { ts: number; kind: string; text: string; dim?: string }[]; flushed: boolean; lastLine: number;
  calls: Map<string, number>; prm: Map<string, number>; ag: Map<string, FeedAgentState>;
}

export const $ = (id: string): HTMLElement | null => document.getElementById(id);
export const params = new URLSearchParams(location.search);
export const hudEls = { tok: $('hTokens'), cost: $('hCost'), cache: $('hCache'), ag: $('hAgents'), ses: $('hSess'), home: $('hHome'), scan: $('hScan'), link: $('hLink'), mode: $('hMode'), pal: $('hPal'), iss: $('hIssues'), wait: $('hWait') };
export const setC = (m: { color: { setRGB(r: number, g: number, b: number): unknown } }, c: number[]): void => { m.color.setRGB(c[0], c[1], c[2]); };
export const demoLost = params.get('demo') === 'lost'; // ?demo=lost&lostfor=SECONDS: pretend the link has been down for that long (screenshots)
export const voice: Voice = { el: $('voice'), text: '', shown: 0, started: false, idx: 0, last: 0 };
export const feed: Feed = { on: params.get('feed') === '0' ? false : params.get('feed') === '1' ? true : true, lines: [], q: [], el: $('feed'), inn: $('feedIn'), typing: null, seen: new Set(), pre: [], flushed: false, lastLine: performance.now(), calls: new Map(), prm: new Map(), ag: new Map() };
export const hms = (t: number | string | Date): string => new Date(t).toTimeString().slice(0, 8), hm = (t: number | string | Date): string => hms(t).slice(0, 5);
