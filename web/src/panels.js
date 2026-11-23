// Pannelli laterali: filtri, legenda, dettagli, ricerca e viste coordinate (SVG con D3).
import * as d3 from 'd3';
import { TYPE_LABEL, MACRO_LABEL, NODE_TYPES, REL_LABEL, REL_DESC, RELS, SUB_LABEL } from './data.js';
import { EDGE_DASH } from './renderer.js';

export const fmt = d3.formatLocale({ decimal: ',', thousands: '.', grouping: [3], currency: ['', ' €'] }).format(',');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Glifo SVG del nodo: la forma codifica la macro-categoria (ridondante rispetto al colore). */
export function glyph(macro, fill, stroke = 'none') {
  const f = fill || 'none';
  const s = fill ? stroke : 'var(--text-muted)';
  const sw = fill ? 0 : 1.5;
  let shape;
  if (macro === 'group') shape = `<rect x="2.5" y="2.5" width="9" height="9" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`;
  else if (macro === 'label') shape = `<path d="M7 1 L13 7 L7 13 L1 7 Z" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`;
  else shape = `<circle cx="7" cy="7" r="5" fill="${f}" stroke="${s}" stroke-width="${sw}"/>`;
  return `<svg class="glyph" viewBox="0 0 14 14" aria-hidden="true">${shape}</svg>`;
}

export function edgeGlyph(rel) {
  const dash = EDGE_DASH[rel].join(' ');
  return `<svg class="edge-glyph" viewBox="0 0 28 10" aria-hidden="true"><line x1="1" y1="5" x2="27" y2="5" stroke="var(--text-secondary)" stroke-width="1.6" stroke-dasharray="${dash}" stroke-linecap="${rel === 'collaboration' ? 'round' : 'butt'}"/></svg>`;
}

/** Colore "di identità" per i glifi nei pannelli, coerente con la modalità colore. */
export function swatchColor(n, colorBy) {
  if (colorBy === 'gender') return n.macro === 'artist' ? `var(--c-${n.type})` : null;
  if (colorBy === 'type') return `var(--c-${n.macro})`;
  return 'var(--c-neutral)';
}

/* ------------------------------------------------------------------ */
export function buildFilters(state, counts, onChange) {
  const types = document.getElementById('filter-types');
  types.innerHTML = NODE_TYPES.map((t) => {
    const macro = t === 'group' || t === 'label' ? t : 'artist';
    const color = state.colorBy === 'gender' ? (macro === 'artist' ? `var(--c-${t})` : null) : `var(--c-${macro})`;
    return `<label class="check"><input type="checkbox" data-type="${t}" ${state.types.has(t) ? 'checked' : ''}/>
      ${glyph(macro, state.colorBy === 'btw' || state.colorBy === 'comm' ? 'var(--c-neutral)' : color)}
      <span>${TYPE_LABEL[t]}</span><span class="count">${fmt(counts.types[t] || 0)}</span></label>`;
  }).join('');
  types.querySelectorAll('input').forEach((el) => el.addEventListener('change', () => {
    el.checked ? state.types.add(el.dataset.type) : state.types.delete(el.dataset.type);
    onChange();
  }));

  const rels = document.getElementById('filter-rels');
  rels.innerHTML = RELS.map((r) => `<label class="check" title="${REL_DESC[r]}"><input type="checkbox" data-rel="${r}" ${state.rels.has(r) ? 'checked' : ''}/>
      ${edgeGlyph(r)}<span>${REL_LABEL[r]}</span><span class="count">${fmt(counts.rels[r] || 0)}</span></label>`).join('');
  rels.querySelectorAll('input').forEach((el) => el.addEventListener('change', () => {
    el.checked ? state.rels.add(el.dataset.rel) : state.rels.delete(el.dataset.rel);
    onChange();
  }));
}

export function buildLegend(colorBy, selected) {
  const el = document.getElementById('legend');
  if (colorBy === 'type') {
    el.innerHTML = ['artist', 'group', 'label'].map((m) =>
      `<div class="legend-row">${glyph(m, `var(--c-${m})`)}<span>${MACRO_LABEL[m]}</span></div>`).join('')
      + '<p class="hint">Forma e colore codificano la stessa categoria. La dimensione cresce con il grado.</p>';
  } else if (colorBy === 'gender') {
    el.innerHTML = ['female', 'male', 'person'].map((t) =>
      `<div class="legend-row">${glyph('artist', `var(--c-${t})`)}<span>${TYPE_LABEL[t]}</span></div>`).join('')
      + `<div class="legend-row">${glyph('group', null)}${glyph('label', null)}<span>Gruppi e label (solo contorno)</span></div>`;
  } else if (colorBy === 'btw') {
    el.innerHTML = `<div class="legend-row"><span>bassa</span><div class="legend-ramp" style="background:linear-gradient(90deg,var(--seq-lo),var(--seq-hi))"></div><span>alta</span></div>
      <p class="hint">Quanto spesso un nodo sta sui cammini minimi della propria componente: evidenzia i "ponti" tra scene diverse.</p>`;
  } else {
    el.innerHTML = `<div class="legend-row">${glyph('artist', 'var(--accent)')}<span>Comunità del nodo selezionato</span></div>
      <div class="legend-row">${glyph('artist', 'var(--c-neutral)')}<span>Altre comunità</span></div>
      <p class="hint">${selected ? '' : 'Seleziona un nodo per vederne la comunità (Louvain).'}</p>`;
  }
}

