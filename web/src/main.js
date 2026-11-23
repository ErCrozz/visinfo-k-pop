// Stato dell'applicazione, cronologia di navigazione e collegamento tra viste.
import '@fontsource-variable/inter';
import './style.css';
import * as d3 from 'd3';
import { loadGraph, NODE_TYPES, RELS, TYPE_LABEL, REL_LABEL, SUB_LABEL } from './data.js';
import { Renderer } from './renderer.js';
import { egoLayout, hierLayout } from './layouts.js';
import {
  setupFilters, updateFilters, buildLegend, renderDetails, setupSearch, showTip, hideTip,
  renderComponentChart, renderDegreeChart, glyph, swatchColor, fmt,
} from './panels.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const G = await loadGraph();

/* ------------------------------------------------------------------ */
/* Stato                                                               */
/* ------------------------------------------------------------------ */
const initialState = () => ({
  scope: { kind: 'comp', id: 0 },   // componente esplorata in panoramica
  mode: 'overview',                 // overview | ego | hier
  selected: null,                   // nodo selezionato (focus di ego/hier)
  hops: 2,
  colorBy: 'type',
  types: new Set(NODE_TYPES),
  rels: new Set(RELS),
  ambiguous: true,
  minDeg: 0,
  degRange: null,                   // intervallo evidenziato dall'istogramma
  commOnly: null,                   // comunità isolata
  matches: null,                    // risultati della ricerca
});
let state = initialState();
const history = [];
let layout = null; // risultato dell'ultimo layout ego/hier
let preview = null; // anteprima di un chip di filtro: { kind: 'type' | 'rel', v, nodes? }

const snapshot = () => ({ scope: { ...state.scope }, mode: state.mode, selected: state.selected, hops: state.hops, commOnly: state.commOnly });
function navigate(patch, { record = true } = {}) {
  if (record) history.push(snapshot());
  if (history.length > 100) history.shift();
  Object.assign(state, patch);
  apply();
}
function back() {
  const prev = history.pop();
  if (!prev) return;
  Object.assign(state, prev);
  apply();
}

/* ------------------------------------------------------------------ */
/* Predicati di filtro                                                  */
/* ------------------------------------------------------------------ */
const nodeOk = (n) => n === state.selected
  || (state.types.has(n.type) && n.deg >= state.minDeg && (state.commOnly == null || n.comm === state.commOnly));
const edgeOk = (e) => state.rels.has(e.rel) && (state.ambiguous || e.sub !== 'ambiguous');
const scopeNodes = () => (state.scope.kind === 'small'
  ? G.nodes.filter((n) => G.components[n.comp].size <= 3)
  : G.compNodes.get(state.scope.id));

/* ------------------------------------------------------------------ */
/* Renderer                                                            */
/* ------------------------------------------------------------------ */
const canvas = document.getElementById('graph');
const renderer = new Renderer(canvas, {
  onHover(n, ev) {
    if (!n || !ev) { hideTip(); return; }
    const comp = G.components[n.comp];
    showTip(`<div class="t-name">${esc(n.name)}</div>
      <div class="t-row">${glyph(n.macro, swatchColor(n, state.colorBy))}${TYPE_LABEL[n.type]}</div>
      <div class="t-row">Collegamenti <b>${n.deg}</b></div>
      <div class="t-row">Componente <b>#${n.comp + 1}</b> (${fmt(comp.size)} nodi)</div>
      ${layout?.pos.get(n)?.ring ? `<div class="t-row">Distanza dal centro <b>${layout.pos.get(n).ring}</b></div>` : ''}`,
    ev.clientX, ev.clientY);
  },
  onClick(n) { select(n); },
  onBackground() { if (state.mode === 'overview' && state.selected) navigate({ selected: null }); },
});

