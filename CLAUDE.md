# Progetto: FMCG P&L Dashboard

## Obiettivo
Dashboard di dati aziendali in HTML puro (no PowerBI/Tableau), con focus
sul Conto Economico (P&L), per dimostrare capacità di costruire strumenti
di reporting via codice invece che con tool no-code.
Settore: FMCG. Dati sintetici, ancorati a benchmark di settore realistici
— il valore finanziario dei numeri non è l'obiettivo, lo è la logica di
costruzione e la qualità dell'analisi.

## Scenari dati
- CY Actual (mensile)
- Budget (fasato mensilmente)
- LY Actual (anno precedente)
- Forecast / Latest Estimate (rolling sui mesi rimanenti)

## Dimensioni dataset
Un solo paese: Italia.
- Mese
- Cliente (12), con canale (Modern Trade / Discount / Wholesale) e area
  geografica come attributi, non come dimensioni del fact table
- Categoria di prodotto (5)
- Voce di P&L: Gross Sales → sconti on-invoice, trade spend promozionale e
  non, resi → Net Revenue → COGS → Gross Profit → costi commerciali diretti
  → Margine di contribuzione → overhead non allocato → EBITDA → D&A → EBIT

Misure statistiche affiancate al P&L, fuori dalla scala: volumi in colli
(baseline, incrementale, venduto in promozione), dimensione del mercato per
categoria a volume e valore, listino per collo.

## Regole del modello dati
- Il P&L cliente si ferma al **margine di contribuzione**: G&A, R&D e D&A
  sono tenuti solo a livello categoria, con `customer` null. Allocare
  l'overhead al singolo cliente sarebbe finta precisione.
- Il **COGS è guidato dai volumi** (colli × costo per collo), mai da una
  percentuale del fatturato: altrimenti uno sconto ridurrebbe magicamente il
  costo del venduto e falserebbe ogni calcolo promozionale.
- Il dataset contiene **solo misure base, nessun KPI precalcolato**.
  Pressione promozionale, gross-to-net, efficienza del trade spend, ROI
  promo, quota di mercato e bridge prezzo/volume/mix si calcolano in
  `/js/logic`.
- I **subtotali non sono nel dataset**: sono descritti in
  `meta.pnl_structure` e calcolati a valle, così la struttura del P&L non è
  hardcoded in nessun grafico.
- I valori sono **magnitudini positive**; il segno sta in
  `meta.pnl_lines[].sign` (0 = riga statistica fuori dalla scala).
- Il mercato è una **serie indipendente**, non derivata dai nostri volumi,
  altrimenti la quota resterebbe costante per costruzione.

## Struttura cartelle
- `/data` — script di generazione dati (Python) e dataset generato (JSON/CSV)
- `/js/logic` — calcoli derivati dai dati grezzi (variance %, margini,
  valori per waterfall/bridge)
- `/js/charts` — un modulo per grafico
- `/js/ui` — componenti DOM che non sono grafici Chart.js (slicer, briciole,
  tile KPI, tabella P&L, formattazione)
- `/js/state.js` — stato unico del dashboard, sincronizzato con l'hash URL
- `/js/app.js` — controller di pagina
- `/css` — stili
- `index.html` nella root
- `/docs` — walkthrough Excel del dataset e script che lo rigenera

## Stack tecnico
- Vanilla HTML/CSS/JS
- Chart.js per i grafici
- Nessun build step
- Deploy previsto su GitHub Pages

## Convenzioni
- Commenti nel codice in inglese
- Palette colori — **decisa**, da applicare a tutti i grafici. Definita solo
  in `css/style.css` come custom property; i moduli grafico la leggono a
  runtime con `getComputedStyle`, non hanno valori hex propri.

  | Scenario | Variabile | Light | Dark | Tratto |
  |---|---|---|---|---|
  | Actual | `--scenario-actual` | `#0b5563` | `#4bb8cc` | pieno, spesso |
  | Forecast | `--scenario-forecast` | `#3e97a8` | `#2c7d8c` | **tratteggiato** |
  | Budget | `--scenario-budget` | `#c98a2e` | `#e0a44a` | pieno |
  | LY Actual | `--scenario-ly` | `#98a2ae` | `#7d8894` | pieno, sottile |

  **Palette varianza**, asse di significato separato dagli scenari:
  `--variance-favourable` `#2e7d5b` / `#4fae82` in dark,
  `--variance-adverse` `#b4552d` / `#d97a4e`. Non sono il rosso e verde
  riflesso: sono smorzati per convivere col teal e differiscono anche in
  luminosità. Il colore non è mai l'unica codifica — la direzione della barra
  e il segno del numero lo ripetono. La direzione favorevole/sfavorevole si
  ricava **sempre** dal segno della riga, mai dal fatto che il numero cresca:
  un costo sopra piano è un numero più grande e una notizia peggiore.

  Logica: l'Actual è il protagonista e prende il tono più scuro e saturo;
  il Forecast è lo stesso teal un passo più chiaro ed è **sempre
  tratteggiato**, così resta provvisorio anche in bianco e nero; il Budget è
  l'unico tono caldo, così piano e consuntivo non si confondono mai; l'anno
  scorso è grigio neutro, contesto e mai soggetto.