/* ------------------------------------------------------------------ */
export function renderDetails(G, n, state, actions) {
  const el = document.getElementById('details');
  if (!n) {
    el.innerHTML = '<h2>Dettagli</h2><p class="hint">Passa sopra un nodo per un\'anteprima, cliccalo per selezionarlo. Le relazioni del nodo selezionato compaiono qui.</p>';
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
      `<li data-id="${m.id}">${glyph(m.macro, swatchColor(m, state.colorBy))}<span>${esc(m.name)}</span>${e.sub ? `<span class="flag">${SUB_LABEL[e.sub]}</span>` : `<span class="flag">${m.deg}</span>`}</li>`).join('')}</ul>`;
  }).join('');

  el.innerHTML = `
    <h2>Dettagli</h2>
    <p class="d-name">${esc(n.name)}</p>
    <div class="d-type">${glyph(n.macro, swatchColor(n, state.colorBy))}<span>${TYPE_LABEL[n.type]}</span></div>
    <div class="stats">
      <div class="stat"><div class="v">${n.deg}</div><div class="k">collegamenti</div></div>
      <div class="stat" title="Posizione per betweenness nella componente"><div class="v">${btwRank ? '#' + btwRank : '–'}</div><div class="k">centralità</div></div>
      <div class="stat" title="Comunità Louvain"><div class="v">${fmt(G.commSize.get(n.comm))}</div><div class="k">nodi in comunità</div></div>
    </div>
    <p class="hint">Componente #${n.comp + 1} (${fmt(comp.size)} nodi)${comm && comm.hubNode !== n ? ` · comunità attorno a <b>${esc(comm.hubNode.name)}</b>` : ''}</p>
    <div class="actions">
      <button data-act="ego">Ego radiale</button>
      <button data-act="hier">Gerarchica</button>
      <button data-act="comm">Isola comunità</button>
      <button data-act="clear">Deseleziona</button>
    </div>
    ${sections || '<p class="hint">Nessun collegamento: nodo isolato.</p>'}`;

  el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => actions.act(b.dataset.act)));
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
    else if (ev.key === 'Escape') { input.value = ''; results = []; onQuery(null); show(); }
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
  const TOP = 12;
  const big = G.components.filter((c) => c.size > 3).slice(0, TOP);
  const small = G.components.filter((c) => c.size <= 3);
  const smallTypes = {};
  for (const c of small) for (const [t, v] of Object.entries(c.types)) smallTypes[t] = (smallTypes[t] || 0) + v;
  const rows = [
    ...big.map((c) => ({ key: `c${c.id}`, scope: { kind: 'comp', id: c.id }, label: `#${c.id + 1} ${c.hubNode.name}`, size: c.size, types: c.types })),
    { key: 'small', scope: { kind: 'small' }, label: 'Piccole (≤ 3 nodi)', count: small.length, size: small.reduce((s, c) => s + c.size, 0), types: smallTypes },
  ];
  const macroOf = (t) => (t === 'group' || t === 'label' ? t : 'artist');

  const width = host.clientWidth || 288, rowH = 22, labelW = 128;
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

  g.append('rect').attr('width', width).attr('height', rowH).attr('fill', 'transparent');
  g.append('text').attr('x', 0).attr('y', rowH / 2).attr('dy', '0.35em')
    .text((d) => (d.label.length > 20 ? d.label.slice(0, 19) + '…' : d.label));

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
        .attr('x', labelW + acc).attr('y', 5).attr('height', rowH - 10)
        .attr('width', Math.max(1, w - (i < parts.length - 1 ? 2 : 0)))
        .attr('rx', i === parts.length - 1 ? 2 : 0)
        .attr('fill', `var(--c-${p.m})`);
      acc += w;
    });
    if (total > cap) {
      // segno di interruzione: la barra non è in scala
      const bx = labelW + full - 18;
      sel.append('path').attr('d', `M${bx},${rowH - 4} l5,-${rowH - 8} M${bx + 5},${rowH - 4} l5,-${rowH - 8}`)
        .attr('stroke', 'var(--surface-1)').attr('stroke-width', 3);
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
  const width = host.clientWidth || 288, height = 150, m = { t: 16, r: 4, b: 22, l: 4 };
  const counts = DEG_BINS.map(([a, b]) => nodes.filter((n) => n.deg >= a && n.deg <= b).length);
  const x = d3.scaleBand().domain(DEG_BINS.map((_, i) => i)).range([m.l, width - m.r]).paddingInner(0.12);
  const y = d3.scaleLinear().domain([0, d3.max(counts) || 1]).nice().range([height - m.b, m.t]);
  const svg = d3.create('svg').attr('viewBox', `0 0 ${width} ${height}`).attr('height', height);

  svg.append('g').attr('class', 'axis').attr('transform', `translate(0,${height - m.b})`)
    .call(d3.axisBottom(x).tickFormat((i) => binLabel(DEG_BINS[i])).tickSizeOuter(0));

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
    .attr('text-anchor', 'middle').style('font-variant-numeric', 'tabular-nums').text((c) => (c ? fmt(c) : ''));

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
