# Aloven — Pianificazione della produzione

Web app in italiano con server Node.js, database SQLite persistente e interfaccia senza dipendenze esterne.

## Avvio

Richiede Node.js **22.13 o successivo** (verificata con 22.20).

```powershell
cd C:\Dev\Aloven
npm start
```

Apri http://127.0.0.1:3000. Al primo accesso crea l'amministratore scegliendo nome utente e password (almeno 10 caratteri). Non ci sono credenziali predefinite. Su un nuovo database sono presenti quattro macchine e quattro tipologie per l'accoppiatura tessile, con 64 attività dimostrative non pianificate: quattro esempi adattati e 60 nuovi.

Il database viene creato in `data/aloven.sqlite`. I dati e gli accessi persistono dopo il riavvio. Per un backup semplice arresta il server e copia la cartella `data` intera.

## Utilizzo

- **Pianificazione**: trascina una scheda da “Da assegnare” sulla sua macchina. Trascina sopra un'altra scheda per inserirla prima; in una zona libera per accodarla. Il giorno su cui viene effettuato il drop non fissa la data: la posizione nella sequenza e il calendario determinano gli orari, senza intervalli arbitrari. Una scheda spostata nella colonna “Da assegnare” torna non pianificata.
- Il menu **⋯** permette di scegliere la posizione senza trascinare. “Vedi sequenza” mostra tutta la coda, anche oltre i giorni visibili. Puoi cambiare il primo giorno visualizzato e filtrare per macchina.
- **Attività**: CRUD con macchina obbligatoria, tipologia, attrezzaggio ed esecuzione in minuti, note. Sono obbligatori due componenti consumati e un articolo prodotto, ognuno con codice e descrizione. La ricerca trova titolo, codici e descrizioni. Cambiare macchina a un'attività già pianificata la riporta da assegnare e ricompatta la coda precedente.
- **Macchine**: CRUD, data/ora di inizio pianificazione e velocità in m lineari/min, m²/min o kg/min. Modificare la velocità ricalcola le attività automatiche non bloccate con anteprima.
- **Tipologie**: CRUD con colore per riconoscere le lavorazioni.
- **Articoli**: anagrafica centralizzata con codice univoco, descrizione, unità di misura e uso come componente, prodotto o entrambi. Le attività selezionano gli articoli dall'anagrafica. Le modifiche aggiornano i dati delle attività non bloccate; le attività in corso e completate conservano i dati storici. Gli articoli utilizzati non possono essere eliminati.
- **Attrezzaggi**: regole per macchina, tipologia precedente e tipologia successiva. Il tempo della regola sostituisce il tempo base dell'attività. Prima attività o passaggio senza regola: tempo base. Un riordino ricalcola anche gli attrezzaggi dei passaggi interessati. Le regole inizialmente sono vuote: inserire valori reali del reparto.
- **Calendario**: settimana generale con un massimo di due fasce per giorno, applicazione di orari a più giorni, eccezioni per singole date o periodi fino a 366 giorni. Il mese mostra le disponibilità. Le eccezioni delle singole macchine prevalgono sulle eccezioni generali, che prevalgono sulla settimana standard. “Ripristina standard” elimina l'eccezione selezionata.
- **Utenti**: l'amministratore gestisce utenti, ruoli e password. Gli operatori gestiscono attività, sequenze e avanzamento; macchine, tipologie e calendario sono in sola lettura. Deve rimanere almeno un amministratore.

## Bordo macchina

La seconda interfaccia è disponibile su **http://127.0.0.1:3000/bordo-macchina**, con lo stesso login e database. Si apre anche dal menu “Bordo macchina” o dai dettagli di un'attività. La scelta della macchina e della finestra delle prossime fasi viene ricordata su quel dispositivo.

La fase corrente è la prima attività pianificata non completata della macchina, oppure quella già in corso. L'operatore registra nell'ordine **inizio attrezzaggio → fine attrezzaggio → inizio lavorazione → fine lavorazione**. Se l'attrezzaggio previsto è zero può avviare direttamente la lavorazione. Il primo avvio blocca l'attività in stato “In corso”. Una lavorazione può essere sospesa e ripresa; la sospensione richiede un motivo e non contribuisce al tempo attivo di lavorazione. L'attrezzaggio non è sospendibile in questa versione.

