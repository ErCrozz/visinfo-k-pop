// Pannelli: chip di filtro, legenda, dettagli, ricerca e viste coordinate (SVG con D3).
import * as d3 from 'd3';
import { TYPE_LABEL, NODE_TYPES, REL_LABEL, REL_DESC, RELS, SUB_LABEL } from './data.js';
import { EDGE_DASH } from './renderer.js';

export const fmt = d3.formatLocale({ decimal: ',', thousands: '.', grouping: [3], currency: ['', ' €'] }).format(',');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const CHIP_LABEL = { female: 'Donne', male: 'Uomini', person: 'Genere n.d.', group: 'Gruppi', label: 'Label' };
const REL_CHIP = { membership: 'Appartenenza', management: 'Management', collaboration: 'Collaborazione', label: 'Tra label' };
const macroOf = (t) => (t === 'group' || t === 'label' ? t : 'artist');

/** Glifo SVG del nodo: la forma codifica la macro-categoria (ridondante rispetto al colore). */
export function glyph(macro, fill, stroke = 'none') {
  const f = fill || 'none';
  const s = fill ? stroke : 'var(--text-muted)';
  const sw = fill ? 0 : 1.5;
  let shape;
  if (macro === 'group') shape = `<rect x="2.5" y="2.5" width="9" height="9" rx="1" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`;
  else if (macro === 'label') shape = `<path d="M7 1 L13 7 L7 13 L1 7 Z" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`;
  else shape = `<circle cx="7" cy="7" r="5" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`;
  return `<svg class="glyph" viewBox="0 0 14 14" aria-hidden="true">${shape}</svg>`;
}

export function edgeGlyph(rel) {
  const dash = EDGE_DASH[rel].join(' ');
  return `<svg class="edge-glyph" viewBox="0 0 24 10" aria-hidden="true"><line x1="1" y1="5" x2="23" y2="5" stroke="currentColor" stroke-width="1.7" stroke-dasharray="${dash}" stroke-linecap="${rel === 'collaboration' ? 'round' : 'butt'}"/></svg>`;
}

/** Colore "di identità" per i glifi nei pannelli, coerente con la modalità colore. */
export function swatchColor(n, colorBy) {
  if (colorBy === 'gender') return n.macro === 'artist' ? `var(--c-${n.type})` : null;
  if (colorBy === 'type') return `var(--c-${n.macro})`;
  return 'var(--c-neutral)';
}
function typeColor(t, colorBy) {
  if (colorBy === 'gender') return macroOf(t) === 'artist' ? `var(--c-${t})` : null;
  if (colorBy === 'type') return `var(--c-${macroOf(t)})`;
  return 'var(--c-neutral)';
}

/* ------------------------------------------------------------------ */
/* Chip di filtro: clic = accendi/spegni, doppio clic = solo questo,    */
/* hover = anteprima nel grafo. Nella modalità categoriale i chip dei   */
/* tipi sono anche la legenda.                                           */
/* ------------------------------------------------------------------ */
function bindChip(el, { toggle, solo, preview }) {
  let timer = 0;
  // il clic singolo attende un istante: se arriva il doppio clic vince "solo"
  el.addEventListener('click', () => { clearTimeout(timer); timer = setTimeout(toggle, 200); });
  el.addEventListener('dblclick', () => { clearTimeout(timer); solo(); });
  el.addEventListener('mouseenter', () => preview(true));
  el.addEventListener('mouseleave', () => preview(false));
  el.addEventListener('focus', () => preview(true));
  el.addEventListener('blur', () => preview(false));
}

