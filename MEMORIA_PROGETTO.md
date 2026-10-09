# Aloven — memoria di progetto

Aggiornata: 9 ottobre 2026. Aggiornare questo documento quando cambiano requisiti, decisioni o stato di implementazione; leggere prima di estendere l'applicativo. Le idee future non costituiscono autorizzazione a implementarle.

## Contesto e funzioni presenti

Azienda di accoppiatura tessuti. Web app multiutente con database SQLite, pianificazione e bordo macchina. Macchina obbligatoria per ciascuna attività; “da assegnare” significa non ancora pianificata. Componenti consumati: due codici con descrizione; articolo prodotto: codice e descrizione. CRUD, catalogo, tempi manuali o calcolati e regole di attrezzaggio presenti.

Calendario generale con due fasce al giorno, impostazioni massive, eccezioni per data e macchina. Attrezzaggio una volta sola, non frazionabile tra fasce o giornate. Lavorazione frazionabile con ripresa nella prima fascia lavorativa successiva. Sequenza senza intervalli lavorativi salvo attesa di fascia adatta. Inserimenti e riordini richiedono anteprima/conferma e spostano le attività della stessa macchina. Attività in corso non spostabili.

Bordo macchina: inizio/fine attrezzaggio e lavorazione, sospensione con motivo, quantità buona/scarti, controlli di aspetto e adesione, lotti consumati e barcode da lettore a tastiera. Storico operatore e confronto tempi previsti/effettivi. Prossime attività limitate a cinque, con scelta oggi/prossimo giorno lavorativo, oggi/domani o prossime cinque. Nessuna movimentazione reale di magazzino.

Interfaccia di pianificazione: vista Giorno predefinita stile Outlook, ore verticali e colonne macchina; vista Gantt a cinque giorni con tempo orizzontale e righe macchina. Dimensioni dei segmenti proporzionali ai minuti, colore stabile per attività, attrezzaggio tratteggiato. Fasce non lavorative visibili, scala oraria comune e filtro per una sola macchina. Riepilogo al mouse o focus, dettagli al clic. Le attività che proseguono dal giorno precedente restano visibili nelle loro porzioni. Completate conservate nel DB e nascoste per default nel piano, con opzione Mostra completate; disponibili anche in Attività e nello storico bordo macchina. Il filtro non cambia il piano: assegnazione e date restano soggette alla sequenza, al calendario e alla conferma.

Fermi macchina: storico persistente con motivo, operatore e timestamp server; stop imprevisto sospende la lavorazione attiva e blocca avvii/riprese. Durante attrezzaggio lo stop è rifiutato: prima terminare l'attrezzaggio indivisibile. Riattivazione macchina non riprende automaticamente la lavorazione. Durata del fermo aperta, date previste non ricalcolate automaticamente e piano segnalato da verificare alla ripresa. Manutenzione programmata tramite eccezioni calendario della macchina (chiusure o fasce disponibili ridotte), con anteprima/conferma; variazioni incompatibili con attività bloccate sono rifiutate. Nessun automatismo che inventi la durata del fermo.

Pulizia codice: rimossi rami delle vecchie schede pianificate e relativi stili sostituiti da timeline/Gantt; eliminate icona e proprietà di contesto inutilizzate. Gestori dei dialoghi azzerati all'apertura e listener barcode consolidato, evitando accumuli tra aperture. Migrazioni e compatibilità dati mantenute.

Migliorie di pianificazione: linea e descrizione del punto di inserimento durante il trascinamento, inizio esplicitamente stimato e anteprima obbligatoria al rilascio; posizioni bloccate segnalate. Zoom compatto/normale/dettaglio, intestazioni Gantt e macchine visibili durante lo scorrimento, indicatore dell'ora di Roma. Blocchi brevi con codice e dati completi accessibili nel riepilogo. Contatori riferiti al filtro macchina; carico calcolato solo sui giorni e sulle macchine visibili. Fermi aperti e lavorazioni ancora in corso oltre fine prevista segnalano attività successive da verificare, senza ricalcolo automatico.

Scheda lavorazione: unica selezione del prodotto, da cui deriva la denominazione delle nuove attività. Denominazioni esistenti conservate finché non viene cambiato il prodotto, per non perdere riferimenti di lotto presenti nei dati storici. Non è ancora implementato il modello ordini ERP.