La chiusura richiede la quantità buona, la quantità scartata (anche zero), i controlli qualità e almeno un lotto per ciascuno dei due componenti, con quantità effettivamente consumata. Possono essere dichiarati più lotti/rotoli per componente (massimo 50 righe totali). I codici lotto sono testi liberi; le unità provengono dagli articoli e vengono congelate all'avvio. Una dichiarazione con quantità buona zero richiede una nota di chiusura e comunque i lotti consumati. Il salvataggio è atomico: dichiarazione, qualità, scarti, lotti, evento operatore e completamento vengono registrati insieme. Non vengono aggiornate giacenze o disponibilità di magazzino.

Il campo barcode supporta lettori USB/Bluetooth che scrivono come una tastiera: inserire il codice e premere Invio, oppure “Applica barcode”. Formati: `LOTTO`, `ARTICOLO|LOTTO`, `ARTICOLO|LOTTO|QUANTITÀ`. L'articolo viene confrontato con il componente; la quantità eventualmente presente deve coincidere con quella consumata dichiarata. È sempre possibile inserire manualmente lotto e quantità. La scansione viene conservata insieme alla dichiarazione.

Gli scarti richiedono una motivazione. I controlli di aspetto e adesione richiedono un esito esplicito: regolare, difetto o non applicabile. L'esito complessivo è conforme, non conforme o da verificare; gli ultimi due richiedono note. Non si può dichiarare conforme con un difetto o entrambi i controlli non applicabili. Questi sono controlli generici dell'operatore, da adattare alle specifiche tecniche reali dei prodotti.

Il confronto previsto/effettivo mostra attrezzaggio e lavorazione, scostamenti a fase conclusa, quantità buona e scarti con incidenza sul totale prodotto. I valori previsti sono congelati all'avvio, il tempo di lavorazione esclude le sospensioni. Per le dichiarazioni precedenti qualità e scarti rimangono non rilevati; il previsto viene recuperato dall'attività disponibile durante la migrazione, quindi può non rappresentare il piano originario.

Le date effettive sono generate dal server e visualizzate in Europe/Rome, separate dalle date pianificate. Il registro conserva orario, operatore, azione e motivo. I dati sono condivisi con pianificazione e altri terminali; revisioni concorrenti e doppi tocchi vengono rifiutati. Le attività con rilevazioni si completano da bordo macchina, con dichiarazione obbligatoria.

La finestra iniziale delle prossime fasi è **oggi e prossimo giorno lavorativo della macchina**, rispettando il calendario e le eccezioni. Sono selezionabili anche “oggi e domani” e “prossime 5 attività”. Si mostrano al massimo 5 attività, con attrezzaggio e lavorazione di ognuna; la corrente resta sempre visibile, anche se in ritardo o fuori finestra. In assenza di un prossimo giorno lavorativo nei 366 giorni seguenti viene mostrato soltanto oggi.

Le attività già “In corso” prima di questa versione possono iniziare la rilevazione della fase corrente senza ricostruire orari storici mancanti. Gli orari effettivi non spostano automaticamente le altre attività della pianificazione.

## Accoppiatura tessile

Gli esempi rappresentano quattro processi: hot melt PUR, accoppiatura termica film/web, accoppiatura a fiamma e accoppiatura a polvere. Le coppie di materiali comprendono tessuti, membrane, schiume e supporti non tessuti per outdoor, calzatura, arredamento, automotive e tessuti tecnici. Ogni lotto identifica due materiali in ingresso e un accoppiato in uscita.

I codici, le descrizioni e i tempi sono dati dimostrativi, non distinte base o parametri tecnici validati. I due componenti sono interpretati come i due substrati da accoppiare; adesivi e ausiliari di processo non sono gestiti come consumi aggiuntivi. La quantità da produrre e l'unità dell'articolo consentono il calcolo automatico del tempo. Il bordo macchina registra consumi e lotti dichiarati, senza movimentare magazzino o giacenze.

