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
- Mese
- Business Unit / Regione
- Categoria di prodotto
- Voce di P&L: Revenue → COGS → Gross Profit → OPEX (per categoria) →
  EBITDA → D&A → EBIT

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

## Note
Nessun dato reale o sensibile nel progetto. Dataset interamente sintetico,
ma con struttura e ordini di grandezza plausibili per il settore FMCG.