export function setupFilters(h) {
  const types = document.getElementById('filter-types');
  types.innerHTML = NODE_TYPES.map((t) =>
    `<button class="chip" data-type="${t}" aria-pressed="true" title="${TYPE_LABEL[t]}"><span class="g"></span><span>${CHIP_LABEL[t]}</span><span class="count"></span></button>`).join('');
  types.querySelectorAll('.chip').forEach((el) => {
    const t = el.dataset.type;
    bindChip(el, { toggle: () => h.toggleType(t), solo: () => h.soloType(t), preview: (on) => h.preview(on ? { kind: 'type', v: t } : null) });
  });

  const rels = document.getElementById('filter-rels');
  rels.innerHTML = RELS.map((r) =>
    `<button class="chip rel" data-rel="${r}" aria-pressed="true" title="${REL_LABEL[r]}: ${REL_DESC[r]}">${edgeGlyph(r)}<span>${REL_CHIP[r]}</span><span class="count"></span></button>`).join('');
  rels.querySelectorAll('.chip').forEach((el) => {
    const r = el.dataset.rel;
    bindChip(el, { toggle: () => h.toggleRel(r), solo: () => h.soloRel(r), preview: (on) => h.preview(on ? { kind: 'rel', v: r } : null) });
  });

  document.getElementById('types-all').addEventListener('click', h.allTypes);
  document.getElementById('rels-all').addEventListener('click', h.allRels);
}

export function updateFilters(state, counts) {
  document.querySelectorAll('#filter-types .chip').forEach((el) => {
    const t = el.dataset.type;
    const c = typeColor(t, state.colorBy);
    el.setAttribute('aria-pressed', String(state.types.has(t)));
    el.style.setProperty('--chip-c', c || 'var(--text-muted)');
    el.querySelector('.g').innerHTML = glyph(macroOf(t), c);
    el.querySelector('.count').textContent = fmt(counts.types[t] || 0);
  });
  document.querySelectorAll('#filter-rels .chip').forEach((el) => {
    const r = el.dataset.rel;
    el.setAttribute('aria-pressed', String(state.rels.has(r)));
    el.querySelector('.count').textContent = fmt(counts.rels[r] || 0);
  });
  document.getElementById('types-all').hidden = state.types.size === NODE_TYPES.length;
  document.getElementById('rels-all').hidden = state.rels.size === RELS.length;
}

export function buildLegend(colorBy, selected) {
  const el = document.getElementById('legend');
  if (colorBy === 'type') {
    el.innerHTML = '<p class="hint">Forma e colore indicano la categoria: ● artista, ■ gruppo, ◆ label. La dimensione cresce con il numero di collegamenti.</p>';
  } else if (colorBy === 'gender') {
    el.innerHTML = `<div class="legend-row">${glyph('group', null)}${glyph('label', null)}<span>Gruppi e label: solo contorno</span></div>`;
  } else if (colorBy === 'btw') {
    el.innerHTML = `<div class="legend-row"><span>bassa</span><div class="legend-ramp" style="background:linear-gradient(90deg,var(--seq-lo),var(--seq-hi))"></div><span>alta</span></div>
      <p class="hint">Quanto spesso un nodo sta sui cammini minimi della sua componente: i più scuri sono i "ponti" tra scene diverse.</p>`;
  } else {
    el.innerHTML = `<div class="legend-row">${glyph('artist', 'var(--accent)')}<span>Comunità del nodo selezionato</span></div>
      <div class="legend-row">${glyph('artist', 'var(--c-neutral)')}<span>Altre comunità</span></div>
      ${selected ? '' : '<p class="hint">Seleziona un nodo per vederne la comunità (Louvain).</p>'}`;
  }
}

/* ------------------------------------------------------------------ */
const ICON = {
  ego: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="2" fill="currentColor" stroke="none"/><circle cx="10" cy="10" r="5"/><circle cx="10" cy="10" r="8.3"/></svg>',
  hier: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="7.5" y="2" width="5" height="4" rx="1"/><rect x="2" y="14" width="5" height="4" rx="1"/><rect x="13" y="14" width="5" height="4" rx="1"/><path d="M10 6v4M4.5 14v-2.5h11V14"/></svg>',
  comm: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" stroke-dasharray="2.5 2.5"/><circle cx="10" cy="10" r="2.5"/></svg>',
  close: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15"/></svg>',
};

function nbrItem(m, state, flag) {
  return `<li data-id="${m.id}">${glyph(m.macro, swatchColor(m, state.colorBy))}<span>${esc(m.name)}</span><span class="flag">${flag}</span></li>`;
}

