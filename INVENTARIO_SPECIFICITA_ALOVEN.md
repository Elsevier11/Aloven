# Inventario delle specificità Aloven (base per MesBeat)

Data: 16 ottobre 2026. Solo analisi: **nessun codice è stato modificato**. Serve a decidere cosa generalizzare per passare da «soluzione Aloven» a «prodotto MesBeat» (un solo codice, Aloven come profilo; vedi `MEMORIA_PROGETTO.md`). I numeri di riga sono indicativi e riferiti allo stato al momento dell'analisi.

## Legenda

- **Impatto**: A = cambia il modello dati o il comportamento; M = interfaccia e testi; B = nome o marchio.
- **Via**: struttura (cambio di modello), config (impostazione per cliente), seed (dati di avvio), marchio.

## 1. Componenti fissi a due (impatto A, via struttura) — la specificità principale

Il modello assume **esattamente due componenti** (`component1*`, `component2*`) e un prodotto. Compare in circa 30 file (97 occorrenze nella verifica di conteggio).

| Area | Dove | Cosa assume |
|---|---|---|
| Dati attività | `production.mjs` (colonne `component1ArticleId`, `component2ArticleId`, `component1/2Code`, `component1/2Description`; mappa dei ruoli a righe 2-3) | Quattro campi per i componenti più due riferimenti agli articoli, sull'attività |
| Persistenza | `server.mjs` (INSERT delle attività, righe ~376-377; controlli articoli in uso ~275-282; propagazione delle modifiche all'anagrafica ~282) | Elenchi di campi scritti a mano; l'aggiornamento di un articolo ripercorre solo `component1`, `component2`, `product` |
| Istantanea al rilascio | `shopfloor.mjs` (righe ~48-95; tabella `component1/2Code, Description, Unit`; vincolo `CHECK(component IN ('component1','component2'))` a riga ~132) | Il rilascio **rifiuta** l'attività senza «due componenti e un prodotto»; i lotti scaricati sono vincolati a due valori |
| Qualità | `quality.mjs` (`COMPONENTS = new Set(['component1','component2'])`) | Insieme chiuso di due |
| Avvisi | `task-warnings.mjs` | Avviso «componenti uguali» confronta solo il 1 con il 2 |
| Bordo macchina | `public/operator.js` (schede componente `['component1','component2']`, testi «due componenti» in IT/EN), `public/mes-console.js` | Due schede fisse, due campi lotto |
| Vista gestionale | `public/app.js` (flusso materiali `A + B → prodotto`, dettagli «Componente 1/2»), `public/planning-presentation.js` (campi della scheda), `public/planner-controls.js` | Rappresentazione a coppia con segno «+» |
| Statistiche e tracciabilità | `public/statistics-detail.js` (completezza lotti: `['component1','component2'].every(...)`; righe componente), `public/statistics.js`, `public/shopfloor.js` | «Lotti completi» richiede esattamente i due |

**Generalizzazione prevista:** tabella dei componenti dell'attività (posizione, articolo, quantità per unità, unità, **tracciamento del lotto: nessuno / facoltativo / obbligatorio**). Aloven = due righe, entrambe «obbligatorio». Migrazione additiva con backup, come già fatto altre volte.

## 2. Dati di avvio specifici del tessile (impatto A, via seed)

- `textile.mjs` → `migrateTextile` è **chiamata a ogni avvio** da `server.mjs:65`. Crea e rinomina macchine (ACC-01..04: hot melt PUR, calandra film/web, fiamma, polvere), tipi di lavorazione (`textile-*`) e piani di processo con ~60 coppie tessuto/schiuma-film-membrana, e **trasforma le macchine/tipi generici precedenti**. In un'installazione di un altro settore non andrebbe eseguita.
- Dati dimostrativi e storici: `seed-history.mjs`, `seed-demo-quantities.mjs`, `seed-planning-test.mjs`, `reduce-demo-duration.mjs`.
- **Generalizzazione:** i dati tessili diventano un *profilo* caricato per scelta (o solo per la demo), non una migrazione automatica del nucleo.

## 3. Vocabolario e testi (impatto M, via config)

- «Accoppiatura», «tessuto», «Difetto tessuto» (`scrap-reasons.mjs:20`), «Componenti consumati → Articolo prodotto», «Componente 1/2» e simili: sparsi nelle viste (vedi sezione 1) e nelle traduzioni IT/EN del bordo macchina (`public/operator.js`).
- **Generalizzazione:** etichette e causali in un dizionario di profilo; le causali di scarto fanno parte del profilo.

## 4. Marchio e nomi tecnici «Aloven» (impatto B, via marchio/config)

- Logo e testi: `public/aloven-logo.png`, `brandLogo()` in `public/app.js:81` (testo alternativo «Aloven — Accoppiatura dal 1985»), intestazione `ALOVEN / PRODUZIONE` (`public/app.js:91`), titolo e tag `Aloven · Operatore` in `public/operator.html`.
- Nomi tecnici: file DB `aloven.sqlite` (`server.mjs:31`), cookie `aloven_session`, header `X-Aloven-Request`, variabili `ALOVEN_NOW`, chiavi `localStorage` `aloven-*`, messaggio all'avvio.
- Riferimenti nei test e negli script di verifica: ~61 file (nome DB, variabili, header).
- **Generalizzazione:** nome prodotto, logo e testi da configurazione; nomi tecnici con prefisso neutro o configurabile, **con compatibilità per l'installazione esistente** (stesso file DB, cookie e variabili, per non invalidare sessioni e dati di Aloven). Marchio e dominio MesBeat ancora da verificare.

## 5. Parti già generiche (nessuna azione)

Pianificazione e calendario, scheduler, regole di attrezzaggio (`setupRules` per articolo/tipo, senza grandezze fisiche cablate come lo spessore), fermi, scarti, qualità, manutenzione, ruoli e utenti, statistiche e tracciabilità per lotto, backup, avanzamento live. Sono il nucleo.

## 6. Non toccare finché non c'è un secondo cliente

Dove oggi non sappiamo come cambierebbe un altro cliente (unità di misura particolari, più fasi, giacenze), non anticipare flessibilità. Gli ordini a più fasi nasceranno comunque come ordini distinti per livello dal MRP di Arca (da verificare).

## Ordine di lavoro suggerito (da non avviare senza richiesta)

1. Tag Git dello stato attuale (`aloven-1.0`) e backup del DB.
2. Lista dei componenti con attributo di tracciamento, insieme alla lettura delle distinte di Arca (sezione 1).
3. Isolare i dati tessili in un profilo (sezione 2) e portare vocabolario e causali in un dizionario (sezione 3).
4. Marchio e nomi tecnici configurabili, con compatibilità (sezione 4).

Ogni passo su branch breve, con la suite di test (159 al 15 ottobre) invariata.
