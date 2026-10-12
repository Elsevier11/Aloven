# Aloven — identità e interfaccia MES

Riferimenti approvati: `Prompt/01_dashboard_riferimento.html`, `02_bordo_macchina_riferimento.html`, `03_statistiche_riferimento.html` e `04_SPECIFICA_DESIGN.txt`. Sono riferimenti visivi, non una fonte di dati o regole. Logo, persone, codici e processi restano quelli di Aloven.

## Identità condivisa

Fonte dei token: `public/design-system.css`. Palette navy `#101B2D`, superficie scura `#17243A`, testo `#172033`, bordi `#E8ECF2`, sfondo `#F5F7FA`, bianco, blu `#2767ED`, verde `#22A06B`, ambra `#ED9D24`, rosso `#DF5C64`, viola `#7B61D9`. Il testo secondario approvato `#748096` ha una variante più scura `#58667B` per testi piccoli. Analogamente badge e testi operativi usano varianti scure: il colore non sostituisce mai lo stato scritto.

Spaziatura 4/8/12/16/20/24 px; angoli 8 px; font di sistema già presenti; numeri tabulari; bordi discreti; ombre minime. Nessuna dipendenza remota o sostituzione del marchio. Colori personalizzati delle tipologie restano dati aziendali. La timeline usa una palette per risorsa centralizzata; dopo otto risorse i colori si ripetono e il codice macchina continua a distinguerle.

## Desktop: operare e confrontare

Sidebar 224 px, topbar 56 px, titoli 24–28 px, testo operativo 13–14 px, label 12 px, controlli principali 38 px. Tabelle con padding verticale 8 px; le righe crescono se contengono dati multilinea necessari. Non imporre altezze che tagliano nomi, lotti o azioni.

Pianificazione: una sola timeline per macchine, contesto esplicito di bozza, versione operativa e rilascio, KPI sintetici e comandi. Sequenza completa e gestione della coda nel pannello Vedi sequenza della macchina; Prepara periodo nella toolbar. Tutti i pianificatori vedono la bozza; entrambe le console di reparto mostrano lo snapshot rilasciato per qualsiasi ruolo. Barre proporzionali alla durata, colori per macchina, preparazione ambra, testo e tooltip/tastiera per i segmenti brevi. Bozza e piano operativo restano distinti. Il trascinamento temporale sceglie giorno e ora, con passi di 15 minuti; il riepilogo consente una data precisa al minuto. Gli inizi fissati sono persistenti, gli spazi occupati o fuori calendario sono rifiutati e le altre attività non vengono spostate. Il riepilogo si chiude al salvataggio del posizionamento e la barra viene portata in vista, oltre le intestazioni ferme. Il trascinamento salva direttamente la bozza dopo la validazione del server; il rilascio al reparto resta esplicito e confermato. Altri comandi di riordino conservano anteprima e conferma. Attività avviate sempre protette. La Pianificazione desktop usa topbar da 36 px, titolo da 24 px e controlli da 34 px per lasciare spazio al piano; le altre sezioni mantengono le dimensioni condivise.

Liste: filtri vicini al contenuto, paginazione visibile, intestazioni ferme, scorrimento dei record. I dettagli non devono perdere ricerca, selezione, pagina o posizione. Form lunghi: corpo scorrevole e azioni raggiungibili; modifiche non salvate protette senza conferme per i dettagli in sola lettura.

## Bordo macchina: azioni touch

Identità comune con dimensioni distinte. Conservare i comandi principali da 90 px e i percorsi italiani/inglesi; controlli secondari touch almeno 48 px. Macchina e stato, lavorazione e lotto, fase/tempo, comando principale, prossime lavorazioni e storico. Nessuna azione essenziale affidata a hover.

Preparazione, produzione e dichiarazione restano le fasi reali. Riattivazione macchina e ripresa della lavorazione sono separate. Le quantità sono dichiarate alla conclusione: non mostrare avanzamenti incrementali o fine effettiva simulati. Stato connessione riferito all'app, non a un PLC inesistente.

## Statistiche: significato prima dei numeri

Quattro viste: Panoramica, Produzione, Qualità e scarti, Macchine. Quantità distinte per unità; andamento buona/prevista delle stesse lavorazioni chiuse; donut delle causali fermo; mappa di ore attive; articoli, velocità, scarti e confronti macchina. Aggregato → record selezionati → consuntivo → lotti, con contesto e ritorno.

La mappa di ore attive non è una saturazione; la conformità dei controlli non è il fattore qualità OEE. Nessun target, costo, puntualità, OEE o durata residua inventati. Il pannello dei fattori OEE documenta i dati mancanti: tempo produttivo di riferimento, classificazione di setup/pulizia/fermi, standard convalidati per articolo/macchina e trattamento di scarti/rilavorazioni. Nessuna nuova formula o regola aziendale viene introdotta.

## Manutenzione

Fluidità del piano: modalità visibili Sposta solo questa / Inserisci e sposta le successive, anteprima server dell’intero ingombro e dei conflitti durante il gesto. Date fissate riconoscibili sulle barre e nella sequenza; modulo di posizionamento prioritario con scelta risorsa e rimozione del vincolo. Riordino della sequenza con drag e pannello conservato dopo la conferma. Annulla ultimo spostamento ripristina l’intera modifica finché revisione e token restano validi; feedback esplicito durante salvataggio. Il normale caricamento del planner esclude lo storico operativo: completate e dettagli vengono richiesti esplicitamente, conservando il contesto minimo e la validazione completa del motore.

Pianificazione: Azioni macchina → Manutenzione apre un intervallo nominato di indisponibilità, visibile con tratteggio ambra nella timeline; blocchi brevi identificati da una chiave e nome accessibile completo. Il clic sul blocco permette modifica o rimozione. Ogni operazione mostra prima le nuove date della coda e salva in bozza; le indisponibilità arrivano al reparto solo con il rilascio. Turni sottostanti conservati, attività precedenti preservate e conflitti con inizi fissati o attività protette segnalati senza spostamenti silenziosi.

Per nuove schermate riutilizzare token e componenti esistenti. Le eccezioni dimensionali vanno motivate dal compito, non dal mockup. Prima di cambiare flussi consultare `MEMORIA_PROGETTO.md`. Verificare desktop e touch su dati isolati; i mockup e lo storico DEMO non costituiscono prova dell'idoneità produttiva.