/** Selezione di un nodo: in panoramica evidenzia, nelle viste focali ricentra. */
function select(n) {
  if (!n) return;
  if (n === state.selected) return;
  const patch = { selected: n };
  if (state.mode === 'overview') {
    const small = G.components[n.comp].size <= 3;
    const inScope = small ? state.scope.kind === 'small' : state.scope.kind === 'comp' && state.scope.id === n.comp;
    if (!inScope) patch.scope = small ? { kind: 'small' } : { kind: 'comp', id: n.comp };
  }
  if (state.commOnly != null && n.comm !== state.commOnly) patch.commOnly = null;
  navigate(patch);
}

/* ------------------------------------------------------------------ */
/* Calcolo della scena                                                  */
/* ------------------------------------------------------------------ */
let visible = [];
let visibleEdges = [];
let visAdj = new Map();
let btwScale = () => 0;
let btwRankMap = new Map();

function apply({ animate = true } = {}) {
  if (state.mode !== 'overview' && !state.selected) state.mode = 'overview';

  let pos = null;
  layout = null;
  if (state.mode === 'overview') {
    visible = scopeNodes().filter(nodeOk);
    const set = new Set(visible);
    visibleEdges = G.edges.filter((e) => set.has(e.s) && set.has(e.t) && edgeOk(e));
  } else {
    layout = state.mode === 'ego'
      ? egoLayout(G, state.selected, state.hops, nodeOk, edgeOk)
      : hierLayout(G, state.selected, nodeOk, edgeOk);
    pos = layout.pos;
    visible = [...pos.keys()];
    visibleEdges = layout.edges;
  }

  const vset = new Set(visible);
  for (const n of G.nodes) {
    const on = vset.has(n);
    if (on) {
      const p = pos ? pos.get(n) : { x: n.x, y: n.y };
      n.tx = p.x; n.ty = p.y;
      if (n.alpha < 0.01) { n.cx = n.tx; n.cy = n.ty; } // chi appare nasce già al suo posto
    } else { n.tx = n.cx; n.ty = n.cy; }
    n.talpha = on ? 1 : 0;
  }

  visAdj = new Map(visible.map((n) => [n, new Set()]));
  for (const e of visibleEdges) { visAdj.get(e.s).add(e.t); visAdj.get(e.t).add(e.s); }

  // centralità: scala sequenziale sul massimo dei nodi visibili (radice: coda lunga)
  const maxB = d3.max(visible, (n) => n.btw) || 1;
  btwScale = d3.scaleSqrt().domain([0, maxB]).range([0, 1]).clamp(true);
  btwRankMap = new Map();
  for (const [c, nodes] of d3.group(G.nodes.filter((n) => n.btw > 0), (n) => n.comp)) {
    nodes.sort((a, b) => b.btw - a.btw).forEach((n, i) => btwRankMap.set(n, i + 1));
  }

  // l'hover si riferisce alla scena precedente: lo azzeriamo
  renderer.hover = null;
  hideTip();
  renderer.setScene(makeScene());
  renderer.animate(G.nodes, animate ? 800 : 0);
  renderer.fit(visible.length ? visible : G.nodes, animate ? 800 : 0);
  updateUI();
}