## Comandi
```bash
python3 data/generate_data.py   # rigenera il dataset
```
```bash
node js/logic/checks.mjs        # verifica la logica di calcolo
```
```bash
python3 -m http.server          # serve la pagina in locale
```
Il dataset viene caricato con `fetch`, quindi aprire `index.html` da
filesystem non funziona (CORS): serve un server locale.

`package.json` esiste solo per dichiarare `"type": "module"`, così i moduli
ES sono importabili anche da Node per i check. Nessuna dipendenza, nessun
build step.

## Logica di calcolo (`/js/logic`)
- `dataset.js` — caricamento, indicizzazione, lookup delle dimensioni
- `aggregate.js` — filtri, aggregazione, risoluzione della scala di P&L
- `metrics.js` — margini, gross-to-net, KPI promozionali, quota
- `variance.js` — scostamenti fra scenari, con direzione del favorevole
- `bridge.js` — waterfall di P&L e bridge prezzo/volume/mix
- `index.js` — superficie pubblica: i grafici importano solo da qui
- `checks.mjs` — self-check, incrociati con i numeri dello script Python

`js/app.js` è il controller di pagina: carica il dataset una volta, riempie
il DOM e chiama i grafici. Non calcola nulla (sta in `/js/logic`) e non
disegna nulla (sta in `/js/charts`).

## Convenzioni dei grafici
- L'**actual si ferma al mese di chiusura**. Il generatore produce anche i
  mesi aperti, ma un dashboard che li mostrasse esporrebbe numeri che
  l'azienda non ha ancora. Oltre la chiusura parla solo il forecast.
- Il **forecast parte dall'ultimo mese chiuso**, così prosegue la linea
  dell'actual dal punto in cui coincidono, ed è sempre tratteggiato.
- I mesi aperti hanno uno sfondo ombreggiato e una riga verticale al confine.
- Asse Y **tagliato, non a zero**, sulle serie storiche a linee: la linea
  codifica il movimento, e con scenari entro il 3% lo zero li comprimerebbe
  in una banda illeggibile. Su grafici a barre invece lo zero è obbligatorio,
  perché lì è la lunghezza a codificare il valore.
- **Deroga esplicita per i bridge.** Un waterfall disegna solo i passi, non i
  totali di apertura e chiusura: un totale a piena altezza costringerebbe
  l'asse a includere lo zero e schiaccerebbe passi da 3 milioni su una scala
  da 60. Troncare l'asse tenendo i totali sarebbe peggio — una barra all'89%
  di un'altra sembrerebbe la metà. Quindi **nessuna barra codifica un
  livello**, ogni barra codifica una variazione e porta il proprio valore
  come etichetta, e i due totali sono dichiarati nella didascalia.
- Animazioni a **260ms**: i grafici vengono ricostruiti a ogni cambio di
  stato, e l'entrata di default da un secondo si rigiocherebbe intera a ogni
  click sugli slicer.

## Stato, slicer e drilldown
- Tutto lo stato sta in `js/state.js`: nessun componente possiede un filtro
  proprio, per questo un cambio di slicer raggiunge la pagina intera.
  Serializzato nell'hash URL, quindi una vista filtrata è condivisibile.
- Un solo controllo **Confronto** pilota scenario e riferimento ovunque, così
  nessun grafico può confrontare qualcosa di diverso da ciò che dice l'header.
- **Regola del periodo onesto**: chiedere l'anno intero su una base actual
  fa passare il lato actual al Forecast, e la UI lo dichiara. Gli actual si
  fermano alla chiusura; YTD actual + LE è la lettura annuale corretta.
- Il drilldown segue `Canale → Cliente → Categoria` nel grafico dei driver,
  ma il clic su qualsiasi dimensione aggiunge comunque un filtro.
- **Una metrica non disponibile si rende come tale, mai come zero.** Sotto
  filtro cliente l'overhead non esiste: le tile mostrano `n/a`, le righe di
  P&L sono smorzate, e il bridge cambia bersaglio su margine di contribuzione
  dichiarandolo. È il difetto che il foglio "Worked example" dell'Excel mostra
  come trappola.
- `aggregate.js` memoizza le scansioni per dataset. Misurato: senza memo un
  render costava ~45ms di sola aggregazione, un terzo dei quali ricalcolava
  risposte identiche. Con memo il render sta fra 16 e 40ms a regime, ~80ms a
  cache fredda.

Convenzione: una metrica restituisce `null`, non `0`, quando il dato sotto
non è raggiungibile (EBITDA filtrato su un cliente, quota sotto il livello
categoria). `null` significa "non rispondibile qui", e va reso come tale.

## Note
Nessun dato reale o sensibile nel progetto. Dataset interamente sintetico,
ma con struttura e ordini di grandezza plausibili per il settore FMCG.
