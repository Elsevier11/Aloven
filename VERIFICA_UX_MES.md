# Obiettivo qualità operativa MES — avanzamento e verifica

## Perimetro

Richiesta dell'11 ottobre 2026: adeguare le aree esistenti ai riferimenti in `Prompt`, conservando autenticazione, API, permessi, calendario, pianificazione/rilascio, consuntivi, audit e tracciabilità. Nessuna integrazione, migrazione o modifica delle regole produttive autorizzata da questo incarico. Dati operativi esclusi dalle prove.

## Mappa delle aree

| Area esistente | Utilizzatore / lavoro principale | Percorso |
| --- | --- | --- |
| Pianificazione | Pianificatore: scegliere periodo, ordinare, verificare capacità, rilasciare | `/`, navigazione interna |
| Attività | Pianificatore/operatore: ricerca, scheda, tempi, destinazione compatibile | navigazione interna |
| Tracciabilità | Responsabile: lotto prodotto ↔ componenti dichiarati | Attività → Tracciabilità |
| Verifiche qualità | Responsabile: esiti, decisioni e rettifiche motivate; permessi amministratore | Attività → Verifiche qualità |
| Bordo macchina classico | Operatore: preparazione/produzione, fermi, dichiarazione | `/bordo-macchina` |
| Console tablet IT/EN | Operatore: stessi flussi, bersagli touch e dichiarazione guidata | `/operatore` |
| Statistiche | Responsabile: analisi reali, filtri, approfondimenti ed Excel | navigazione interna |
| Anagrafiche | Amministratore: macchine, articoli, tipologie, attrezzaggi, causali | gruppo navigazione interno |
| Configurazione | Amministratore: calendario, utenti, audit e backup; calendario secondo permessi esistenti | gruppo navigazione interno |

Stack: Node.js e SQLite, frontend ES modules/CSS senza framework o nuove librerie. Avvio documentato `npm start`; test `npm test` e script browser del `package.json`. Route e servizi operativi conservati; aggiunte soltanto risorse statiche di presentazione.

## Diagnosi e ordine di intervento

1. Unificare palette e dimensioni condivise: override locali divergevano tra pianificazione, statistiche e console touch.
2. Mantenere il piano subito disponibile, aumentare densità delle tabelle preservando la leggibilità e i dettagli.
3. Proteggere modifiche nei form e invii in corso; conservare posizione e contesto degli elenchi.
4. Adeguare bordo macchina senza comprimere comandi efficaci o aggiungere conferme nelle azioni ordinarie.
5. Riconciliare presentazione statistiche con significato dei dati; dichiarare esplicitamente le analisi non calcolabili.
6. Verificare flussi, geometria, errori, tastiera e touch; confrontare con gli HTML renderizzati.

## Evidenze iniziali e loro limiti

I tre HTML sono stati aperti e renderizzati in Edge/Playwright a 1366×768 e 1920×1080. Artefatti in `.artifacts/mes-excellence/screens/prompt-*`.

La cattura iniziale dell'app è coincisa con modifiche concorrenti ai CSS: `.artifacts/mes-excellence/baseline.json` e `baseline-diagnosis.md` registrano questo limite e gli errori MIME transitori del server di test avviato prima della nuova risorsa statica. Queste immagini **non sono una baseline visiva integra**. Le geometrie precedenti agli override dimensionali restano confrontabili: sidebar 208 px, topbar pianificazione 40 px, timeline 560 px di altezza a 1366×768, tabella Attività con righe multilinea di circa 84 px. Non attribuire alla versione originaria difetti di colore causati dalla cattura concorrente. Lo screenshot `Prompt/07_*` documenta una versione precedente, non lo stato iniziale di questo intervento.

Il browser integrato non è utilizzabile dal tool CUA in questa sessione (errore avvio kernel). Verifica operativa disponibile tramite Edge/Playwright, server locali e database temporanei. Non è una verifica dell'hardware touch fisico.

## Checklist di completamento

- [x] Lettura memoria, istruzioni, specifica e tre HTML; rendering dei riferimenti.
- [x] Mappa aree, ruoli e flussi; conservazione delle modifiche preesistenti.
- [x] Token condivisi e documentazione `DESIGN.md`.
- [x] Integrazione UX desktop e console touch.
- [x] Browser desktop 1366×768 e 1920×1080 a zoom 100%, touch 1280×800 provvisorio.
- [x] Flussi pianificazione/rilascio e operatore completo su dati isolati.
- [x] Filtri, ritorno dai dettagli, form, errori di rete, invii duplicati e permessi.
- [x] Statistiche, drill-down, unità, zero/assente e riconciliazione degli aggregati.
- [x] Test backend e regressioni browser pertinenti; assenza di errori JavaScript.
- [x] Firma dati operativi conservata e screenshot aggiornati raccolti.

## Dati da concordare, fuori dall'implementazione attuale

OEE: servono definizioni aziendali convalidate dei tre fattori e della base temporale. Arca e multifase restano rimandati. Rotoli/bobine individuali, avanzamenti quantitativi incrementali e dati PLC non sono presenti: nessuna UI ne simula l'esistenza. La validazione con responsabili e operatori reali resta necessaria per l'adozione.