function makeScene() {
  const T = () => renderer.tokens;
  const sel = state.selected;
  const selNbrs = sel && visAdj.get(sel);
  const interp = () => d3.interpolateLab(T().seqLo, T().seqHi);
  let seq = interp();
  let seqKey = T().seqLo;

  return {
    nodes: G.nodes,
    edges: visibleEdges,
    guides: layout?.guides || [],
    neighborsOf: (n) => visAdj.get(n) || new Set(),
    colorOf(n) {
      const t = T();
      switch (state.colorBy) {
        case 'gender': return n.macro === 'artist' ? t[n.type] : null;
        case 'btw':
          if (seqKey !== t.seqLo) { seq = interp(); seqKey = t.seqLo; }
          return seq(btwScale(n.btw));
        case 'comm': return sel && n.comm === sel.comm ? t.accent : t.neutral;
        default: return t[n.macro];
      }
    },
    emphasis(n) {
      let a = 1;
      const dim = T().dim;
      // anteprima dal chip sotto il puntatore
      if (preview?.kind === 'type' && state.types.has(preview.v) && n.type !== preview.v) a = Math.min(a, dim);
      if (preview?.kind === 'rel' && !preview.nodes.has(n)) a = Math.min(a, dim);
      if (state.degRange && (n.deg < state.degRange[0] || n.deg > state.degRange[1])) a = Math.min(a, dim);
      if (state.matches && !state.matches.has(n)) a = Math.min(a, dim * 1.5);
      if (state.mode === 'overview' && sel && n !== sel && !selNbrs?.has(n)) a = Math.min(a, 0.25);
      return a;
    },
    // nelle viste focali gli archi che non spiegano la struttura restano sullo sfondo
    edgeAlpha: (e) => (layout?.tree && !layout.tree.has(e) ? 0.3 : 1),
    edgeHighlight: (e) => (preview?.kind === 'rel'
      ? e.rel === preview.v
      : state.mode === 'overview' && sel && (e.s === sel || e.t === sel)),
    ringOf: (n) => (n === sel ? 'focus' : state.matches?.has(n) ? 'match' : null),
    labelPriority(n, r) {
      if (n === sel) return 1e8;
      if (state.matches?.has(n) && state.matches.size <= 30) return 2e6 + n.deg;
      if (state.mode === 'overview') {
        if (selNbrs?.has(n)) return 1e5 + n.deg;
        // etichetta solo se il nodo è abbastanza grande sullo schermo (zoom semantico)
        return r.screenRadius(n) >= 3.2 || state.scope.kind === 'small' ? n.deg + 1 : 0;
      }
      const p = layout.pos.get(n);
      if (!p) return 0; // nodo in dissolvenza durante la transizione
      if (state.mode === 'ego') return p.ring <= 1 ? 1e5 + n.deg : n.deg + 1;
      return p.level <= 1 ? 1e5 + n.deg : n.deg + 1;
    },
    labelPlacement: (n) => layout?.pos.get(n) || { lp: 'below' },
  };
}

/* ------------------------------------------------------------------ */
/* Interfaccia                                                          */
/* ------------------------------------------------------------------ */
const $ = (id) => document.getElementById(id);
const modeSeg = $('mode-seg');
const modeButtons = modeSeg.querySelectorAll('button');
const colorButtons = $('color-seg').querySelectorAll('button');
const hops = $('hops');
const minDeg = $('min-deg');
const ambiguous = $('filter-ambiguous');

function counts() {
  const base = state.mode === 'overview' ? scopeNodes() : visible;
  const types = {}, rels = {};
  for (const n of base) types[n.type] = (types[n.type] || 0) + 1;
  const set = new Set(base);
  for (const e of G.edges) if (set.has(e.s) && set.has(e.t)) rels[e.rel] = (rels[e.rel] || 0) + 1;
  return { types, rels };
}

/** Sposta la "pillola" del controllo segmentato sotto il pulsante attivo. */
function moveThumb() {
  const on = modeSeg.querySelector('[aria-checked="true"]');
  const thumb = modeSeg.querySelector('.seg-thumb');
  if (!on) return;
  thumb.style.width = `${on.offsetWidth}px`;
  thumb.style.transform = `translateX(${on.offsetLeft}px)`;
}

