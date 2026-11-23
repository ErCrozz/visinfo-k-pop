// Layout calcolati al volo quando si seleziona un nodo.
//   egoLayout:  albero radiale (Yee et al., 2001) sui k-vicinati del nodo focale
//   hierLayout: livelli label → gruppi → artisti attorno al nodo focale
// Entrambi rispettano i filtri correnti tramite i predicati nodeOk / edgeOk.

const MACRO_ORDER = { label: 0, group: 1, artist: 2 };
const byTypeThenDeg = (a, b) =>
  MACRO_ORDER[a.macro] - MACRO_ORDER[b.macro] || b.deg - a.deg || a.name.localeCompare(b.name);

function okNeighbors(G, n, nodeOk, edgeOk) {
  return G.adj[n.idx].filter(({ n: m, e }) => edgeOk(e) && nodeOk(m));
}

function inducedEdges(G, set, edgeOk) {
  const out = [];
  for (const e of G.edges) if (set.has(e.s) && set.has(e.t) && edgeOk(e)) out.push(e);
  return out;
}

/* ------------------------------------------------------------------ */
/* Ego-network radiale                                                 */
/* ------------------------------------------------------------------ */
export function egoLayout(G, focus, hops, nodeOk, edgeOk) {
  const ring = new Map([[focus, 0]]);
  const parent = new Map();
  const children = new Map([[focus, []]]);
  let frontier = [focus];
  const rings = [[focus]];
  for (let k = 1; k <= hops && frontier.length; k++) {
    const next = [];
    for (const u of frontier) {
      const nbrs = okNeighbors(G, u, nodeOk, edgeOk).map((x) => x.n).sort(byTypeThenDeg);
      for (const v of nbrs) {
        if (ring.has(v)) continue;
        ring.set(v, k);
        parent.set(v, u);
        children.get(u).push(v);
        children.set(v, []);
        next.push(v);
      }
    }
    rings.push(next);
    frontier = next;
  }

  // peso = numero di foglie del sottoalbero: i cunei angolari sono proporzionali
  const weight = new Map();
  const w = (u) => {
    const ch = children.get(u);
    const val = ch.length ? ch.reduce((s, c) => s + w(c), 0) : 1;
    weight.set(u, val);
    return val;
  };
  w(focus);

  // raggi: abbastanza spazio per il numero di nodi sull'anello
  const SPACING = 13;
  const radii = [0];
  for (let k = 1; k < rings.length; k++) {
    const need = (rings[k].length * SPACING) / (2 * Math.PI);
    radii.push(Math.max(radii[k - 1] + 140, need));
  }

  const pos = new Map();
  pos.set(focus, { x: 0, y: 0, lp: 'below', ring: 0 });
  const assign = (u, a0, a1) => {
    const ch = children.get(u);
    const tot = weight.get(u);
    let a = a0;
    for (const c of ch) {
      const span = ((a1 - a0) * weight.get(c)) / tot;
      const mid = a + span / 2;
      const r = radii[ring.get(c)];
      const x = r * Math.cos(mid), y = r * Math.sin(mid);
      pos.set(c, { x, y, lp: 'radial', angle: mid, ring: ring.get(c) });
      assign(c, a, a + span);
      a += span;
    }
  };
  assign(focus, -Math.PI / 2, (3 * Math.PI) / 2);

  const set = new Set(pos.keys());
  const edges = inducedEdges(G, set, edgeOk);
  return {
    pos,
    edges,
    // archi dell'albero BFS: gli altri (trasversali) vengono attenuati
    tree: new Set(edges.filter((e) => parent.get(e.s) === e.t || parent.get(e.t) === e.s)),
    guides: radii.slice(1).map((r, i) => ({ kind: 'ring', r, label: `${i + 1} ${i ? 'passi' : 'passo'}` })),
    info: { rings: rings.map((r) => r.length) },
  };
}

