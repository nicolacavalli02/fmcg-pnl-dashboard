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
- `/css` — stili
- `index.html` nella root

## Stack tecnico
- Vanilla HTML/CSS/JS
- Chart.js per i grafici
- Nessun build step
- Deploy previsto su GitHub Pages

## Convenzioni
- Commenti nel codice in inglese
- Palette colori (Actual/Budget/LY/Forecast): ancora da definire — sceglierla
  dopo il primo grafico e poi aggiornare questa riga con la scelta finale,
  da applicare in modo coerente in tutti i grafici successivi

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

Convenzione: una metrica restituisce `null`, non `0`, quando il dato sotto
non è raggiungibile (EBITDA filtrato su un cliente, quota sotto il livello
categoria). `null` significa "non rispondibile qui", e va reso come tale.

## Note
Nessun dato reale o sensibile nel progetto. Dataset interamente sintetico,
ma con struttura e ordini di grandezza plausibili per il settore FMCG.