function updateUI() {
  modeButtons.forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.mode === state.mode));
    b.disabled = b.dataset.mode !== 'overview' && !state.selected;
  });
  colorButtons.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.color === state.colorBy)));
  hops.hidden = state.mode !== 'ego';
  $('hops-out').textContent = `${state.hops} ${state.hops > 1 ? 'passi' : 'passo'}`;
  hops.querySelector('[data-d="-1"]').disabled = state.hops <= 1;
  hops.querySelector('[data-d="1"]').disabled = state.hops >= 3;
  moveThumb();
  $('btn-back').disabled = !history.length;
  minDeg.value = state.minDeg;
  minDeg.style.setProperty('--p', `${(state.minDeg / +minDeg.max) * 100}%`);
  $('min-deg-out').textContent = state.minDeg ? `≥ ${state.minDeg}` : 'tutti';
  ambiguous.checked = state.ambiguous;

  updateFilters(state, counts());
  buildLegend(state.colorBy, state.selected);
  renderDetails(G, state.selected, state, detailActions);
  renderComponentChart(G, state, (scope) => navigate({ scope, mode: 'overview', selected: null, commOnly: null }));
  renderDegreeChart(visible, state, (range) => { state.degRange = range; renderer.setScene(makeScene()); });

  // briciole di pane e stato
  const sc = state.scope.kind === 'small'
    ? 'Componenti piccole (coppie, triplette, isolati)'
    : `Componente <b>#${state.scope.id + 1}</b> · ${fmt(G.components[state.scope.id].size)} nodi`;
  let crumb = sc;
  if (state.commOnly != null) crumb += ` › comunità di <b>${esc(G.communities.get(state.commOnly)?.hubNode.name ?? '#' + state.commOnly)}</b>`;
  if (state.mode === 'ego') crumb = `Ego radiale di <b>${esc(state.selected.name)}</b>`;
  if (state.mode === 'hier') crumb = `Gerarchia attorno a <b>${esc(state.selected.name)}</b> · ${layout.info.labels} label, ${layout.info.groups} gruppi, ${layout.info.artists} artisti`;
  $('breadcrumb').innerHTML = crumb;
  $('status').textContent = `${fmt(visible.length)} nodi · ${fmt(visibleEdges.length)} archi visibili`;
}

const detailActions = {
  act(a) {
    if (a === 'ego' || a === 'hier') { if (state.mode !== a) navigate({ mode: a }); }
    else if (a === 'clear') navigate({ selected: null, mode: 'overview' });
    else if (a === 'comm') {
      const n = state.selected;
      if (state.commOnly === n.comm) navigate({ commOnly: null });
      else navigate({ commOnly: n.comm, mode: 'overview', scope: G.components[n.comp].size <= 3 ? { kind: 'small' } : { kind: 'comp', id: n.comp } });
    }
  },
  navigate: (m) => select(m),
  preview(m) { renderer.hover = m; renderer.request(); },
  btwRank: (n) => btwRankMap.get(n),
  hubs: () => [...visible].sort((a, b) => b.deg - a.deg).slice(0, 8),
};

/* ---- filtri a chip ---- */
function setPreview(p) {
  preview = p;
  if (p?.kind === 'rel') {
    p.nodes = new Set();
    for (const e of visibleEdges) if (e.rel === p.v) { p.nodes.add(e.s); p.nodes.add(e.t); }
  }
  renderer.setScene(makeScene());
}
const toggle = (set, v) => (set.has(v) ? set.delete(v) : set.add(v));
setupFilters({
  toggleType(t) { toggle(state.types, t); apply(); },
  soloType(t) { state.types = new Set([t]); apply(); },
  allTypes() { state.types = new Set(NODE_TYPES); apply(); },
  toggleRel(r) { toggle(state.rels, r); apply(); setPreview(preview); },
  soloRel(r) { state.rels = new Set([r]); apply(); setPreview(preview); },
  allRels() { state.rels = new Set(RELS); apply(); },
  preview: setPreview,
});

