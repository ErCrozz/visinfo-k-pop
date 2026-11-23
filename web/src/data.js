// Caricamento e indicizzazione di graph.json (prodotto da preprocess/build_graph.py).

export const TYPE_LABEL = {
  female: 'Artista (donna)',
  male: 'Artista (uomo)',
  person: 'Artista (genere n.d.)',
  group: 'Gruppo',
  label: 'Label',
};
export const MACRO_LABEL = { artist: 'Artista', group: 'Gruppo', label: 'Label' };
export const NODE_TYPES = ['female', 'male', 'person', 'group', 'label'];

export const REL_LABEL = {
  membership: 'Appartenenza',
  management: 'Management',
  collaboration: 'Collaborazione',
  label: 'Associazione tra label',
};
export const REL_DESC = {
  membership: 'artista → gruppo, sotto-unità di un gruppo',
  management: 'label → artista o gruppo',
  collaboration: 'artista–artista, gruppo–gruppo',
  label: 'label–label, incluse sub-label',
};
export const RELS = ['membership', 'management', 'collaboration', 'label'];
export const SUB_LABEL = {
  ambiguous: 'ambigua',
  subunit: 'sotto-unità',
  sublabel: 'sub-label',
};

export async function loadGraph(url = './graph.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Impossibile caricare ${url}: HTTP ${res.status}`);
  const raw = await res.json();

  const nodes = raw.nodes.map((n, i) => ({
    ...n,
    idx: i,
    // posizione corrente (animata) e posizione di destinazione
    cx: n.x, cy: n.y, tx: n.x, ty: n.y, sx: n.x, sy: n.y,
    alpha: 0, talpha: 0, salpha: 0,
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = raw.edges.map((e, i) => ({
    idx: i,
    s: byId.get(e.s),
    t: byId.get(e.t),
    rel: e.rel,
    sub: e.sub || null,
  }));
  const adj = nodes.map(() => []);
  for (const e of edges) {
    adj[e.s.idx].push({ n: e.t, e, out: true });
    adj[e.t.idx].push({ n: e.s, e, out: false });
  }
  const compNodes = new Map();
  for (const n of nodes) {
    if (!compNodes.has(n.comp)) compNodes.set(n.comp, []);
    compNodes.get(n.comp).push(n);
  }
  const components = raw.components.map((c) => ({ ...c, hubNode: byId.get(c.hub) }));
  const communities = new Map(raw.communities.map((c) => [c.id, { ...c, hubNode: byId.get(c.hub) }]));
  const commSize = new Map();
  for (const n of nodes) commSize.set(n.comm, (commSize.get(n.comm) || 0) + 1);

  return { meta: raw.meta, nodes, edges, adj, byId, compNodes, components, communities, commSize };
}
