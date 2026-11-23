"""Preprocessing della rete K-pop.

Legge data/K-pop_node.csv e data/K-pop_edge.csv e produce web/public/graph.json con:
  - nodi: id, nome, tipo, macro-categoria, grado, componente, comunità (Louvain),
          betweenness (normalizzata sulla componente), coordinate di layout;
  - archi: sorgente, destinazione, relazione inferita e flag di ambiguità/sottorelazione;
  - componenti: dimensione, composizione per tipo, nodo più connesso;
  - comunità: dimensione, nodo rappresentativo.

Uso:  python preprocess/build_graph.py && node preprocess/layout.mjs
"""
from __future__ import annotations

import csv
import json
import math
import re
import time
from collections import Counter, defaultdict
from pathlib import Path

import networkx as nx

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "web" / "public" / "graph.json"

ARTIST_TYPES = {"person", "female", "male"}
SEED = 42


def macro(t: str) -> str:
    return "artist" if t in ARTIST_TYPES else t


def norm_name(s: str) -> str:
    """Nome normalizzato per confronti di contenimento (EXO ⊂ EXO-M, FNC MUSIC ~ FNC Entertainment)."""
    s = s.lower()
    s = re.sub(r"\(.*?\)", "", s)
    s = re.sub(r"\b(the|entertainment|music|records|ent|media|co|ltd|inc)\b", "", s)
    return re.sub(r"[^0-9a-z가-힣]+", "", s)


def name_contains(a: str, b: str) -> bool:
    na, nb = norm_name(a), norm_name(b)
    if len(na) < 2 or len(nb) < 2:
        return False
    return na in nb or nb in na


COLLAB_RE = re.compile(r"\s(&|x|×|and|with|feat\.?)\s|&|×", re.IGNORECASE)


def classify(src: dict, dst: dict) -> tuple[str, str | None]:
    """Restituisce (relazione, sottotipo).

    relazione ∈ {management, membership, collaboration, label}
    sottotipo  ∈ {None, 'ambiguous', 'subunit', 'sublabel'}
    """
    ms, md = macro(src["type"]), macro(dst["type"])
    pair = {ms, md}

    if ms == md == "label":
        # associazione tra label; il nome condiviso suggerisce una sub-label
        return "label", ("sublabel" if name_contains(src["name"], dst["name"]) else None)

    if "label" in pair:
        return "management", None

    if pair == {"artist", "group"}:
        # Nei dati gli archi gruppo→artista (≈88%) sono appartenenze quasi certe;
        # quelli artista→gruppo mescolano appartenenze (spesso a sub-unit) e collaborazioni.
        if ms == "group":
            return "membership", None
        return "membership", "ambiguous"

    if ms == md == "group":
        if name_contains(src["name"], dst["name"]):
            return "membership", "subunit"  # EXO → EXO-M: sotto-unità
        if COLLAB_RE.search(src["name"]) or COLLAB_RE.search(dst["name"]):
            return "collaboration", None  # W & Whale: progetto congiunto
        return "collaboration", "ambiguous"

    return "collaboration", None  # artista-artista


def load():
    with open(DATA / "K-pop_node.csv", encoding="utf-8") as f:
        nodes = {r["id"]: {"id": r["id"], "type": r["type"].strip(), "name": r["name"].strip()} for r in csv.DictReader(f)}
    with open(DATA / "K-pop_edge.csv", encoding="utf-8") as f:
        edges = [(r["source"], r["target"]) for r in csv.DictReader(f)]
    return nodes, edges