/* ---- controlli ---- */
modeButtons.forEach((b) => b.addEventListener('click', () => {
  if (b.disabled || b.dataset.mode === state.mode) return;
  navigate({ mode: b.dataset.mode });
}));
colorButtons.forEach((b) => b.addEventListener('click', () => {
  state.colorBy = b.dataset.color;
  renderer.setScene(makeScene());
  updateUI();
}));
hops.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
  const h = Math.max(1, Math.min(3, state.hops + +b.dataset.d));
  if (h !== state.hops) navigate({ hops: h });
}));
minDeg.addEventListener('input', () => { state.minDeg = +minDeg.value; apply({ animate: false }); });
ambiguous.addEventListener('change', () => { state.ambiguous = ambiguous.checked; apply(); });
$('btn-back').addEventListener('click', back);
$('btn-fit').addEventListener('click', () => renderer.fit(visible));
$('btn-reset').addEventListener('click', reset);
$('btn-theme').addEventListener('click', () => {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('kpop-theme', root.dataset.theme); } catch { /* storage non disponibile */ }
  renderer.refreshTokens();
  renderer.setScene(makeScene());
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { renderer.refreshTokens(); renderer.setScene(makeScene()); });

/* ---- pannelli richiudibili: il grafo si riadatta allo spazio liberato ---- */
const NARROW = 760;
function updateInsets() {
  const body = document.body;
  const narrow = innerWidth <= NARROW;
  const leftOn = !body.classList.contains('no-left');
  const rightOn = !body.classList.contains('no-right');
  const gap = 14;
  const leftW = $('side-left').offsetWidth, rightW = $('side-right').offsetWidth;
  const dock = document.querySelector('.dock').getBoundingClientRect();
  renderer.insets = {
    l: !narrow && leftOn ? leftW + gap : 0,
    r: !narrow && rightOn ? rightW + gap : 0,
    t: dock.bottom + 24,
    b: narrow ? 0 : 44,
  };
  document.querySelectorAll('.reopen').forEach((b) => { b.hidden = !body.classList.contains(`no-${b.dataset.collapse}`); });
}
function togglePanel(side) {
  document.body.classList.toggle(`no-${side}`);
  updateInsets();
  renderer.fit(visible, 450);
  setTimeout(moveThumb, 400);
}
document.querySelectorAll('[data-collapse]').forEach((b) => b.addEventListener('click', () => togglePanel(b.dataset.collapse)));
window.addEventListener('resize', () => { updateInsets(); moveThumb(); });

const search = setupSearch(G, (n) => { state.matches = null; select(n); }, (set) => { state.matches = set; renderer.setScene(makeScene()); });

function reset() {
  history.length = 0;
  state = initialState();
  preview = null;
  search.clear();
  apply();
}

document.addEventListener('keydown', (ev) => {
  if (ev.target.matches('input:not([type="range"]):not([type="checkbox"]), select, textarea')) return;
  const k = ev.key.toLowerCase();
  if (k === 'backspace') { back(); ev.preventDefault(); }
  else if (k === 'escape') { if (state.selected) navigate({ selected: null, mode: 'overview' }); }
  else if (k === 'r') reset();
  else if (k === 'f') renderer.fit(visible);
  else if (k === '/') { $('search').focus(); ev.preventDefault(); }
  else if (k === 'o' && state.mode !== 'overview') navigate({ mode: 'overview' });
  else if ((k === 'e' || k === 'h') && state.selected) {
    const mode = k === 'e' ? 'ego' : 'hier';
    if (mode !== state.mode) navigate({ mode });
  }
});

try {
  const t = localStorage.getItem('kpop-theme');
  if (t) { document.documentElement.dataset.theme = t; renderer.refreshTokens(); }
} catch { /* storage non disponibile */ }

if (innerWidth <= NARROW) document.body.classList.add('no-left', 'no-right');
updateInsets();
apply({ animate: false });
// il font del canvas arriva dopo il primo disegno: ridisegna etichette e controlli
document.fonts?.ready.then(() => { renderer.request(); moveThumb(); });
// usato solo per il debug da console
window.__kpop = { G, state: () => state, renderer, REL_LABEL, SUB_LABEL };
