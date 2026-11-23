# Metodologia — Rete K-pop

Documento di lavoro per la relazione d'esame di Visualizzazione delle Informazioni.
Raccoglie le scelte di modellazione dei dati, di codifica visiva e la tassonomia delle
operazioni dell'interfaccia, con le motivazioni.

## 1. Dati

| | |
|---|---|
| Nodi | 4.674 (male 1.383, person 1.250, group 967, female 805, label 269) |
| Archi | 5.094, nessun duplicato, nessun self-loop, nessun estremo mancante |
| Componenti connesse | 1.417: una gigante da 2.422 nodi, poi 91, 42, 38, …; 1.198 isolati, 84 coppie, 44 triplette |
| Nomi in hangul | 1.124 (serve un font con glifi coreani) |

I CSV della consegna (link scaduti) sono stati recuperati dalla repository pubblica
`Cri-Perni/VDI_K-POP-industry-network`; il formato coincide con quello descritto nella traccia.

### 1.1 Inferenza del tipo di relazione

Il tipo di arco non è nei dati: è dedotto dai tipi degli estremi (`preprocess/build_graph.py → classify`).

| Coppia di tipi | Relazione | Sottotipo / regola |
|---|---|---|
| label–label | `label` (associazione) | `sublabel` se un nome contiene l'altro dopo la normalizzazione (FNC MUSIC ↔ FNC Entertainment) |
| label–artista/gruppo | `management` | — |
| gruppo → artista | `membership` | direzione osservata nell'88% degli archi artista-gruppo: appartenenza quasi certa |
| artista → gruppo | `membership` | `ambiguous`: la direzione inversa mescola appartenenze (spesso a sotto-unità, es. Nana → Orange Caramel) e collaborazioni |
| gruppo–gruppo | `membership` / `collaboration` | `subunit` se un nome contiene l'altro (EXO → EXO-M); collaborazione se un nome contiene `&`, `×`, `with`…; altrimenti collaborazione `ambiguous` |
| artista–artista | `collaboration` | — |

Risultato: membership 2.407 + 336 ambigue + 47 sotto-unità, management 1.560,
collaboration 376 + 244 ambigue, label 108 + 16 sub-label.
L'interfaccia permette di **escludere le relazioni ambigue** per verificare quanto un pattern dipenda da esse.

Rumore noto nei dati: alcune entità hanno un tipo sospetto (es. "SMTOWN", progetto
collettivo di S.M., è `group` con 114 collegamenti; alcune persone sono tipizzate come `group`).
Non viene corretto: l'esplorazione lo rende visibile, ed è esso stesso un risultato.

### 1.2 Attributi derivati

* **grado**: dimensione del nodo (radice, per non far dominare gli hub);
* **componente connessa**: unità di navigazione in panoramica;
* **comunità Louvain** (seed fisso): gruppi densi, spesso corrispondenti all'"impero" di una label;
* **betweenness** per componente: nodi-ponte tra scene diverse;
* **layout** a forze per ogni componente con più di 3 nodi (d3-force in `preprocess/layout.mjs`),
  griglia ordinata per le componenti di 1–3 nodi.

Il layout è precalcolato perché la panoramica resti stabile tra una visita e l'altra
(conservazione della *mental map*) e perché la pagina si apra subito ferma.
ForceAtlas2 e Fruchterman-Reingold di networkx sono stati scartati: troppo lenti
(100-260 s) e con un nucleo illeggibile. d3-force con repulsione proporzionale al grado e
gravità debole impiega circa 23 s.

## 2. Codifica visiva

### 2.1 Colore

Il colore ha **un solo compito per volta**, scelto dall'utente ("Colore per"):

| Modalità | Tipo di scala | Valori |
|---|---|---|
| Categoria | categoriale, 3 classi | artista blu, gruppo arancio, label verde-acqua |
| Genere | categoriale, 3 classi | donna magenta, uomo viola, n.d. giallo; gruppi/label solo contorno |
| Centralità | sequenziale, una tinta | blu chiaro → blu scuro (radice della betweenness) |
| Comunità | evidenziazione | comunità del nodo selezionato in blu, il resto grigio |

Motivazioni:

* **Le tre categorie usano tre tinte e non cinque.** person/female/male sono sottotipi di
  "artista": codificarli come cinque tinte avrebbe superato il numero di colori distinguibili in
  un grafico "a dispersione" come un grafo, dove ogni coppia di colori può trovarsi vicina.
  Il genere ha una modalità dedicata.
* **Palette validate** con controllo automatico (banda di luminosità, croma minimo, distanza
  ΔE OKLab tra *tutte* le coppie sotto deuteranopia, protanopia e tritanopia, distanza in visione normale, contrasto):
  categoria worst-pair CVD ΔE 9,2 (chiaro) / 9,4 (scuro); genere 16,3 / 13,2. Tutte superano la soglia di 8.
* **Codifica ridondante**: la forma ripete la macro-categoria (cerchio = artista,
  quadrato = gruppo, rombo = label). L'informazione sopravvive al daltonismo, alla stampa in
  scala di grigi e alla modalità "Centralità", in cui il colore è occupato da un'altra variabile.
* Alcune tinte del tema chiaro (verde-acqua, magenta, giallo) sono sotto 3:1 di contrasto
  sul fondo: la compensazione sono le etichette testuali, il tooltip e il pannello dettagli.
* Le superfici del grafo sono #f9f9fb (chiaro) e #151517 (scuro); i pannelli sono vetro
  traslucido sospeso sopra il grafo, che resta l'unico elemento opaco. Le verifiche sopra sono
  state ripetute su queste superfici, con gli stessi risultati.
* **Tema scuro** con gradini dedicati delle stesse tinte (validati sul fondo scuro), non
  un'inversione automatica.
* Il testo usa sempre gli inchiostri neutri, mai il colore della serie.
* Gli archi sono grigi e semitrasparenti: sono il contesto, non la figura.

### 2.2 Archi