def pack_small_components(comps: list[list[str]], G: nx.Graph) -> dict[str, tuple[float, float]]:
    """Dispone le componenti piccole (≤3 nodi) in una griglia, ordinate per dimensione e tipo."""
    pos = {}
    cell = 60.0
    comps = sorted(comps, key=lambda c: (-len(c), sorted(G.nodes[n]["type"] for n in c)))
    cols = math.ceil(math.sqrt(len(comps)) * 1.6)
    for i, comp in enumerate(comps):
        cx, cy = (i % cols) * cell, (i // cols) * cell
        if len(comp) == 1:
            pos[comp[0]] = (cx, cy)
        elif len(comp) == 2:
            pos[comp[0]] = (cx - 14, cy)
            pos[comp[1]] = (cx + 14, cy)
        else:
            # tripletta: il nodo di grado massimo al vertice, gli altri alla base
            center, *rest = sorted(comp, key=lambda n: -G.degree(n))
            pos[center] = (cx, cy - 10)
            pos[rest[0]] = (cx - 16, cy + 10)
            pos[rest[1]] = (cx + 16, cy + 10)
    return pos


def main():
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    t0 = time.time()
    nodes, edges = load()
    G = nx.Graph()
    for nid, d in nodes.items():
        G.add_node(nid, **d)

    out_edges = []
    rel_counter = Counter()
    for s, t in edges:
        if s not in nodes or t not in nodes or s == t:
            continue
        rel, sub = classify(nodes[s], nodes[t])
        rel_counter[(rel, sub)] += 1
        G.add_edge(s, t, rel=rel)
        e = {"s": s, "t": t, "rel": rel}
        if sub:
            e["sub"] = sub
        out_edges.append(e)

    # --- componenti -------------------------------------------------------
    comps = sorted(nx.connected_components(G), key=len, reverse=True)
    comp_of = {}
    comp_info = []
    for i, c in enumerate(comps):
        for n in c:
            comp_of[n] = i
        types = Counter(nodes[n]["type"] for n in c)
        hub = max(c, key=lambda n: (G.degree(n), nodes[n]["name"]))
        comp_info.append({"id": i, "size": len(c), "edges": G.subgraph(c).number_of_edges(),
                          "types": dict(types), "hub": hub})

    # --- comunità (Louvain sull'intero grafo) ------------------------------
    communities = nx.community.louvain_communities(G, seed=SEED, resolution=1.0)
    communities = sorted(communities, key=len, reverse=True)
    comm_of = {}
    comm_info = []
    for i, c in enumerate(communities):
        for n in c:
            comm_of[n] = i
        if len(c) >= 3:
            hub = max(c, key=lambda n: (G.degree(n), nodes[n]["name"]))
            comm_info.append({"id": i, "size": len(c), "hub": hub, "component": comp_of[hub]})

    # --- centralità --------------------------------------------------------
    betw = {}
    for c in comps:
        if len(c) < 3:
            continue
        H = G.subgraph(c)
        betw.update(nx.betweenness_centrality(H, normalized=True, k=None if len(c) < 3000 else 800, seed=SEED))

    # --- layout -----------------------------------------------------------
    # Le componenti con più di 3 nodi vengono disposte da preprocess/layout.mjs
    # (d3-force, lo stesso motore del frontend); qui solo la griglia delle piccole.
    pos = {}
    small = [list(c) for c in comps if len(c) <= 3]
    pos.update(pack_small_components(small, G))

    out_nodes = []
    for nid, d in nodes.items():
        x, y = pos.get(nid, (0.0, 0.0))
        rels = Counter(G.edges[nid, m]["rel"] for m in G.neighbors(nid))
        out_nodes.append({
            "id": nid, "name": d["name"], "type": d["type"], "macro": macro(d["type"]),
            "deg": G.degree(nid), "comp": comp_of[nid], "comm": comm_of[nid],
            "btw": round(betw.get(nid, 0.0), 6),
            "hangul": bool(re.search(r"[가-힣]", d["name"])),
            "rels": dict(rels),
            "x": round(float(x), 2), "y": round(float(y), 2),
        })

    OUT.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "meta": {
            "nodes": len(out_nodes), "edges": len(out_edges),
            "components": len(comps), "communities": len(communities),
            "relations": {f"{r}{'/' + s if s else ''}": v for (r, s), v in rel_counter.most_common()},
        },
        "nodes": out_nodes, "edges": out_edges,
        "components": comp_info, "communities": comm_info,
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    print(f"Scritto {OUT} ({OUT.stat().st_size / 1024:.0f} KB) in {time.time() - t0:.1f}s")
    print("Relazioni:", payload["meta"]["relations"])
    print("Componenti:", len(comps), "| più grande:", comp_info[0]["size"])
    print("Comunità (>=3 nodi):", len(comm_info))


if __name__ == "__main__":
    main()