Il calcolo automatico usa **minuti = arrotondamento per eccesso (quantità / velocità macchina)**, con unità di misura coincidenti. La quantità è quella dell'articolo prodotto, senza aggiungere consumi o scarti. Il tempo di attrezzaggio è aggiunto separatamente. È sempre disponibile il tempo manuale, utile per lavorazioni con velocità specifiche. Le velocità iniziali (10 m/min) sono indicative e vanno impostate sui valori reali. La migrazione mantiene tutte le attività esistenti in modalità manuale, senza modificarne le durate.

Il catalogo iniziale viene costruito dai codici già presenti nelle attività e conserva i riferimenti. Utenti, calendario e pianificazione rimangono nel database esistente. Gli operatori selezionano gli articoli e modificano attività; la gestione diretta di catalogo, velocità e regole è riservata agli amministratori.

L'aggiornamento del database è transazionale e avviene una sola volta. Conserva utenti, calendari, attività personalizzate e pianificazioni. Rinomina solo le macchine/tipologie originali ancora identiche agli esempi iniziali. Le attività iniziali non bloccate vengono adattate mantenendo i tempi e la sequenza; quelle personalizzate e bloccate restano intatte e possono mostrare campi da completare. Le attività dimostrative eliminate o modificate non vengono ricreate ai successivi avvii.