export function renderDetails(G, n, state, actions) {
  const el = document.getElementById('details');
  if (!n) {
    const hubs = actions.hubs();
    el.innerHTML = `
      <div class="eyebrow">Nessun nodo selezionato</div>
      <p class="d-name">La rete in breve</p>
      <div class="stats">
        <div class="stat"><div class="v">${fmt(G.nodes.length)}</div><div class="k">nodi</div></div>
        <div class="stat"><div class="v">${fmt(G.edges.length)}</div><div class="k">relazioni</div></div>
        <div class="stat"><div class="v">${fmt(G.components.length)}</div><div class="k">componenti</div></div>
      </div>
      <p class="empty">Clicca un nodo nel grafo o cercalo per nome. Con un nodo selezionato si attivano le viste <b>Ego</b> e <b>Gerarchica</b>.</p>
      ${hubs.length ? `<h3>Da dove partire <span class="count">i più collegati in vista</span></h3>
      <ul class="nbr-list">${hubs.map((m) => nbrItem(m, state, m.deg)).join('')}</ul>` : ''}`;
    bindNbrs(el, G, actions);
    return;
  }
  const comp = G.components[n.comp];
  const comm = G.communities.get(n.comm);
  const btwRank = actions.btwRank(n);

  // vicini raggruppati per relazione con verbo orientato al nodo
  const groups = new Map();
  const add = (key, item) => { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); };
  for (const { n: m, e } of G.adj[n.idx]) {
    let key;
    if (e.rel === 'management') key = n.macro === 'label' ? (m.macro === 'group' ? 'Gruppi gestiti' : 'Artisti gestiti') : 'Gestito da';
    else if (e.rel === 'membership') {
      if (n.macro === 'artist') key = 'Membro di';
      else if (m.macro === 'artist') key = 'Membri';
      else key = 'Sotto-unità / gruppi madre';
    } else if (e.rel === 'collaboration') key = 'Collabora con';
    else key = 'Label associate';
    add(key, { m, e });
  }
  const order = ['Gestito da', 'Membro di', 'Membri', 'Sotto-unità / gruppi madre', 'Gruppi gestiti', 'Artisti gestiti', 'Label associate', 'Collabora con'];
  const sections = order.filter((k) => groups.has(k)).map((k) => {
    const items = groups.get(k).sort((a, b) => b.m.deg - a.m.deg);
    return `<h3>${esc(k)} <span class="count">${items.length}</span></h3><ul class="nbr-list">${items.map(({ m, e }) =>
      nbrItem(m, state, e.sub ? SUB_LABEL[e.sub] : m.deg)).join('')}</ul>`;
  }).join('');

  const isolated = state.commOnly === n.comm;
  el.innerHTML = `
    <div class="eyebrow">${glyph(n.macro, swatchColor(n, state.colorBy))}<span>${TYPE_LABEL[n.type]}</span></div>
    <p class="d-name">${esc(n.name)}</p>
    <div class="stats">
      <div class="stat"><div class="v">${n.deg}</div><div class="k">collegamenti</div></div>
      <div class="stat" title="Posizione per betweenness nella componente"><div class="v">${btwRank ? '#' + btwRank : '–'}</div><div class="k">centralità</div></div>
      <div class="stat" title="Nodi nella stessa comunità Louvain"><div class="v">${fmt(G.commSize.get(n.comm))}</div><div class="k">in comunità</div></div>
    </div>
    <p class="meta">Componente #${n.comp + 1} · ${fmt(comp.size)} nodi${comm && comm.hubNode !== n ? ` · comunità di <b>${esc(comm.hubNode.name)}</b>` : ''}</p>
    <div class="actions">
      <button class="btn ${state.mode === 'ego' ? 'on' : 'tint'}" data-act="ego">${ICON.ego}Ego</button>
      <button class="btn ${state.mode === 'hier' ? 'on' : 'tint'}" data-act="hier">${ICON.hier}Gerarchica</button>
      <button class="btn ${isolated ? 'on' : ''}" data-act="comm" title="Mostra solo la comunità del nodo">${ICON.comm}${isolated ? 'Comunità isolata' : 'Isola comunità'}</button>
      <button class="btn" data-act="clear">${ICON.close}Deseleziona</button>
    </div>
    ${sections || '<p class="empty">Nessun collegamento: nodo isolato.</p>'}`;

  el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => actions.act(b.dataset.act)));
  bindNbrs(el, G, actions);
}