Il tipo di relazione è codificato dal **tratteggio** (canale indipendente dal colore):
appartenenza continua, management tratteggiato, collaborazione puntinata, label-label tratto-punto.
Le relazioni ambigue hanno uno spessore ridotto.
Nelle viste focali gli archi *trasversali* (che non spiegano la posizione di un nodo
nell'albero radiale o nella gerarchia) sono attenuati al 30%.

### 2.3 Etichette

Zoom semantico: in panoramica si etichettano solo i nodi la cui dimensione sullo schermo supera
una soglia, con priorità per grado ed eliminazione delle collisioni (greedy su bounding box).
Il numero di etichette è limitato in proporzione all'area visibile. Hanno sempre priorità
il nodo sotto il puntatore, i suoi vicini, il nodo selezionato e i risultati di ricerca.

## 3. Tassonomia delle operazioni

Ogni comando è classificato secondo le *intent* di Yi, Kang, Stasko e Jacko (2007),
con il riferimento al mantra di Shneiderman (1996).

| Intento (Yi et al.) | Shneiderman | Comando nell'interfaccia |
|---|---|---|
| **Select** — marcare qualcosa di interessante | details-on-demand | clic su un nodo (anello di selezione, vicini evidenziati); risultati di ricerca cerchiati |
| **Explore** — mostrare qualcos'altro | zoom | grafico delle componenti → cambio di componente; clic su un vicino nel pannello dettagli; vista ego a 1/2/3 passi |
| **Reconfigure** — mostrare una disposizione diversa | relate | Panoramica ↔ Ego radiale ↔ Gerarchica, con transizione animata dei nodi |
| **Encode** — cambiare la rappresentazione | — | controllo segmentato "Colore": categoria / genere / centralità / comunità; i chip dei tipi di nodo cambiano colore con la modalità e fanno da legenda |
| **Abstract/Elaborate** — più o meno dettaglio | overview / zoom | zoom e pan con etichette semantiche; componenti piccole aggregate in una barra e in una griglia |
| **Filter** — mostrare in base a condizioni | filter | chip dei tipi di nodo e di relazione (clic = accendi/spegni, doppio clic = solo quello), interruttore per le relazioni ambigue, slider del grado minimo, isola comunità |
| **Connect** — mostrare elementi correlati | relate | hover su un chip: anteprima nel grafo dei nodi di quel tipo o degli archi di quella relazione, prima di filtrare; hover sul grafo: vicinato evidenziato e archi incidenti in primo piano; brush sull'istogramma dei gradi; hover su un vicino nel pannello lo evidenzia nel grafo |
| (history) | history | ← indietro (Backspace), ⟲ ripristina (R), ⤢ adatta (F) |
| (details) | details-on-demand | tooltip; pannello con tipo, grado, rango di centralità, comunità e vicini raggruppati per relazione orientata ("Gestito da", "Membri", "Membro di"…) |

### 3.1 Riordinamento sul nodo selezionato

**Ego radiale** — albero radiale (Yee et al., 2001) costruito per BFS dal nodo focale sul grafo
filtrato. Ogni anello corrisponde a una distanza; l'angolo assegnato a un nodo è proporzionale
al numero di foglie del suo sottoalbero, così i figli restano nel cono del genitore.
Al primo anello i vicini sono ordinati per categoria (label, gruppi, artisti) e i settori
angolari diventano leggibili. Il raggio di ogni anello cresce con il numero di nodi che deve
contenere.

**Gerarchica** — livelli label → gruppi → artisti attorno al nodo focale:

* label: il nodo stesso, se è una label (con le label associate come contesto); altrimenti le
  label che gestiscono il nodo o i suoi gruppi;
* gruppi: gestiti da quelle label, più i gruppi del nodo e le loro sotto-unità;
* artisti: in colonna sotto il primo gruppo di appartenenza (colonne oltre 12 membri spezzate in
  sotto-colonne), più una colonna "artisti diretti" per i solisti gestiti dalla label.

Le colonne sono ordinate per label proprietaria e dimensione, vanno a capo in bande, e
ogni label è posta al baricentro delle proprie colonne. Gli artisti con più gruppi compaiono una
sola volta; gli altri gruppi sono collegati da archi trasversali attenuati: è proprio lì che si
vedono le carriere "multi-gruppo" e le sotto-unità.

Le transizioni tra viste interpolano le posizioni in 800 ms (easing cubico): l'utente segue
gli stessi nodi mentre la disposizione cambia.

## 4. Viste coordinate

* **Componenti connesse**: barre orizzontali impilate per macro-categoria, prime 12 componenti
  più l'aggregato delle componenti di 1–3 nodi. La gigante e l'aggregato sono fuori scala:
  l'asse è interrotto (segno "//") per non schiacciare le altre barre, e il valore è scritto a fianco.
* **Distribuzione dei gradi**: istogramma a classi logaritmiche (coda lunga) sui nodi visibili.
  Il brush evidenzia nel grafo i nodi dell'intervallo, ad esempio per trovare gli hub o gli
  artisti con un solo collegamento.

## 5. Pattern da cercare (spunti per la relazione)

* Struttura a "imperi": le comunità Louvain più grandi corrispondono a S.M., LOEN, YG, JYP…
  Si vede con "Colore per → Comunità" e la vista ego di una label.
* Ponti: i nodi con betweenness alta che non sono label, cioè artisti o gruppi che collegano
  scene diverse (collaborazioni, progetti come SMTOWN).
* Sotto-unità e carriere multi-gruppo: archi trasversali nella vista gerarchica (Super Junior, EXO).
* Componenti minori senza label (es. #2 S.I.D-Sound, #3 Pastel Music): scene indipendenti dal
  sistema delle major.
* Qualità dei dati: quanto cambiano i pattern escludendo le relazioni ambigue.

## Riferimenti

* Shneiderman, B. (1996). *The eyes have it: a task by data type taxonomy for information visualizations.*
* Yi, J. S., Kang, Y., Stasko, J., Jacko, J. (2007). *Toward a deeper understanding of the role of interaction in information visualization.* IEEE TVCG.
* Yee, K.-P., Fisher, D., Dhamija, R., Hearst, M. (2001). *Animated exploration of dynamic graphs with radial layout.* IEEE InfoVis.
* Blondel, V. et al. (2008). *Fast unfolding of communities in large networks* (Louvain).
* Broadwell, P., Tangherlini, T., Chang, H. (2016). *Online Knowledge Bases and Cultural Technology: Analyzing Production Networks in Korean Popular Music.*