Riferimenti per i processi di esempio: [Monti Antonio — hot melt](https://www.montiantonio.com/en/products/category/bonding/hot-melt-textiles), [film/web](https://www.montiantonio.com/en/products/category/film-web-bonding) e [Aitex — linee hot melt e a fiamma](https://www.aitexsrl.com/a-hot-melt). Le macchine dell'app sono esempi generici, senza attribuzione a modelli commerciali specifici.

## Vista operatore per tablet

Apri `/operatore`, oppure premi **Vista touch** nella maschera bordo macchina. La vista originale resta disponibile. La nuova interfaccia utilizza gli stessi utenti, dati e regole di reparto: preparazione, produzione, pausa/ripresa e dichiarazione finale. Lingua italiano/inglese e postazione vengono ricordate sul dispositivo. I nomi e le descrizioni del catalogo conservano il testo originale: non vengono tradotti automaticamente.

Il comando principale resta visibile nella barra inferiore. Avvio/fine preparazione, avvio/ripresa produzione e chiusura del fermo si registrano direttamente, senza finestre di conferma. Pausa e segnalazione fermo richiedono solo il motivo. La dichiarazione finale ha tre passi: quantità, lotti dei due componenti e controlli qualità. La quantità prevista è proposta quando presente, con scarti inizialmente a zero; note e motivi compaiono solo per quantità buona zero o scarti positivi. Il riepilogo è consultabile facoltativamente nell'ultimo passo. “Completa attività” salva e chiude direttamente, senza checkbox o altra conferma. Sono supportati più lotti e lettori barcode che inviano testo come una tastiera, oltre all'inserimento manuale. Le prossime tre attività sono mostrate in ordine di sequenza. La segnalazione del fermo registra lo stato nel gestionale; non comanda fisicamente la macchina. Chiudere il fermo non riprende automaticamente la lavorazione.

`npm run test:operator` esegue la verifica browser dedicata con Playwright e Microsoft Edge su database temporaneo; `HEADFUL=1` mostra il browser. Report e schermate in `.artifacts/operator-report.json` e `.artifacts/operator-*.png`. La comprensibilità senza spiegazioni va validata anche con gli operatori reali e nelle loro lingue.

## Regole di pianificazione

Nella pianificazione, il titolo di una scheda in attesa o un blocco temporale seleziona la lavorazione e apre un riepilogo affiancato al calendario (sopra il piano su tablet/mobile). **Scheda completa** conserva i dettagli e le azioni precedenti. Dal riepilogo si può assegnare/spostare in coda, prima o dopo un'altra attività della stessa macchina, con anteprima e conferma; sono proposte solo posizioni successive alle attività bloccate. **Mostra giorno e macchina** concentra il piano sulla lavorazione. Densità schede Normale/Compatta e zoom temporale sono impostazioni separate e persistenti.

Sui blocchi, frecce e Home/End navigano le attività della stessa macchina; Invio/Spazio aprono il riepilogo. Escape chiude il riepilogo e restituisce il focus al controllo di origine. I tooltip funzionano con mouse e focus, restano visibili passando il puntatore sul contenuto e sono chiudibili con Escape anche senza focus sul blocco. Tutti i segmenti selezionati sono evidenziati; gli stati sono indicati anche testualmente. La geometria temporale non viene alterata per ingrandire i blocchi brevi. Test dedicato: `npm run test:planner`, su database temporaneo con Edge/Playwright; report in `.artifacts/planner-report.json`.

La voce **Statistiche** mette in primo piano quattro grafici: produzione mensile buona/scartata, ore macchina previste/effettive, scarti per causale e ore di fermo per causale. I grafici riportano valori e unità, sono navigabili da tastiera e separano le quantità con unità diverse. **Mostra tabelle** apre il dettaglio per mese, macchina, prodotto, causale di scarto, causale di fermo e dettaglio delle attività completate. Filtri per date inclusive e macchina; la produzione viene attribuita alla data di completamento in Europe/Rome. Quantità separate per unità, confronto ore previste/effettive e scarto percentuale calcolato sul totale buona + scarto. Fermi conteggiati per la sola parte sovrapposta al periodo selezionato; quelli aperti sono limitati all'ora corrente. I dati mancanti restano distinti dallo zero. Lo storico simulato è incluso e segnalato.

**Esporta Excel** scarica un vero `.xlsx` con sette fogli (riepilogo e sei tabelle), tutte le righe filtrate, celle numeriche, percentuali, intestazioni bloccate e filtri Excel. Le stringhe vengono esportate come testo. Lettura ed export richiedono autenticazione e non modificano il database. `npm run test:statistics` esegue le prove browser in Edge su database temporaneo, con report e schermate in `.artifacts` (richiede Playwright come le altre suite browser).

La console usa regole condivise per testi, contrasto, focus tastiera, moduli e comandi. Calendario, anagrafiche, pianificazione e bordo macchina mantengono la stessa palette; la vista operatore conserva i pulsanti touch principali da 90 px. `npm run test:interface` verifica tutte le dieci sezioni della console a larghezza desktop e mobile, il focus tastiera e un dialog mobile, senza usare i dati reali.

Il menu principale contiene sei destinazioni: Pianificazione, Attività, Bordo macchina, Statistiche, Anagrafiche e Configurazione. Macchine, articoli, tipologie, attrezzaggi e causali si trovano nel menu interno di Anagrafiche; calendario e utenti in Configurazione, secondo i permessi. Il piano desktop adatta l'altezza allo schermo con scroll interno delle attività e della timeline. Contatori e carico sono compatti, gli avvisi espandibili e **Opzioni vista** raccoglie zoom, densità e completate. Verificati 1920×1080 e 1366×768, incluso spazio equivalente al 125% di ingrandimento; su mobile la pagina può scorrere.

Tutte le sezioni del gestionale desktop mantengono titolo e menu visibili con scorrimento nei contenuti. Gli elenchi hanno paginazione 25/50/100, conteggio risultati e colonne di riferimento/azioni ferme; nella tabella Attività i componenti mostrano i codici e aprono le descrizioni al clic. Il calendario ha eccezioni espandibili e comandi della settimana sempre disponibili. Nei moduli lunghi scorre il corpo, mentre Salva/Annulla restano visibili. `npm run test:premium` verifica 33 viste desktop, 11 mobile, 9 moduli e le operazioni di ricerca/paginazione su un database temporaneo popolato con lo storico dimostrativo; richiede Edge e Playwright. Il bordo macchina mantiene la propria interfaccia dedicata.

Le sezioni **Causali scarto** e **Causali fermo** gestiscono due tabelle distinte nel database. Gli amministratori possono creare, modificare, attivare/disattivare ed eliminare le causali non utilizzate. Una causale utilizzata va disattivata: il codice e la descrizione della registrazione vengono conservati come snapshot e non cambiano se l'anagrafica viene aggiornata. Sono incluse causali iniziali modificabili per l'accoppiatura tessuti, con descrizioni italiane e inglesi. Lo scarto positivo e la segnalazione del fermo richiedono una causale attiva selezionata; non è proposta automaticamente. I motivi storici inseriti come testo restano conservati.

Lo storico dimostrativo per analisi si carica con `node seed-history.mjs`, sul database già inizializzato dall'applicazione; `DATA_DIR` permette di scegliere un'altra cartella. Copre dicembre 2025–settembre 2026: nel database attuale 2.332 lavorazioni completate, 12.120 eventi, 6.079 dichiarazioni di lotti e 392 fermi chiusi. Include tempi previsti/effettivi, scarti con causali, qualità, tre operatori DEMO e minore carico estivo. I dati sono identificati dal prefisso ID `sim10m-v1` e dai titoli DEMO-STORICO. Gli utenti demo hanno password casuali non distribuite e servono solo al collegamento delle rilevazioni. I coefficienti di consumo sono simulati, senza movimentazioni reali di magazzino. Il caricamento è additivo e transazionale, crea un backup in `data/backups`, verifica la conservazione delle righe esistenti e non duplica i dati alla seconda esecuzione. Riepilogo mensile in `data/history-demo-report.json`; database e backup restano esclusi da Git.

La vista Giorno mostra una scala oraria verticale e una colonna per macchina; la vista 5 giorni è un Gantt orizzontale. Ogni segmento occupa spazio proporzionale ai minuti previsti, con colore stabile per attività e attrezzaggio tratteggiato. Le fasce non lavorative sono visibili. Mouse e tastiera aprono un riepilogo; il clic apre dettagli e gestione della posizione. Le completate restano nel database, nascoste nel piano salvo selezione di “Mostra completate”.

“Ferma macchina” registra motivo e operatore, sospende l'eventuale lavorazione attiva e blocca avvii/riprese. L'attrezzaggio indivisibile deve essere concluso prima del fermo. “Riattiva macchina” chiude il fermo, senza riprendere automaticamente la lavorazione. I tempi reali sono conservati; le date pianificate non vengono cambiate automaticamente per un fermo di durata ignota e vanno verificate alla ripresa. “Manutenzione programmata” apre le eccezioni del calendario della macchina: selezionare giorni chiusi oppure ridurre le fasce disponibili. Il ricalcolo richiede conferma e rispetta i blocchi delle attività in corso/completate.

L'attrezzaggio avviene una sola volta e non è frazionabile: deve entrare in una singola fascia, senza attraversare la pausa pranzo o la fine giornata. Se non entra nella disponibilità residua, attende la prima fascia sufficientemente lunga. La lavorazione è invece suddivisa in porzioni che riprendono nella prima fascia successiva disponibile, anche saltando weekend e chiusure. Un calendario senza disponibilità o un attrezzaggio impossibile produce un errore esplicito (orizzonte massimo di ricerca: cinque anni).

Gli stati sono **Da assegnare → Pianificata → In corso → Completata**, oltre ad **Annullata**. Una macchina può avere una sola attività in corso; si avvia solo dopo aver completato le precedenti. Le attività in corso e completate sono protette da riordino, modifica ed eliminazione. Le date della sequenza sono pianificate; i tempi effettivi e le dichiarazioni sono registrati separatamente dall'interfaccia bordo macchina. Modifiche al calendario incompatibili con le fasi di un'attività bloccata sono rifiutate.

Inserimenti, eliminazioni e modifiche ai tempi ricalcolano le attività della macchina coinvolta. Le modifiche al calendario possono influenzare tutte le macchine. L'anteprima mostra le variazioni di inizio/fine e richiede conferma prima di salvarle. Le scritture sono transazionali; una revisione evita di sovrascrivere modifiche di altri utenti. L'interfaccia controlla gli aggiornamenti ogni 15 secondi e non aggiorna mentre una finestra di modifica è aperta.

Gli orari sono quelli civili di **Europe/Rome**, memorizzati al minuto senza conversioni nel fuso del computer server. I turni sono contenuti nello stesso giorno; i turni notturni non sono previsti in questa versione.

## Test

```powershell
npm test
```

Test unitari del calendario e del motore, più test HTTP su database temporaneo: CRUD, sequenze, conferma, blocco attività, permessi, concorrenza e persistenza dopo riavvio.

`ui-check.mjs` è una verifica browser facoltativa: richiede Playwright installato e Microsoft Edge. Si può specificare il percorso del modulo Playwright tramite `PLAYWRIGHT_PATH`. Usa un database temporaneo e salva le schermate in `.artifacts`. Verifica primo accesso, drag-and-drop, inserimento confermato, CRUD, selezione degli articoli, calcolo automatico, regole di attrezzaggio, eccezioni e vista mobile.

`operational-check.mjs` esegue 18 scenari da form reali: creazione/modifica, assegnazione, riordino primo/centro/coda, annullamento dell'anteprima, ritorno in attesa, annullamento/ripristino, cambio macchina, validazioni, calendario su attività già pianificate, lavorazioni su più giorni e chiusure, attrezzaggi impossibili, conflitti tra due pagine e permessi. La suite non invoca direttamente API di scrittura: legge lo stato per verificare gli effetti dei comandi impartiti dall'interfaccia. Il server e il database temporanei sono isolati dai dati reali; vengono rimossi alla fine. Esiti e schermate vengono salvati in `.artifacts/operational-report.json` e `.artifacts/operational-*.png`. Il comando termina con errore se una prova fallisce.

```powershell
$env:HEADFUL='1' # mostra Microsoft Edge durante le prove
npm run test:ui
npm run test:operational
npm run test:resilience
```

`test:resilience` verifica in Edge perdita di connessione, risposta persa dopo un commit, doppio clic di conferma, due pagine sulla stessa sequenza e sessione invalidata durante la modifica. Report e schermate in `.artifacts/resilience-report.json` e `.artifacts/resilience-*.png`; utilizza un database temporaneo. I test in `npm test` includono inoltre scadenza reale della sessione, richieste HTTP incomplete, arresto brusco prima/dopo commit, festività consecutive, fine mese/anno, cambio ora con fusi host differenti e limiti delle dichiarazioni di bordo macchina. Una dichiarazione finale inferiore alla quantità prevista completa comunque l'attività; i consuntivi incrementali non sono implementati. Le prove di arresto coprono i confini della transazione, senza simulare guasti fisici del disco.

Le viste temporali dispongono di zoom compatto/normale/dettaglio, intestazioni persistenti e indicatore dell'ora di Roma. Il trascinamento mostra punto di inserimento e inizio stimato; la conferma mostra gli orari realmente calcolati dal server. I contatori seguono il filtro macchina, mentre il carico segue macchine e giorni visualizzati. Fermi aperti e attività ancora in corso oltre la fine prevista segnalano il piano da verificare, senza spostamenti automatici. Nelle nuove schede il titolo viene ricavato dal prodotto, selezionato una sola volta; i titoli esistenti restano conservati fino a un cambio del prodotto.

## Configurazione del server

Variabili d'ambiente: `PORT` (3000), `HOST` (127.0.0.1), `DATA_DIR` (cartella data), `COOKIE_SECURE` (1 per cookie HTTPS).

Per l'accesso da altri PC della rete del reparto:

```powershell
$env:HOST='0.0.0.0'
npm start
```

Apri la porta solo nella rete di reparto e usa l'indirizzo del server. Per la pubblicazione configura HTTPS con un reverse proxy e `COOKIE_SECURE=1`, inoltrando l'header Host originale. Questa consegna avvia l'app soltanto in locale, senza pubblicarla.

Le password sono protette con scrypt e salt individuale; le sessioni scadono dopo 12 ore. SQLite è adatto a una singola istanza del server, con più utenti collegati. Non eseguire più istanze server sullo stesso database: le anteprime di conferma sono conservate nella memoria della singola istanza.

La pianificazione si apre nella vista **Per macchina**, con tre pannelli: lavorazioni da assegnare, macchine e sequenza della macchina selezionata. **Timeline** mostra la durata proporzionale nel giorno/periodo; **Panoramica reparto** mostra il Gantt complessivo. La selezione di una lavorazione segue la sua macchina obbligatoria. Verifica browser dedicata: `npm run test:dispatch`, con database temporaneo e prova su 12 macchine.

Per completare le quantità mancanti delle attività tessili dimostrative: `node seed-demo-quantities.mjs` (rispetta `DATA_DIR`). La quantità è calcolata come minuti di lavorazione × velocità macchina, nell'unità dell'articolo. Il comando crea un backup SQLite, aggiorna soltanto le quantità mancanti degli esempi riconosciuti e verifica che pianificazione e consuntivi rimangano invariati.