Verifiche operative: batteria ripetibile `npm run test:operational` su Microsoft Edge visibile e database temporaneo, con 18 scenari superati. Copre inserimento/modifica, assegnazione, riordini, annullamenti e ripristino, cambio macchina, calendario già pianificato, lavorazioni su più giorni e chiusure, attrezzaggi impossibili, concorrenza, attività in corso e permessi operatore. Report e schermate in `.artifacts`; nessuna modifica ai dati reali. Superati anche i 24 test unitari/HTTP e la verifica browser `test:ui`, inclusi bordo macchina, dichiarazioni, fermi, geometria temporale e vista mobile. Corretto il nome accessibile del campo Note nelle schede riaperte; consolidati i gestori dei dialoghi per evitare accumuli di listener. La copertura riguarda questi scenari, senza pretendere di esaurire tutte le combinazioni possibili.

Estensione test del 9 ottobre: verificati calendario con festività consecutive, confini mese/anno, cambio ora e fusi host differenti, assenza di disponibilità ed eccezioni distinte per macchina. Test HTTP aggiuntivi su conferme concorrenti tra due utenti, token riservati al proprietario, replay, richiesta interrotta, arresto brusco prima/dopo commit e sessioni realmente scadute nel database temporaneo. Bordo macchina: quattro cicli pausa/ripresa, richieste duplicate concorrenti, quantità/lotti ai limiti e rifiuti atomici senza alterare storico o revisione. Una dichiarazione finale sotto la quantità prevista completa l'attività: non esistono consuntivi incrementali che lasciano la lavorazione aperta. Le simulazioni di arresto coprono i confini prima/dopo transazione; non simulano guasti fisici del disco o interruzioni in ogni singola istruzione SQLite.

Suite estesa: 31/31 test unitari/HTTP superati, 5/5 nuovi scenari browser in Edge visibile e regressione `test:ui` superata. Gli scenari browser coprono offline con form recuperabile, risposta commit persa con salvataggio unico e recupero al reload, doppio clic, due pagine concorrenti e sessione invalidata durante la modifica. Corretto un bug riprodotto: al ritorno al login per risposta 401 il dialogo viene ora chiuso, evitando che copra la pagina di autenticazione. Report in `.artifacts/resilience-report.json`; test ripetibile con `npm run test:resilience`. Dati reali invariati.

## Modello ordini ed ERP — da realizzare

Il titolo attuale rappresenta già il prodotto da realizzare: evitare una seconda richiesta ridondante del prodotto. La scheda dovrà rappresentare l'ordine di produzione, con codice e descrizione prodotto, riferimento ERP, cliente, quantità e consegna prevista. Riferimento ordine e lotto vanno distinti dal prodotto.

ERP indicato dal cliente: **Arca Evolution**, integrazione prevista tramite accesso al database. Proposta: lettura ERP e importazione nel database Aloven; pianificazione e consuntivi conservati in Aloven. Schema, autorizzazioni, identificativi, aggiornamenti e gestione degli ordini modificati/cancellati sono da verificare. Nessun connettore implementato e nessuna credenziale disponibile.

Un ordine potrà contenere due lavorazioni consecutive su macchine diverse. Proposta da implementare: dipendenza di pianificazione dalla fine prevista della prima fase e blocco di avvio della seconda finché la prima non è conclusa; anteprima degli effetti sulle fasi dipendenti.

**Da chiarire con il cliente:** prima fase con semilavorato dotato di codice distinto oppure entrambe sullo stesso prodotto. L'utente non ha ancora la risposta. Non assumere una delle due soluzioni e non bloccare gli interventi grafici in attesa. Chiarire in seguito anche quantità trasferibili e possibilità di avvio parziale della fase successiva.

## Sequenziamento automatico — futuro, fuori dallo scope attuale

Prevedere in futuro algoritmi basati su caratteristiche macchina/prodotto, per assegnare e sequenziare le lavorazioni su una macchina.

Esempio esplicitamente richiesto: ordinamento per **spessore crescente dei prodotti** sulla stessa macchina, con assegnazione automatica. Lo spessore deve essere parametro obbligatorio quando si utilizza tale criterio; unità e provenienza ERP da definire. Potranno esserci criteri differenti per altre macchine o altri parametri.

Non implementare ora algoritmi, campo spessore obbligatorio globale o assegnazioni automatiche. Quando si affronterà il tema, definire compatibilità macchina, priorità, consegne, dipendenze tra fasi, attività bloccate e conferma del piano proposto prima del salvataggio.
