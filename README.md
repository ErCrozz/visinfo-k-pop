# Rete K-pop — Visualizzazione delle Informazioni

Pagina web per esplorare la rete di artisti, gruppi e label del K-pop: panoramica a forze
per componente, vista ego radiale e vista gerarchica label → gruppi → artisti, con filtri,
codifiche di colore alternative e viste coordinate.

## Architettura

Il sistema è diviso in due fasi: un **preprocessing offline** che arricchisce il grafo e ne
calcola il layout, e un **frontend statico** che carica un unico file JSON e fa tutto nel
browser. Non c'è backend: la pagina compilata si può aprire da qualsiasi server statico.

```
 data/*.csv
     │
     ▼
 build_graph.py (Python + networkx)
   · inferenza del tipo di relazione dai tipi degli estremi
   · componenti connesse, comunità Louvain, betweenness
   · griglia per le componenti di 1–3 nodi
     │
     ▼
 layout.mjs (Node + d3-force)
   · layout a forze precalcolato per ogni componente > 3 nodi
     │
     ▼
 web/public/graph.json   (nodi, archi, componenti, comunità, posizioni)
     │
     ▼
 frontend (browser)
   data.js      carica e indicizza il grafo (adiacenze, componenti, comunità)
   main.js      stato unico + cronologia → apply() ricalcola la scena a ogni azione
   layouts.js   layout al volo sul nodo selezionato: ego radiale, gerarchico
   renderer.js  Canvas 2D: disegno, zoom/pan, hit-test, etichette, transizioni animate
   panels.js    pannelli SVG coordinati: filtri, legenda, dettagli, ricerca, grafici
```

Flusso di un'interazione: ogni comando (filtro, selezione, cambio vista, colore) modifica lo
stato in `main.js` e chiama `apply()`. Questa funzione calcola nodi e archi visibili, chiede
le posizioni di destinazione al layout attivo (precalcolate per la panoramica, generate da
`layouts.js` per ego e gerarchica) e passa la scena al renderer, che interpola le posizioni
in 800 ms. I pannelli laterali si aggiornano dallo stesso stato, perciò grafo e grafici
restano sempre coerenti.

## Tecnologie

| Livello | Tecnologia | Uso |
|---|---|---|
| Preprocessing | Python 3 + networkx ≥ 3.4 | lettura CSV, metriche di rete, Louvain (seed fisso) |
| Layout | Node.js + d3-force | layout a forze deterministico (generatore pseudo-casuale con seed) |
| Visualizzazione | D3 v7 | scale, zoom, timer, brush, assi dei grafici SVG |
| Rendering grafo | Canvas 2D (HTML5) | migliaia di nodi e archi fluidi, senza un elemento DOM per nodo |
| Build / dev server | Vite 6 | server di sviluppo su :5180, bundle statico in `web/dist/` |
| Linguaggio frontend | JavaScript (ES2022, moduli) | nessun framework UI, solo DOM e CSS |
| Stile | CSS con variabili | tema chiaro/scuro con palette validate per daltonismo |

## Struttura

```
data/                 CSV della consegna (K-pop_node.csv, K-pop_edge.csv)
preprocess/
  build_graph.py      tipi di relazione, componenti, Louvain, betweenness → web/public/graph.json
  layout.mjs          layout d3-force delle componenti (> 3 nodi), riscrive graph.json
web/                  frontend statico (Vite + D3, rendering su Canvas)
  src/main.js         stato, cronologia, collegamento tra viste
  src/renderer.js     disegno su canvas, zoom, hit-test, transizioni
  src/layouts.js      layout ego radiale e gerarchico
  src/panels.js       filtri, legenda, dettagli, ricerca, grafici coordinati
docs/METODOLOGIA.md   scelte di modellazione, colore e tassonomia delle operazioni
```

## Avvio

```bash
# 1) preprocessing (solo se cambiano i dati; graph.json è già generato)
python preprocess/build_graph.py      # richiede networkx >= 3.4
node preprocess/layout.mjs            # richiede web/node_modules (npm install)

# 2) frontend
cd web
npm install
npm run dev        # http://localhost:5180
npm run build      # pagina statica in web/dist/
```

## Arresto

Il server di sviluppo resta in primo piano nel terminale in cui è stato lanciato:

```bash
Ctrl + C           # nel terminale di "npm run dev" (o "npm run preview")
```

Se il terminale è stato chiuso o il server è rimasto in background, si termina il processo
che occupa la porta 5180:

```powershell
# Windows (PowerShell)
Get-NetTCPConnection -LocalPort 5180 -State Listen |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

```bash
# macOS / Linux
kill $(lsof -t -i :5180)
```

Gli script di preprocessing terminano da soli; per interromperli a metà basta `Ctrl + C`.

## Comandi rapidi

| Tasto | Azione |
|---|---|
| clic su nodo | seleziona (in ego/gerarchica: ricentra) |
| E / H / O | vista ego radiale / gerarchica / panoramica |
| Backspace | indietro |
| Esc | deseleziona |
| F | adatta alla finestra |
| R | ripristina tutto |