function bindNbrs(el, G, actions) {
  el.querySelectorAll('.nbr-list li').forEach((li) => {
    const m = G.byId.get(li.dataset.id);
    li.addEventListener('click', () => actions.navigate(m));
    li.addEventListener('mouseenter', () => actions.preview(m));
    li.addEventListener('mouseleave', () => actions.preview(null));
  });
}

/* ------------------------------------------------------------------ */
export function setupSearch(G, onPick, onQuery) {
  const input = document.getElementById('search');
  const list = document.getElementById('search-results');
  const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[\s,.\-_'()]/g, '');
  const index = G.nodes.map((n) => [norm(n.name), n]);
  let active = -1, results = [];

  const show = () => {
    list.innerHTML = results.map((n, i) =>
      `<li role="option" data-i="${i}" class="${i === active ? 'active' : ''}">${glyph(n.macro, `var(--c-${n.macro})`)}<span>${esc(n.name)}</span><span class="deg">${n.deg}</span></li>`).join('');
    list.querySelectorAll('li').forEach((li) => li.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      pick(results[+li.dataset.i]);
    }));
  };
  const pick = (n) => {
    if (!n) return;
    results = []; active = -1; show();
    input.blur();
    onPick(n);
  };
  input.addEventListener('input', () => {
    const q = norm(input.value);
    if (q.length < 2) { results = []; onQuery(null); show(); return; }
    const matches = index.filter(([s]) => s.includes(q)).map(([, n]) => n);
    onQuery(new Set(matches));
    results = matches.sort((a, b) => (norm(a.name).startsWith(q) ? 0 : 1) - (norm(b.name).startsWith(q) ? 0 : 1) || b.deg - a.deg).slice(0, 12);
    active = results.length ? 0 : -1;
    show();
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { active = Math.min(results.length - 1, active + 1); show(); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { active = Math.max(0, active - 1); show(); ev.preventDefault(); }
    else if (ev.key === 'Enter') pick(results[active]);
    else if (ev.key === 'Escape') { input.value = ''; results = []; onQuery(null); show(); input.blur(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { results = []; show(); }, 150));
  return { clear() { input.value = ''; results = []; show(); } };
}

/* ------------------------------------------------------------------ */
/* Tooltip condiviso                                                   */
/* ------------------------------------------------------------------ */
const tip = () => document.getElementById('tooltip');
export function showTip(html, x, y) {
  const t = tip();
  t.innerHTML = html;
  t.hidden = false;
  // coordinate della finestra (tooltip in position: fixed)
  const w = t.offsetWidth, h = t.offsetHeight;
  let left = x + 14, top = y + 14;
  if (left + w > window.innerWidth - 8) left = x - w - 14;
  if (top + h > window.innerHeight - 8) top = y - h - 14;
  t.style.left = `${Math.max(4, left)}px`;
  t.style.top = `${Math.max(4, top)}px`;
}
export function hideTip() { tip().hidden = true; }

/* ------------------------------------------------------------------ */
/* Vista coordinata: dimensione delle componenti (barre impilate per tipo) */
/* ------------------------------------------------------------------ */
export function renderComponentChart(G, state, onPick) {
  const host = document.getElementById('comp-chart');
  const TOP = 10;
  const big = G.components.filter((c) => c.size > 3).slice(0, TOP);
  const small = G.components.filter((c) => c.size <= 3);
  const smallTypes = {};
  for (const c of small) for (const [t, v] of Object.entries(c.types)) smallTypes[t] = (smallTypes[t] || 0) + v;
  const rows = [
    ...big.map((c) => ({ key: `c${c.id}`, scope: { kind: 'comp', id: c.id }, label: `#${c.id + 1} ${c.hubNode.name}`, size: c.size, types: c.types })),
    { key: 'small', scope: { kind: 'small' }, label: 'Piccole (≤ 3 nodi)', count: small.length, size: small.reduce((s, c) => s + c.size, 0), types: smallTypes },
  ];

  const width = host.clientWidth || 300, rowH = 22, labelW = 124;
  const height = rows.length * rowH;
  // la gigante e l'aggregato delle piccole sono fuori scala: asse interrotto
  const cap = d3.max(rows.slice(1, -1), (r) => r.size) * 1.15;
  const x = d3.scaleLinear().domain([0, cap]).range([0, width - labelW - 44]);
  const svg = d3.create('svg').attr('viewBox', `0 0 ${width} ${height}`).attr('height', height);

  const g = svg.selectAll('g.bar').data(rows).join('g')
    .attr('class', (d) => `bar ${scopeKey(state.scope) === d.key ? 'active' : ''}`)
    .attr('transform', (d, i) => `translate(0,${i * rowH})`)
    .on('click', (ev, d) => onPick(d.scope))
    .on('mousemove', (ev, d) => {
      const comp = Object.entries(d.types).map(([t, v]) => `<div class="t-row">${glyph(macroOf(t), `var(--c-${macroOf(t)})`)}${TYPE_LABEL[t]} <b>${fmt(v)}</b></div>`).join('');
      showTip(`<div class="t-name">${esc(d.label)}</div><div class="t-row">Nodi <b>${fmt(d.size)}</b></div>${d.count ? `<div class="t-row">Componenti <b>${fmt(d.count)}</b></div>` : ''}${comp}`, ev.clientX, ev.clientY);
    })
    .on('mouseleave', hideTip);

  g.append('rect').attr('class', 'hit').attr('x', -6).attr('width', width + 6).attr('height', rowH);
  g.append('text').attr('x', 0).attr('y', rowH / 2).attr('dy', '0.35em')
    .text((d) => (d.label.length > 19 ? d.label.slice(0, 18) + '…' : d.label));

  // segmenti impilati per macro-categoria con 2px di separazione
  g.each(function (d) {
    const parts = ['artist', 'group', 'label'].map((m) => ({
      m, v: Object.entries(d.types).filter(([t]) => macroOf(t) === m).reduce((s, [, v]) => s + v, 0),
    })).filter((p) => p.v > 0);
    const total = d.size;
    const full = Math.min(x(total), x(cap));
    let acc = 0;
    const sel = d3.select(this);
    parts.forEach((p, i) => {
      const w = (full * p.v) / total;
      sel.append('rect').attr('class', 'fill')
        .attr('x', labelW + acc).attr('y', 6).attr('height', rowH - 12)
        .attr('width', Math.max(1, w - (i < parts.length - 1 ? 2 : 0)))
        .attr('rx', 2)
        .attr('fill', `var(--c-${p.m})`);
      acc += w;
    });
    if (total > cap) {
      // segno di interruzione: la barra non è in scala
      const bx = labelW + full - 18;
      sel.append('path').attr('d', `M${bx},${rowH - 5} l5,-${rowH - 10} M${bx + 5},${rowH - 5} l5,-${rowH - 10}`)
        .attr('stroke', 'var(--break)').attr('stroke-width', 3);
    }
    sel.append('text').attr('x', labelW + full + 6).attr('y', rowH / 2).attr('dy', '0.35em')
      .style('font-variant-numeric', 'tabular-nums').text(fmt(total));
  });

  host.replaceChildren(svg.node());
}

export const scopeKey = (s) => (s.kind === 'small' ? 'small' : `c${s.id}`);

/* ------------------------------------------------------------------ */
/* Vista coordinata: istogramma dei gradi (classi logaritmiche) + brush  */
/* ------------------------------------------------------------------ */
const DEG_BINS = [[0, 0], [1, 1], [2, 2], [3, 3], [4, 5], [6, 8], [9, 15], [16, 30], [31, 60], [61, 1000]];
const binLabel = ([a, b]) => (a === b ? `${a}` : b >= 1000 ? `${a}+` : `${a}–${b}`);

export function renderDegreeChart(nodes, state, onBrush) {
  const host = document.getElementById('deg-chart');
  const width = host.clientWidth || 300, height = 140, m = { t: 16, r: 2, b: 22, l: 2 };
  const counts = DEG_BINS.map(([a, b]) => nodes.filter((n) => n.deg >= a && n.deg <= b).length);
  const x = d3.scaleBand().domain(DEG_BINS.map((_, i) => i)).range([m.l, width - m.r]).paddingInner(0.14);
  const y = d3.scaleLinear().domain([0, d3.max(counts) || 1]).nice().range([height - m.b, m.t]);
  const svg = d3.create('svg').attr('viewBox', `0 0 ${width} ${height}`).attr('height', height);

  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${height - m.b})`)
    .call(d3.axisBottom(x).tickFormat((i) => binLabel(DEG_BINS[i])).tickSizeOuter(0).tickSize(0).tickPadding(7));

  const inRange = (i) => !state.degRange || (DEG_BINS[i][0] >= state.degRange[0] && DEG_BINS[i][1] <= state.degRange[1]);
  const bars = svg.append('g').selectAll('g').data(counts).join('g');
  bars.append('path')
    .attr('d', (c, i) => {
      const x0 = x(i), w = x.bandwidth(), y0 = y(c), b = y(0), r = Math.min(4, w / 2, b - y0);
      return c ? `M${x0},${b}V${y0 + r}Q${x0},${y0} ${x0 + r},${y0}H${x0 + w - r}Q${x0 + w},${y0} ${x0 + w},${y0 + r}V${b}Z` : '';
    })
    .attr('fill', 'var(--accent)')
    .attr('opacity', (c, i) => (inRange(i) ? 1 : 0.25));
  bars.append('text').attr('x', (c, i) => x(i) + x.bandwidth() / 2).attr('y', (c) => y(c) - 4)
    .attr('text-anchor', 'middle').style('font-variant-numeric', 'tabular-nums').style('font-size', '10px').text((c) => (c ? fmt(c) : ''));

  const brush = d3.brushX().extent([[m.l, m.t - 10], [width - m.r, height - m.b]])
    .on('end', (ev) => {
      if (!ev.sourceEvent) return;
      if (!ev.selection) { onBrush(null); return; }
      const [s0, s1] = ev.selection;
      const idx = DEG_BINS.map((_, i) => i).filter((i) => x(i) + x.bandwidth() > s0 && x(i) < s1);
      if (!idx.length) { onBrush(null); return; }
      // aggancio alle classi
      gb.transition().duration(150)
        .call(brush.move, [x(idx[0]), x(idx[idx.length - 1]) + x.bandwidth()]);
      onBrush([DEG_BINS[idx[0]][0], DEG_BINS[idx[idx.length - 1]][1]]);
    });
  const gb = svg.append('g').attr('class', 'brush').call(brush);
  if (state.degRange) {
    const idx = DEG_BINS.map((_, i) => i).filter(inRange);
    if (idx.length) gb.call(brush.move, [x(idx[0]), x(idx[idx.length - 1]) + x.bandwidth()]);
  }
  // tooltip per classe sopra il brush
  gb.on('mousemove', (ev) => {
    const [px] = d3.pointer(ev);
    const i = DEG_BINS.findIndex((_, j) => px >= x(j) && px <= x(j) + x.bandwidth());
    if (i < 0) { hideTip(); return; }
    showTip(`<div class="t-name">Grado ${binLabel(DEG_BINS[i])}</div><div class="t-row">Nodi visibili <b>${fmt(counts[i])}</b></div>`, ev.clientX, ev.clientY);
  }).on('mouseleave', hideTip);

  host.replaceChildren(svg.node());
}