/* ------------------------------------------------------------------ */
/* Gerarchia label → gruppi → artisti                                  */
/* ------------------------------------------------------------------ */
export function hierLayout(G, focus, nodeOk, edgeOk) {
  const nb = (n, rels, macro) =>
    okNeighbors(G, n, nodeOk, edgeOk)
      .filter(({ n: m, e }) => rels.includes(e.rel) && (!macro || m.macro === macro))
      .map((x) => x.n);

  // 1) label radice
  let labels = [];
  const contextLabels = [];
  if (focus.macro === 'label') {
    labels = [focus];
    contextLabels.push(...nb(focus, ['label'], 'label'));
  } else if (focus.macro === 'group') {
    labels = nb(focus, ['management'], 'label');
  } else {
    labels = nb(focus, ['management'], 'label');
    for (const g of nb(focus, ['membership', 'collaboration'], 'group')) labels.push(...nb(g, ['management'], 'label'));
  }
  labels = [...new Set(labels)].sort(byTypeThenDeg);

  // 2) gruppi
  const groups = [];
  const groupOwner = new Map();
  const addGroup = (g, owner) => {
    if (groupOwner.has(g)) return;
    groupOwner.set(g, owner);
    groups.push(g);
  };
  if (focus.macro === 'group') addGroup(focus, labels[0] || null);
  if (focus.macro === 'artist') for (const g of nb(focus, ['membership'], 'group')) addGroup(g, null);
  for (const l of labels) for (const g of nb(l, ['management'], 'group').sort(byTypeThenDeg)) addGroup(g, l);
  // sotto-unità dei gruppi già presenti
  for (const g of [...groups]) for (const s of nb(g, ['membership'], 'group')) addGroup(s, groupOwner.get(g));
  // il proprietario di un gruppo aggiunto senza label è la prima sua label in vista
  for (const g of groups) if (!groupOwner.get(g)) groupOwner.set(g, nb(g, ['management'], 'label').find((l) => labels.includes(l)) || null);

  // 3) artisti: membri dei gruppi in colonna sotto al primo gruppo
  const column = new Map(); // gruppo/label → artisti
  const placed = new Set();
  for (const g of groups) {
    const mem = nb(g, ['membership'], 'artist').filter((a) => !placed.has(a)).sort(byTypeThenDeg);
    mem.forEach((a) => placed.add(a));
    column.set(g, mem);
  }
  // artisti gestiti direttamente dalla label (solisti)
  const direct = new Map();
  for (const l of labels) {
    const d = nb(l, ['management'], 'artist').filter((a) => !placed.has(a)).sort(byTypeThenDeg);
    d.forEach((a) => placed.add(a));
    if (d.length) direct.set(l, d);
  }
  if (focus.macro === 'artist' && !placed.has(focus)) {
    placed.add(focus);
    direct.set(null, [focus, ...(direct.get(null) || [])]);
  }
  // un artista senza label né gruppi: mostra i collaboratori come colonna
  if (focus.macro === 'artist' && !groups.length && !labels.length) {
    direct.set(null, [focus, ...nb(focus, ['collaboration'], 'artist').filter((a) => !placed.has(a))]);
  }

  // 4) colonne ordinate per label proprietaria, poi per dimensione
  const labelRank = new Map(labels.map((l, i) => [l, i]));
  const rankOf = (l) => (l == null ? labels.length : labelRank.get(l));
  const cols = [];
  for (const g of groups) cols.push({ head: g, owner: groupOwner.get(g), items: column.get(g) });
  for (const [l, items] of direct) {
    // i solisti sono distribuiti in colonne da al più 14
    for (let i = 0; i < items.length; i += 14) cols.push({ head: null, owner: l, items: items.slice(i, i + 14), direct: true });
  }
  cols.sort((a, b) => rankOf(a.owner) - rankOf(b.owner) || (a.direct - b.direct) || b.items.length - a.items.length);

  // 5) colonne lunghe spezzate in sotto-colonne affiancate (max MAX_ROWS righe),
  //    poi bande a capo per non avere una riga infinitamente larga
  const COL_W = 122, ROW_H = 17, HEAD_GAP = 46, BAND_GAP = 80, MAX_ROWS = 12;
  for (const c of cols) c.span = Math.max(1, Math.ceil(c.items.length / MAX_ROWS));
  const totalSlots = cols.reduce((s, c) => s + c.span, 0);
  const perBand = Math.max(6, Math.min(18, Math.ceil(Math.sqrt(totalSlots * 5))));
  const bands = [];
  for (const c of cols) {
    const last = bands[bands.length - 1];
    if (!last || last.slots + c.span > perBand) bands.push({ cols: [c], slots: c.span });
    else { last.cols.push(c); last.slots += c.span; }
  }
  const pos = new Map();
  const guides = [];
  let y0 = 0;
  for (const band of bands) {
    const bandW = (band.slots - 1) * COL_W;
    let slot = 0, tallest = 0;
    for (const c of band.cols) {
      const x0 = slot * COL_W - bandW / 2;
      const xc = x0 + ((c.span - 1) * COL_W) / 2;
      if (c.head) pos.set(c.head, { x: xc, y: y0, lp: 'above', level: 1 });
      else guides.push({ kind: 'text', x: xc, y: y0 - 12, label: c.owner ? 'artisti diretti' : 'artista' });
      c.items.forEach((a, j) => pos.set(a, {
        x: x0 + Math.floor(j / MAX_ROWS) * COL_W,
        y: y0 + HEAD_GAP + (j % MAX_ROWS) * ROW_H,
        lp: 'right', level: 2,
      }));
      tallest = Math.max(tallest, Math.min(MAX_ROWS, c.items.length));
      slot += c.span;
    }
    y0 += HEAD_GAP + tallest * ROW_H + BAND_GAP;
  }

  // 6) label in cima, al baricentro delle proprie colonne, senza sovrapposizioni
  const LABEL_Y = -110, LABEL_MIN = 150;
  const all = [...labels, ...contextLabels.filter((l) => !labels.includes(l))];
  const bary = all.map((l) => {
    const xs = cols.filter((c) => c.owner === l).map((c) => (c.head ? pos.get(c.head) : pos.get(c.items[0]))?.x).filter((x) => x != null);
    return { l, x: xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null };
  });
  // le label di contesto (senza colonne) vanno a destra
  let maxX = Math.max(0, ...[...pos.values()].map((p) => p.x));
  for (const b of bary) if (b.x == null) b.x = (maxX += LABEL_MIN);
  bary.sort((a, b) => a.x - b.x);
  for (let i = 1; i < bary.length; i++) bary[i].x = Math.max(bary[i].x, bary[i - 1].x + LABEL_MIN);
  for (const b of bary) pos.set(b.l, { x: b.x, y: LABEL_Y, lp: 'above', level: 0 });

  if (!pos.has(focus)) pos.set(focus, { x: 0, y: LABEL_Y, lp: 'above', level: 0 });

  guides.push(
    { kind: 'level', y: LABEL_Y, label: 'Label' },
    { kind: 'level', y: 0, label: 'Gruppi' },
    { kind: 'level', y: HEAD_GAP, label: 'Artisti' },
  );

  // archi "dell'albero": quelli che spiegano la posizione di un nodo nella gerarchia
  const treePairs = new Set();
  const key = (a, b) => (a.idx < b.idx ? `${a.idx}-${b.idx}` : `${b.idx}-${a.idx}`);
  for (const c of cols) {
    if (c.head && c.owner) treePairs.add(key(c.head, c.owner));
    for (const a of c.items) {
      if (c.head) treePairs.add(key(c.head, a));
      else if (c.owner) treePairs.add(key(c.owner, a));
    }
  }
  for (const l of contextLabels) treePairs.add(key(l, focus));

  const set = new Set(pos.keys());
  const edges = inducedEdges(G, set, edgeOk);
  return {
    pos,
    edges,
    tree: new Set(edges.filter((e) => treePairs.has(key(e.s, e.t)))),
    guides,
    info: { labels: labels.length, groups: groups.length, artists: placed.size },
  };
}
