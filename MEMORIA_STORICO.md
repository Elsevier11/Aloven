# Aloven — memoria storica

Sezioni di MEMORIA_PROGETTO.md spostate il 13 ottobre 2026 perché superate da decisioni successive o di sola verifica. Il testo è invariato; non descrive lo stato attuale. Per i requisiti correnti leggere MEMORIA_PROGETTO.md.

<!-- Sostituita dalla pianificazione unica sul calendario per macchine (sezione «Pianificazione unica e coerenza bozza/rilascio», 12 ottobre 2026). -->
## Vista di assegnazione a tre pannelli — 9 ottobre 2026

Vista iniziale Per macchina: a sinistra lavorazioni da assegnare in righe compatte (prodotto/lotto, quantità, durata complessiva, codice macchina), al centro macchine ricercabili con stato e carico nel periodo, a destra sequenza completa della macchina selezionata oppure timeline del giorno/5 giorni. Panoramica reparto conserva il Gantt con tutte le macchine. Elenchi con scorrimento interno, senza scorrimento della pagina desktop; provata una configurazione con 12 macchine.

Filtro facoltativo Solo per la macchina selezionata; compatibilità evidenziata. Selezionando una lavorazione, la vista segue la sua macchina obbligatoria: non modifica l'assegnazione prevista. I dati estesi sono disponibili al passaggio del mouse/focus e nella scheda completa. Riepilogo temporaneo per inserimento in coda/prima/dopo; conferma degli spostamenti e ricalcolo restano quelli esistenti. Il riepilogo si chiude dopo il salvataggio. Drag-and-drop, ritorno da assegnare e attività bloccate preservati. La sequenza è completa, mentre giorno/5 giorni limitano timeline e calcolo del carico. Nessuna modifica al database operativo o al bordo macchina.

Verifica dedicata: npm run test:dispatch, database temporaneo, 8 scenari browser incluse assegnazione, riordino, trascinamento, macchina incompatibile, ritorno da assegnare, tastiera, ricerca su 12 macchine e layout desktop/mobile.


<!-- Vista a tre pannelli sostituita dalla pianificazione unica (12 ottobre 2026); resta valida solo la sequenza completa nel pannello «Vedi sequenza». -->
## Finitura della vista Per macchina — 9 ottobre 2026

Dopo il riscontro sullo screenshot: colonna macchine fissa a 240 px desktop (190 px alle larghezze minori); coda con righe leggere e separatori, senza cornice su ogni scheda; titoli 14 px e informazioni operative 13 px. Quantità ordine in evidenza quando presente, trattino per i dati non ancora disponibili: nessuna quantità inventata o modifica ai dati operativi. Date con etichette Inizio/Fine e disposizione adattiva.

La sequenza rimane completa, con conteggio delle attività nel periodo e righe evidenziate per il giorno/5 giorni scelti. Dicitura Nel giorno/Nel periodo oppure Altri giorni. L'evidenziazione usa i segmenti effettivi: non include automaticamente i giorni chiusi tra due porzioni della stessa attività. Carico senza disponibilità indicato n/d. Verificati 42 test unitari/HTTP, 9 scenari browser dedicati, 33 schermate desktop, 11 mobile e 9 form della suite premium. Database temporanei per le prove.


<!-- Misure e palette sostituite dall'identità comune del 12 ottobre 2026 (design-system.css, DESIGN.md). -->
## Rifinitura visiva MES enterprise — 11 ottobre 2026

Applicato il successivo brief dell'utente alla UI esistente: sidebar navy da 208px, top bar da 40px, titolo desktop da 28px, pulsanti principali e controlli periodo/macchina da 40px, testo dati da 13px, label da 11–12px, pannelli con angoli da 8px e ombre lievi. Toolbar desktop organizzata in gruppi stabili, colonne durata più leggibili, sfondo grigio chiaro e pannelli bianchi. Attività pianificate in blu tenue; verde per lavorazioni in corso, ambra per attrezzaggio, completate in grigio. Nessun gradiente decorativo o dashboard con indicatori inventati. Sidebar e palette condivise rifinite anche nelle altre sezioni; struttura mobile conservata.

Nessuna modifica a funzionalità, dati, route, API, permessi o flussi in questa rifinitura: solo CSS e verifiche geometriche aggiuntive. A 1366×768 sequenza da y217 e calendario da y193, con tutte e quattro le macchine visibili; il lieve aumento rispetto alla precedente compattazione rispetta titolo e controlli più leggibili richiesti nel nuovo brief.

Verifiche superate: 5/5 scenari densità a 1366, 1920, 1024 e 390px, 9/9 flussi pianificazione, test:ui e test:interface. Verificati dimensioni sidebar/titolo/controlli, ricerca, selezione, filtri periodo, posizioni globali, trascinamento, CRUD, calendario, sei voci di navigazione e assenza di overflow mobile. Controllo visivo su copia dei dati attuali; CSS locale HTTP 200. Test su DB isolati, nessuna scrittura al DB operativo. Il confronto con la firma della precedente sessione rileva variazioni in tasks e mesAuditLog (conteggio attività invariato) e invarianti le altre 16 tabelle: non viene utilizzato per dichiarare immutata l'intera base fra sessioni. Nessun commit/push eseguito.


<!-- Rapporto di verifica: i problemi riprodotti sono stati risolti nella sezione «Fluidità del planner e caricamento operativo». -->
## Verifica di usabilità del posizionamento — 12 ottobre 2026

Richiesta: valutare precisione e fluidità dei gesti di pianificazione con riferimento all’esperienza attesa di Microsoft Project, senza modificare i comportamenti prima di concordare gli interventi. Eseguiti gesti reali in Edge su copia consistente del DB operativo (2.402 attività incluse cinque di prova) e fixture separate. Posizionamento libero, cambio macchina, date future al minuto, persistenza, rifiuti senza scritture e visibilità della barra funzionano. Autoscroll orizzontale nativo verificato, 0→578 px su 593 px massimi: non è un difetto. Drop→barra 285 ms; LCP 520 ms, CLS 0, evento di interazione massimo osservato 160 ms nella prova locale.

Problemi riprodotti, da correggere solo dopo accordo con l’utente: indicatore valida solo l’inizio e può proporre una posizione che poi fallisce per ingombro completo; errore con ID tecnico anziché nomi operativi; trascinamento delle righe di Vedi sequenza senza effetto; frecce con conferma e chiusura del pannello a ogni mossa; inizi fissati non riconoscibili visivamente e distinzione poco evidente tra spostamento singolo e ricalcolo della coda; label data/ora del marker troppo stretta; assenza di Annulla ultimo spostamento e di feedback durante commit ritardato artificialmente. In emulazione touch il gesto non genera drag/drop: da validare su tablet fisico, non dichiarato difetto universale.

Nessuna modifica funzionale, riavvio o scrittura di prova sul DB operativo. Report con riproduzioni, proposte, manifest e limiti: .artifacts/planner-usability-report.json; screenshot planner-usability-*.png. Zero errori JavaScript/warning osservati e nessun 5xx/403/404 nella prova. Verifica mirata ai flussi richiesti, non audit completo dell’applicazione/accessibilità. Miglioramenti proposti restano non implementati.