## Stato finale — 12 ottobre 2026

Integrazione e verifica completate in sviluppo, senza deploy o commit/push. Identità comune in DESIGN.md; desktop distinto dal touch. Consegne da date reali con dettaglio ordine/ERP/cliente/lotto; posizioni protette escluse dal selettore. Attività mantiene otto colonne, disclosure delle descrizioni e contesto al ritorno. Form proteggono modifiche non salvate e invii in corso. Bordo classico presenta il comando prima dei dati di supporto; touch mantiene comandi da 90 px. Statistiche conserva quattro viste e approfondimenti reali, con scale quantitative e OEE correttamente indisponibile.

### Misure ed eccezioni

| Profilo | Inizio piano | Altezza piano | Risultato |
| --- | ---: | ---: | --- |
| 1366×768, 100% | 268 px | 482 px (63% viewport) | quattro risorse visibili, nessuno scroll esterno |
| 1920×1080, 100% | 222 px | 840 px (78% viewport) | ampia scala oraria |
| Touch 1280×800 | lavorazione a 233 px | comando a 699 px, alto 90 px | primo passaggio interamente visibile |

La maggiore leggibilità aumenta l’ingombro rispetto alla precedente UI già compattata: non si dichiara un guadagno verticale rispetto alla cattura iniziale parziale (560/872 px). Il beneficio riguarda gerarchia, azioni e colonne leggibili. Le righe Attività hanno mediana 50–70 px nella fixture: nomi, stati e date multilinea non permettono 36–44 px senza perdita; prima riga con riferimenti aggiuntivi 76 px a 1366, 60px a 1920. A 1024 le toolbar vanno su più righe (limite test 340 px), eccezione tablet gestionale. Il bordo classico consente scroll per tempi/storico, ma il comando principale è subito visibile; grafici e form lunghi mantengono scroll interno. Nessun overflow del documento nelle 32 viste desktop, nessun overflow del primo passaggio touch. Contrasti delle coppie token testo/badge/barre verificate almeno 4,94:1; non audit completo di accessibilità.

### Controlli superati

- `npm test`:81/81 unitari/HTTP. Corretto test interruzione che usava il giorno UTC anziché Europe/Rome alla mezzanotte.
- `test:design`:32 viste desktop (16 aree × 2 profili), tre tab statistiche aggiuntive, Consegne→dettaglio e touch1280×800; nessun errore JS. Report `.artifacts/mes-excellence/final/report.json`.
- `test:operational`:18/18, inclusi anteprima, riordino, calendario, validazione, concorrenza, attività avviate e permessi. Test confermano esplicitamente scarto dei form modificati.
- `test:desktop-flow`:6/6, dirty form, doppio invio, errori e contesto. `task-list-check.mjs`: riferimenti lunghi, disclosure tastiera, paginazione, selettore protetto e ritorno a 1366/1920.
- `test:dispatch`:9/9; `test:planning-density`:5/5; `test:mes`:9/9; `test:statistics`:14/14 (aggregati/dettagli, tracciabilità, null/zero, errori/retry, export).
- `test:operator`:6/6; `test:release-operator`:3/3 più controllo temporaneo aggiuntivo, passato, sulla visibilità del comando classico alle due risoluzioni.
- `test:resilience`:5/5; `test:ui`, `test:interface`, `test:premium` passati, incluse tastiera, mobile, form e zoom equivalente125%.
- Sintassi, `git diff --check` e detector mirato passati. Nessuna build separata prevista dallo stack ES modules/CSS.
- SHA-256 delle righe delle 18 tabelle operative prima/dopo identica, escluse sessioni/meta. Scritture di prova solo su database temporanei.

### Schermate e limiti

Schermate in `.artifacts/mes-excellence/final`: `planning-{1366x768,1920x1080}.png`, `tasks-1366x768.png`, `statistics-1366x768.png`, `statistics-{machines,quality,production}-1366x768.png`, `shopfloor-1366x768.png`, `operatore-1280x800.png`; tutte le altre aree hanno le due catture. Artefatti esclusi da Git.

Nessun blocco tecnico residuo nel perimetro verificato. OEE e analisi non supportate restano dichiarate indisponibili secondo il brief: servono definizioni aziendali, non un ritocco UI. Prova di responsabili/operatori e hardware touch fisico da eseguire prima di valutare idoneità produttiva.


## Correzione successiva del drill-down — 12 ottobre 2026

Rilevato e corretto dettaglio generico identico per KPI produzione/qualità/lotti. Ogni analisi ha colonne e riepiloghi dedicati; Conformità e Lotti completi selezionano le popolazioni corrette. Il test browser statistiche conta ora 16 scenari, incluse regressioni specifiche e nessuna scrittura API. Screenshot .artifacts/statistics-detail-{blue,green,purple}-1366.png e statistics-detail-trace-mobile.png. Test backend statistici 4/4. Dettagli implementati in public/statistics-detail.js, descrittori in public/statistics.js; nessuna API/regola produttiva cambiata.
