// Layout statico a forze per ogni componente con più di 3 nodi.
// Legge e riscrive web/public/graph.json (le componenti piccole restano nella griglia
// calcolata da build_graph.py). Usa d3-force, lo stesso motore del frontend.
//
// Uso:  node preprocess/layout.mjs      (dopo python preprocess/build_graph.py)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY,
} from '../web/node_modules/d3-force/dist/d3-force.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILE = path.join(ROOT, 'web', 'public', 'graph.json');
const g = JSON.parse(fs.readFileSync(FILE, 'utf8'));

// generatore congruenziale: layout riproducibile
function lcg(seed) {
  let s = seed >>> 0;
  return () => ((s = (1664525 * s + 1013904223) >>> 0) / 4294967296);
}
const radius = (deg) => Math.min(16, 2.4 + 1.1 * Math.sqrt(deg));
const LINK_DIST = { membership: 16, management: 34, collaboration: 30, label: 46 };

const byComp = new Map();
for (const n of g.nodes) {
  if (!byComp.has(n.comp)) byComp.set(n.comp, []);
  byComp.get(n.comp).push(n);
}
const edgesByComp = new Map();
const compOf = new Map(g.nodes.map((n) => [n.id, n.comp]));
for (const e of g.edges) {
  const c = compOf.get(e.s);
  if (!edgesByComp.has(c)) edgesByComp.set(c, []);
  edgesByComp.get(c).push(e);
}

const t0 = Date.now();
for (const [c, nodes] of byComp) {
  if (nodes.length <= 3) continue;
  const sim = nodes.map((n) => ({ id: n.id, deg: n.deg, ref: n }));
  const links = (edgesByComp.get(c) || []).map((e) => ({ source: e.s, target: e.t, rel: e.rel }));
  const big = nodes.length > 500;
  const s = forceSimulation(sim)
    .randomSource(lcg(42 + c))
    .force('link', forceLink(links).id((d) => d.id).distance((l) => LINK_DIST[l.rel]).iterations(2))
    // repulsione più forte per gli hub: le label grandi si allontanano tra loro
    .force('charge', forceManyBody().strength((d) => -28 - 9 * Math.sqrt(d.deg)).distanceMax(big ? 600 : 300).theta(0.85))
    .force('collide', forceCollide((d) => radius(d.deg) + 2.5).iterations(2))
    // gravità debole: riporta verso il centro catene e periferie
    .force('x', forceX(0).strength(big ? 0.045 : 0.08))
    .force('y', forceY(0).strength(big ? 0.045 : 0.08))
    .alphaDecay(1 - Math.pow(0.001, 1 / (big ? 600 : 300)))
    .stop();
  const ticks = big ? 600 : 300;
  for (let i = 0; i < ticks; i++) s.tick();
  for (const d of sim) {
    d.ref.x = Math.round(d.x * 100) / 100;
    d.ref.y = Math.round(d.y * 100) / 100;
  }
}

fs.writeFileSync(FILE, JSON.stringify(g));
console.log(`Layout calcolato per ${[...byComp.values()].filter((n) => n.length > 3).length} componenti in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
