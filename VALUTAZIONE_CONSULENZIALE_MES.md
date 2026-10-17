# Valutazione consulenziale del MES Aloven / MesBeat

Data analisi: 17 ottobre 2026. Uso interno.
Ottica: reparto di accoppiatura tessuti, due utenti da servire (il titolare che decide e controlla, l'operatore che lavora a macchina).

## 1. Come ho valutato

- **Esame diretto dell'app in esecuzione** su una copia temporanea del database (nessun dato operativo toccato): storico demo di 10 mesi (2.332 consuntivi), 24 attività di prova, piano settimanale generato con «Prepara periodo», rilasciato, e una attività avviata dalla console touch. Viste a 1440×900 e 1024×768.
- **Lettura di** `MEMORIA_PROGETTO.md`, `PRODUCT.md` e del codice dove serviva a verificare un'affermazione. Ciò che è già deciso come futuro (Arca, sequenziamento automatico, OEE, fasi multiple) **non** è contato come mancanza.
- **Cosa non so:** non ho visto operatori reali all'opera, né un tablet fisico, né dati veri di Aloven. I punti marcati *(da validare)* sono giudizi di mestiere, non fatti misurati. Non ho esaminato lo scheduler riga per riga né la vista mobile.
- **Scala:** 1 = inutilizzabile, 3 = fa il suo lavoro, 5 = difficile fare meglio. Sono voti severi: 4 è già un risultato molto buono.

## 2. Verdetto in una pagina

**È un MES serio, ben sopra la media dei prodotti per PMI.** Ha tre cose che di solito mancano: il piano in bozza con rilascio esplicito (il reparto non vede mai un piano a metà), la tracciabilità per lotto con registro modifiche a catena verificabile, e una console touch che non fa perdere tempo all'operatore. La sostanza c'è. I limiti sono altrove.

**I tre limiti che pesano di più:**

1. **Il sistema non conosce la tessitura/accoppiatura, conosce «attività con due componenti».** Gli articoli non hanno larghezza, grammatura, spessore, tipo di adesivo. Le macchine non hanno larghezza utile. Le «tipologie» coincidono 1:1 con le macchine, quindi le regole di attrezzaggio per tipologia non possono mai scattare (nel database demo sono vuote). Risultato: l'attrezzaggio resta un numero scritto a mano (default 30 min) e il pianificatore non ottiene nessun aiuto sulla cosa che in accoppiatura costa di più, cioè **l'ordine delle commesse per ridurre i cambi**.
2. **Il titolare vede cosa è successo, non cosa sta per succedere male.** Le statistiche sono ben fatte ma retrospettive. Manca la **puntualità di consegna** (il codice stesso avvisa «la puntualità non sarà calcolabile»), manca lo scostamento percentuale tempi previsti/effettivi, manca il confronto con il periodo precedente. Il piano non dice «questa commessa consegnata giovedì finisce venerdì».
3. **Alcune schermate chiave non si leggono al primo colpo.** La vista Settimana a 1440 px mostra circa 2,5 giorni su 6 (serve scorrere). «In reparto» manda la quarta macchina a capo. Attività si apre sullo storico di dicembre 2025, non sul lavoro in corso. L'intestazione dice «Stai modificando la bozza» anche quando tutto è già rilasciato.

**Priorità consigliata (dettaglio al §6):** (a) correggere i cinque difetti di chiarezza del §5, tutti piccoli; (b) aggiungere puntualità e scostamento % alle statistiche; (c) portare nel modello gli attributi tecnici dell'articolo e usarli per suggerire l'attrezzaggio dallo storico; (d) il resto sono arricchimenti.

## 3. Valutazione per area

| Area | Chi la usa | UX | Completezza | Statistiche / dati | Leggibilità dei dati | Giudizio in una riga |
|---|---|:-:|:-:|:-:|:-:|---|
| Pianificazione (Giorno/Settimana) | pianificatore | 4 | 3 | 3 | 3 | Potente e curata; la Settimana non entra nello schermo |
| Prepara periodo + Rilascio | pianificatore | 4 | 3 | 4 | 4 | Il pezzo migliore; manca il criterio d'ordine |
| In reparto | titolare, capo reparto | 3 | 2 | 2 | 3 | Utile, ma è un elenco, non un cruscotto |
| Attività (elenco e scheda) | amministrazione | 2 | 3 | 1 | 2 | Apre sullo storico; poche colonne utili |
| Bordo macchina classico | capo turno | 3 | 4 | 3 | 3 | Completo, un po' lungo |
| Console touch operatore | operatore | 4 | 3 | 2 | 4 | Ottima base; l'operatore vede poco di cosa lo aspetta |
| Statistiche | titolare | 4 | 3 | 3 | 4 | Pulite e oneste; senza puntualità né scostamenti |
| Tracciabilità e Verifiche qualità | qualità, titolare | 3 | 4 | 3 | 3 | Rigorose, ma per lotto *componente*, non per rotolo |
| Anagrafiche (macchine, articoli, attrezzaggi) | amministratore | 3 | 2 | 1 | 3 | Il collo di bottiglia concettuale del progetto |
| Calendario | pianificatore | 3 | 4 | n/d | 3 | Solido (turni, eccezioni, festività) |
| Utenti, Registro, Backup | amministratore | 4 | 4 | n/d | 4 | Sopra le attese; un testo obsoleto |

---

## 3.1 Pianificazione

**Cosa funziona (da non toccare)**
- Bozza e rilascio separati, con riepilogo prima di inviare: la finestra «Rilascia il piano» mostra la saturazione per macchina e per settimana e le attività rimaste fuori. È ciò che un titolare vuole vedere prima di dire «va bene».
- Barre con attrezzaggio tratteggiato distinto dalla lavorazione, colore per attività, marcatore unico per blocco (da verificare / data fissata / non inviata). Dopo le semplificazioni del 16 ottobre la schermata è leggibile.
- Carico per giorno in intestazione (98 % lunedì, 100 % martedì, 73 % mercoledì, 3 % giovedì nel mio piano di prova): in un colpo d'occhio si vede dove c'è spazio per un'urgenza.
- Trascinamento con conferma solo quando sposta altre attività; «Annulla ultimo spostamento»; riempimento dei buchi nella proposta.

**Aree di miglioramento**

| # | Problema (evidenza) | Dove | Intervento | Impatto / sforzo |
|---|---|---|---|---|
| P1 | **La vista Settimana non entra nello schermo.** A 1440×900 il contenuto è largo 1.630 px contro 871 visibili: si vedono lunedì, martedì e metà mercoledì. Il titolare che apre «Settimana» non vede la settimana. | `public/timeline.js`, `public/planning-console.css` (larghezza colonna giorno) | Larghezza giorno calcolata sulla larghezza disponibile (6 colonne = 100 %), con minimo di 120 px; il backlog «Da pianificare» comprimibile a una colonna stretta quando è vuoto (era vuoto con 24 attività già piazzate e occupava comunque 230 px). | Alto / basso |
| P2 | **«Stai modificando la bozza» + pulsante «Rilascia modifiche» restano visibili quando 23 attività su 23 sono già rilasciate** (verificato dallo stato: `planned/released`). Il pianificatore non capisce se il reparto vede il piano. | Barra superiore Pianificazione (`public/app.js`, testo di stato bozza) | Tre stati chiari: «Piano rilasciato · nessuna modifica» (pulsante spento), «N modifiche non rilasciate» (pulsante acceso con il numero), «Rilasciato alle 09:36». | Alto / basso |
| P3 | **L'anteprima della proposta mostra un calendario vuoto.** Periodo iniziato sabato 17/10, attività tutte nella settimana dopo: il Gantt è rimasto sulla settimana 42 (grigia, 0 %), con il banner «24 attività inserite». Dopo la conferma serve cliccare «Vai alle attività pianificate». Il testo di memoria dice che la vista salta alla settimana del periodo: nel caso limite no. | Anteprima proposta (`public/planning-live.js` / `app.js`, salto di settimana) | Saltare alla prima settimana che contiene un blocco della proposta, non alla settimana della data iniziale. | Medio / basso |
| P4 | **Al sabato «Oggi» porta alla settimana appena finita (0 %).** Oggi è sabato e chiuso: il pianificatore che apre l'app il sabato mattina vede una settimana morta. | Pulsante «Oggi» e vista iniziale | Se oggi non è lavorativo, aprire sul prossimo giorno lavorativo. | Basso / basso |
| P5 | **Nessun criterio d'ordine** per la proposta: solo consegna. In accoppiatura l'ordine che riduce i cambi (stesso adesivo, stessa larghezza, spessore crescente) vale più di qualunque «bella barra». Già in agenda come «sequenziamento automatico»: qui indico il minimo che dà il 70 % del valore. | `planning-proposal.mjs`, dialogo Prepara periodo | **Prima del sequenziamento automatico**: un selettore «Ordina per: consegna / raggruppa per famiglia / spessore» che riordina solo la *proposta* (l'anteprima e la conferma esistono già). Richiede gli attributi del §3.9. | Alto / medio |
| P6 | **Nessuna priorità «urgente» e nessuna simulazione «se entra questo ordine».** Il titolare telefona: «mi serve questo per giovedì». Oggi: trascina a mano e guarda quali altre slittano. | Backlog, box di inserimento | Flag «urgente» (bordo rosso nel backlog) e, nell'anteprima di inserimento, l'elenco già esistente delle date spostate con in evidenza **le consegne che sforano** (richiede `dueDate`). | Alto / medio |
| P7 | **Le consegne non sono sul piano.** «Consegne · 12» è un menù a parte. Una barra non dice se arriva in tempo. | Blocchi in `timeline.js` | Marcatore (es. bordo rosso in basso) sul blocco la cui fine prevista supera `dueDate`; contatore «N a rischio» nella barra del carico. È l'avviso che il titolare vuole senza aprire nulla. | Alto / medio |
| P8 | **Il backlog mostra il titolo troncato** («Ord. OC-T01 · Lo…»): il riferimento fa perdere la parte utile. | Card backlog | Mostrare prodotto + cliente + consegna, ordine in piccolo. Il titolo oggi concatena ordine, lotto, prodotto e lotto di nuovo. | Medio / basso |
| P9 | Nessuna **stampa** del piano (foglio settimana per macchina, da appendere o consegnare ai capi turno). Nei reparti il foglio stampato è ancora lo strumento di fiducia. | Nuovo pulsante in «Altro» | Vista di stampa A4 per macchina/settimana. | Medio / basso |

---

## 3.2 Prepara periodo e Rilascio

**Forze:** l'anteprima sul calendario con barre tratteggiate, «Annulla» per 10 minuti, il riempimento dei buchi con attività esistenti che non si muovono, la tabella di saturazione nel rilascio, la separazione tra inclusi ed esclusi. Funziona come funzionerebbe nella testa di un pianificatore esperto.

**Miglioramenti**
- **R1. Rilascio verboso:** con 24 attività la finestra elenca 24 schede da quattro righe ciascuna («Nuova attività da inviare / Al reparto: Non presente nel piano / Dopo l'invio…»). Per una nuova attività le prime due righe sono sempre le stesse. Raggruppare per macchina, una riga per attività, e mostrare per esteso solo le attività *già inviate che cambiano data*: sono le uniche su cui il capo reparto deve fare attenzione. *(public/planning-release.mjs lato server, rendering in app.js; sforzo basso, impatto medio.)*
- **R2. Il titolo del blocco ripete il codice due volte** («Ord. OC-T01 · Lotto TP-01 · PROVA 01 · … · lotto TP-01»). Ordine e lotto sono già campi distinti (`orderReference`, `outputLot`): il titolo dovrebbe contenere solo il prodotto, gli altri campi vanno nei loro posti. Vale per Pianificazione, In reparto, Bordo macchina e Touch. *(Dove nasce: derivazione del nome da `productArticleId` e dagli attributi ordine; sforzo basso, impatto alto sulla leggibilità ovunque.)*

---

## 3.3 In reparto

**Forze:** una sola schermata con stato di ogni macchina, prossime cinque attività con ora di inizio, tempi trascorsi su previsti in chiaro, ritardo e fermo con causale. Aggiornamento automatico.

**Miglioramenti**
- **V1. Con 4 macchine la quarta va a capo (3+1) a 1440 px.** Un cruscotto di reparto deve mostrare tutte le macchine insieme. Griglia a numero di colonne = numero di macchine (fino a 4–6), schede più basse.
- **V2. Manca la barra di avanzamento** dell'attività in corso (quantità o tempo su previsto) e il «% completato». Con «attrezzaggio 0 min su 30 min» si capisce, ma una barra si legge da cinque metri.
- **V3. Manca l'operatore** collegato alla macchina e l'ultima dichiarazione. Il capo reparto chiede «chi c'è su ACC-03?».
- **V4. Nessuna modalità TV/kiosk.** Una pagina `/reparto-tv` a schermo intero, caratteri grandi, senza menu, che si ricarica da sola, appesa in reparto, è ciò che il titolare mostra ai clienti e che il capo reparto guarda cento volte al giorno. Costo basso (i dati ci sono già: `liveMachines`), impatto percepito molto alto.
- **V5. Le prossime cinque non dicono se sono in ritardo rispetto alla consegna** (vedi P7).

---

## 3.4 Attività (elenco, scheda, nuova attività)

Qui è dove il prodotto è più debole nell'uso quotidiano.

| # | Problema (evidenza) | Intervento | Impatto / sforzo |
|---|---|---|---|
| A1 | **L'elenco si apre sulle attività più vecchie** (01 dicembre 2025, «Completata»), pagina 1 di 95, 2.356 righe. Chi cerca il lavoro di oggi trova lo storico. | Ordinamento predefinito: prima in corso e pianificate (per inizio), poi completate dalla più recente. Intestazioni cliccabili per ordinare. Filtro stato predefinito «Attive». | Alto / basso |
| A2 | **Colonne poco utili per chi decide:** componenti, articolo, inizio/fine; mancano cliente, consegna, quantità prodotta/scarto, esito qualità. | Colonne Cliente, Consegna (con rosso se in ritardo), Quantità (previsto/prodotto), Esito. I componenti vanno nella scheda. | Alto / basso |
| A3 | **Il modulo «Nuova attività» ha 20 campi e tre selettori non ricercabili** (65 articoli, 117 articoli per ciascun componente). Con un catalogo reale di centinaia di articoli non è usabile. Il tipo preselezionato è «Accoppiatura a fiamma» mentre la macchina preselezionata è l'ACC-01 hot melt: due scelte che dovrebbero essere una (la tipologia coincide con la macchina). | Selettori con ricerca digitando (combobox). Tipologia derivata dalla macchina e nascosta quando c'è corrispondenza 1:1. Attrezzaggio proposto dallo storico (§3.9) invece del 30 fisso. | Alto / medio |
| A4 | **Nessun «duplica attività» o «ripeti ordine».** In accoppiatura le commesse si ripetono (stesso articolo, altra quantità). | Pulsante «Duplica» nella riga e nella scheda. Precompila articoli, componenti, tempi. | Alto / basso |
| A5 | **Nessuna importazione** (CSV/Excel) delle attività, utile finché non c'è Arca. *(Valutare: il collegamento con Arca è già deciso, quindi solo se serve un ponte.)* | — | Basso, opzionale |

---

## 3.5 Bordo macchina classico

**Forze:** ciclo completo (attrezzaggio → lavorazione → dichiarazione con lotti e qualità), prossime fasi rilasciate, ultime rilevazioni con esito colorato.

**Miglioramenti**
- **B1. Pagina lunga:** la fase corrente, i tempi e i componenti occupano più dello schermo; l'ultimo storico è fuori vista. È pensata per il capo turno al PC, quindi è accettabile, ma i tre blocchi (cosa faccio / cosa seguirà / cosa ho fatto) dovrebbero essere visibili senza scorrere a 1440×900.
- **B2. «Dati di prova per la pianificazione: tempi illustrativi»** compare nella scheda: rumore che in produzione deve sparire. Verificare che sia legato al flag demo e non una nota fissa.
- **B3. La macchina si sceglie da una tendina**, senza vedere lo stato delle altre: il capo turno che gira tra le macchine perde un passaggio. Una riga di schede-macchina (come «In reparto», compatta) sopra la tendina elimina il problema.

---

## 3.6 Console touch (operatore)

**Forze (molte):** la fase corrente in grande («Prepara / Produci / Dichiara»), un solo pulsante principale da oltre 90 px, «Segnala fermo macchina» sempre accanto e distinto dalla pausa, IT/EN, indicatore «dati condivisi con il reparto · ultimo aggiornamento 09:37», nessuna conferma inutile. Il lavoro di semplificazione è reale e si vede.

**Miglioramenti**
- **T1. Sul tablet l'operatore vede una sola attività e «Prossime attività: 3» chiuso.** Chi sta chiudendo un lavoro vuole sapere **cosa viene dopo e cosa deve preparare** (quale tessuto, quale adesivo) mentre la macchina gira: è il momento in cui si guadagna tempo di attrezzaggio. Mostrare la prossima attività aperta, con componenti e attrezzaggio previsto, quando la fase è «Produci». Sforzo basso, impatto alto (riduce tempi morti).
- **T2. L'operatore non vede la consegna né il cliente.** Una commessa urgente va riconosciuta in macchina: badge «URGENTE» / «Consegna domani» sulla card (richiede P6/`dueDate`).
- **T3. Layout del tablet *(da verificare su dispositivo)*:** a 1024×768 il contenuto occupa la parte destra con una fascia vuota a sinistra di circa 190–250 px; sullo schermo da 10" ogni pixel conta. Controllare `public/operator.css` (griglia a due colonne con colonna di sinistra non popolata).
- **T4. «Chiama aiuto» assente.** Pulsanti a tre voci (Materiale / Qualità / Manutenzione) che notificano sul cruscotto «In reparto» e sulla TV: più rapidi di una telefonata e producono dati sui tempi di attesa. Complemento naturale del fermo macchina.
- **T5. Qualità numerica assente:** l'esito è sì/no. In accoppiatura la prova decisiva è la resistenza al distacco (N/5 cm), la tenuta all'acqua, la mano. Un campo numerico opzionale con soglia per articolo trasforma «conforme/non conforme» in dato analizzabile. Impatto alto per qualità e reclami, sforzo medio.
- **T6. Accesso rapido (badge/PIN)** già annotato come idea futura nella memoria: lo confermo come priorità media. La sessione da 12 ore su un tablet condiviso fra turni attribuisce le dichiarazioni a chi ha fatto login la mattina.

---

## 3.7 Statistiche

**Forze:** organizzazione in Panoramica / Produzione / Qualità e scarti / Macchine; «Come leggere i dati» che spiega i calcoli; dati mancanti distinti da zero; separazione per unità di misura; export Excel a nove fogli; filtro «Escludi dati demo». Il tono è onesto e non gonfia nulla: raro.

**Dati reali dal demo che mostrano che cosa manca** (valori dimostrativi, uso solo come esempio di lettura):
- Ore previste contro effettive per macchina: ACC-01 1.088 → 1.116 h (+2,6 %), ACC-02 1.105 → 1.134 h (+2,7 %), **ACC-03 1.045 → 1.137 h (+8,8 %)**, ACC-04 1.110 → 1.129 h (+1,7 %). La schermata mostra i due numeri affiancati ma **non il +8,8 %**, che è l'unica cifra che dice «i tempi standard di questa macchina sono sbagliati e il piano mente».
- Attrezzaggio: 945 h su circa 5.461 h di tempo attivo (17 %). È il costo nascosto più grande del reparto, ma sta in una riga di numeri sotto i KPI.
- Scarti per causale: «Attrezzaggio» (8.489 m) è la prima causale, con Adesione e Pieghe. È **scarto di avviamento**, che ha rimedi diversi (regolazione, prima pezza di prova) dallo scarto di processo. Oggi stanno nello stesso grafico.

**Miglioramenti**

| # | Intervento | Dove | Impatto / sforzo |
|---|---|---|---|
| S1 | **Puntualità di consegna (OTD)**: % ordini completati entro `dueDate`, ritardo medio in giorni, lista degli ordini in ritardo. Il codice la dichiara «non calcolabile» se manca la data: oggi il campo è facoltativo. Rendere la consegna obbligatoria (o, finché non c'è Arca, fortemente raccomandata con avviso nel modulo) e aggiungere il KPI. È **il numero che il titolare porta al cliente**. | `statistics.mjs`, `public/statistics.js`, `task-warnings.mjs` | Altissimo / medio |
| S2 | **Scostamento %** tempo previsto/effettivo e attrezzaggio previsto/effettivo, per macchina e per articolo, con evidenza oltre soglia (es. >5 %). Aggiungere il pulsante «Aggiorna tempo standard con la mediana storica» (con anteprima) per correggere gli standard. Chiude il cerchio piano → realtà. | idem | Altissimo / medio |
| S3 | **Tendenza e confronto**: ogni KPI con variazione rispetto al periodo precedente (▲▼ e %). Le frecce «↗» oggi sono il link di approfondimento e non indicano trend; si confondono con un indicatore di tendenza. | `statistics.js` | Alto / basso |
| S4 | **Separare lo scarto di avviamento** (causali tipo «Attrezzaggio», «Taglio testa/coda») dallo scarto di qualità in due barre diverse, con il rapporto sugli articoli e sulle macchine. | causali (`scrap-reasons.mjs` come flag «tipo»), grafico | Alto / basso |
| S5 | **Rese per materiale**: metri di tessuto/schiuma/film consumati contro metri di prodotto, **per articolo**. Con il consumo dichiarato per lotto c'è già il dato. In accoppiatura la resa del materiale è il vero margine. | `statistics.mjs` | Alto / medio |
| S6 | **Attrezzaggio medio per passaggio** (da articolo A ad articolo B) con numerosità: alimenta direttamente il §3.9. | idem | Alto / medio |
| S7 | **Il KPI «Lotti completi 0 / 2332»** è il quinto riquadro in grande e nel demo è sempre zero (storico senza lotto prodotto): messaggio sbagliato al primo sguardo. Mostrarlo solo quando almeno un consuntivo ha il lotto prodotto, come già fatto nella scheda MesBeat. | `statistics.js` | Medio / basso |
| S8 | Il caricamento di 10 mesi (default) impiega oltre 2 secondi sul demo da 2,3k consuntivi e la schermata resta «Caricamento statistiche…». Il periodo predefinito dovrebbe essere «ultimi 30 giorni» con scorciatoie (settimana, mese, trimestre, anno). Migliora anche la leggibilità (il grafico mensile con un picco di dati vecchi). | `statistics.js` | Medio / basso |
| S9 | **OEE** (già in agenda): quando verrà definita la base dati, il calcolo sarà quasi gratis (disponibilità: ore fermo e calendario; prestazione: velocità effettiva/nominale; qualità: scarto). Ho verificato che le tre componenti esistono già nei dati. Non implementare senza richiesta. | — | Futuro |

---

## 3.8 Tracciabilità e Verifiche qualità

**Forze:** ricerca per lotto esatto in entrambe le direzioni, decisione qualità separata dalla chiusura, rettifiche solo amministrative con motivazione, catena SHA-256 verificata nel registro. Per un reparto con clienti automotive o sanitari è un punto di vendita vero.

**Miglioramenti**
- **Q1. Granularità:** la tracciabilità è per lotto *dichiarato* sulla lavorazione e non per rotolo/pezza (la scheda lo dice onestamente). Un cliente tecnico chiede «quali rotoli di questo lotto di schiuma sono finiti nel prodotto Y?». Già in agenda come «rotoli individuali»: il vantaggio commerciale è alto, valutarlo con Aloven.
- **Q2. Ricerca solo esatta:** un operatore che digita «TP-0» non trova niente. Aggiungere ricerca per prefisso con elenco suggerito dei lotti recenti. *(Basso sforzo.)*
- **Q3. «Verifiche qualità» è vuota con i dati di prova, ma nelle Statistiche compaiono 126 «Da verificare»**: le due viste non coincidono per il filtro predefinito. Controllare che la lista parta da «Da decidere» e mostri lo stesso numero della statistica (un numero con due fonti genera sfiducia).
- **Q4. Rapporto di conformità da stampare/inviare al cliente** per lotto (PDF): il titolare lo chiede appena arriva un reclamo.

---

## 3.9 Anagrafiche (il punto critico del modello dati)

**Evidenza**
- **Tipologie = macchine.** Quattro tipologie, quattro macchine, una per una (hot melt PUR, film/web, fiamma, polvere): descrivono il processo della macchina, non il lavoro. Le **regole di attrezzaggio per tipologia precedente→successiva** non possono mai scattare su una macchina sola: l'elenco è vuoto e non verrà mai riempito in modo utile.
- **Articoli senza attributi:** codice, descrizione, unità e uso. Niente larghezza, grammatura, spessore, famiglia, adesivo, colore, fornitore. Quindi non si può raggruppare, filtrare, ordinare né controllare compatibilità.
- **Macchine senza capacità:** solo velocità e inizio pianificazione. Niente larghezza utile, spessore massimo, famiglie ammesse.
- **Colore tipologia come testo esadecimale** («#a855f7») in tabella.

**Interventi (in ordine di valore)**
1. **Attributi articolo configurabili** (campo libero con tipo: numero/testo/elenco), per cominciare: *famiglia*, *larghezza (cm)*, *grammatura (g/m²)* o *spessore (mm)*, *adesivo/processo*. Pochi campi, ma ci sono. È il prerequisito per tutto ciò che segue. È anche la base per «sequenziare per spessore» già richiesta dal cliente: oggi manca il dato su cui lavorare. *(Dove: tabella `articles`, modulo Articoli, scheda Attività; sforzo medio, impatto altissimo.)*
2. **Attrezzaggio suggerito dallo storico, non da una matrice a mano.** Con 2.332 consuntivi il sistema conosce già il tempo reale per ogni passaggio articolo/famiglia A→B. Proporre «attrezzaggio stimato 28 min (mediana di 14 passaggi simili)» nel modulo e nel riposizionamento, con il pulsante «usa» e il valore storico visibile. Sostituisce il lavoro di compilare matrici (che nessuno compilerà). *(statistics.mjs ha già «delta attrezzaggio»; sforzo medio, impatto alto.)*
3. **Sostituire la regola «per tipologia» con regola «per attributo che cambia»:** cambio adesivo +X min, cambio larghezza +Y min, cambio spessore +Z min, cambio colore/tessuto +W min. Una macchina ha 3–5 regole, non una matrice N×N. La somma dei cambi dà l'attrezzaggio, ed è la forma in cui lo racconta un capo reparto («cambiare larghezza mi costa venti minuti»).
4. **Capacità macchina:** larghezza max e spessore max per bloccare combinazioni impossibili in fase di inserimento (oggi la «compatibilità con altre macchine» è una scelta manuale per attività).
5. Selettore colore al posto dell'esadecimale; e nascondere «Tipologia» finché coincide con la macchina (vedi A3).

---

## 3.10 Calendario, utenti, registro, backup

**Forze:** settimana standard con due fasce, eccezioni per data e per macchina, festività italiane in un clic, mese a colpo d'occhio; ruoli ben pensati e applicati dal server; registro modifiche con verifica d'integrità; backup automatico con prova di ripristino. Il livello di cura qui è alto.

**Miglioramenti**
- **C1. Testo obsoleto in Utenti:** «Gli operatori gestiscono attività e pianificazione. Gli amministratori gestiscono anche macchine, tipologie, calendario e utenti.» — falso dal 14 ottobre (il pianificatore pianifica, l'operatore usa solo il bordo macchina). Allinearlo ai tre ruoli. *(public/app.js, testo fisso; 5 minuti.)*
- **C2. Calendario: turni per macchina con un clic** («ACC-03 lavora solo la mattina»). Esiste per eccezioni, ma una «settimana standard per macchina» evita decine di eccezioni se un impianto ha orari diversi dagli altri. *(Valutare con Aloven se serve.)*
- **C3. Backup:** la destinazione predefinita è sulla stessa macchina del server. Lo dice il testo, ma la cosa va **imposta all'installazione** (checklist di consegna), non lasciata a una frase in Configurazione.
- **C4. Manutenzione preventiva assente.** Esistono le chiusure programmate (eccezioni di calendario) ma non scadenze ricorrenti per ore di funzionamento o per calendario: pulizia rulli, cambio filtri, taratura fiamma, controllo bruciatori. Una tabella semplice (intervento, periodicità in ore macchina, ultima esecuzione) con avviso «ACC-03 tra 12 h alla pulizia» e creazione della chiusura in un clic. Per l'accoppiatura a fiamma è sicurezza oltre che qualità. *(Dato già disponibile: ore attive per macchina.)*

---

## 4. Funzioni «marcia in più» specifiche per l'accoppiatura

Ordinate per rapporto valore/costo. Quelle già in agenda (Arca, sequenziamento automatico, OEE, fasi multiple) non sono ripetute qui.

| # | Funzione | Perché in accoppiatura | Dove nasce | Valore / costo |
|---|---|---|---|---|
| M1 | **Attributi tecnici dell'articolo + raggruppamento «campagna»** (stessa famiglia/adesivo/larghezza in sequenza) | Il tempo perso in attrezzaggio qui è il margine. Raggruppare per campagna è ciò che fa il bravo capo reparto a memoria | §3.9, P5 | Altissimo / medio |
| M2 | **Attrezzaggio stimato dallo storico** | I tempi reali esistono già nei consuntivi | §3.9 | Alto / medio |
| M3 | **Prima pezza / campione di avvio** con controllo registrato prima di far girare la commessa | Gli scarti da attrezzaggio sono la prima causale (8.489 m nel demo); il campione di avvio è la contromisura classica | Fase «Prepara» → passo «Prova» con esito e metri di prova | Alto / medio |
| M4 | **Scarto di avviamento separato dallo scarto di processo**, con metri di testa/coda | Sono due problemi con rimedi diversi | S4 | Alto / basso |
| M5 | **Resa del materiale** (m consumati / m prodotti, adesivo in g/m² dichiarato) per articolo | Margine e prezzo per metro | S5; consumo adesivo opzionale a fine lavorazione | Alto / medio |
| M6 | **Qualità misurata** (resistenza al distacco, ecc.) con soglia per articolo | Passa da «conforme sì/no» a dato per reclami e capitolati | T5 | Alto / medio |
| M7 | **Chiamata aiuto dal tablet** (materiale/qualità/manutenzione) con tempo di attesa | Il tempo di attesa materiale è invisibile e quasi sempre sottostimato | T4 | Medio / basso |
| M8 | **Manutenzione preventiva a ore macchina** | Fiamma e hot melt hanno routine che si dimenticano | C4 | Medio / medio |
| M9 | **TV di reparto** a schermo intero | Visibilità immediata per capi e visitatori | V4 | Medio / basso |
| M10 | **Stampa del foglio di lavoro** (barcode del lotto, componenti, note) e **etichetta lotto prodotto** | Il reparto lavora ancora con la carta; il barcode riduce errori di lotto | P9, bordo macchina | Medio / medio |
| M11 | **Simulazione «se entra un'urgenza»** con elenco delle consegne che sforano | Il titolare lo fa ogni settimana, oggi con le dita | P6/P7 | Alto / medio |
| M12 | **Rilavorazione come attività figlia** (da una decisione «da rilavorare» nasce una seconda passata collegata) | In accoppiatura la seconda passata è frequente; oggi è «destinazione senza effetti» | Verifiche qualità → nuova attività precompilata | Medio / medio |

---

## 5. Difetti e incoerenze trovati (tutti piccoli, tutti da sistemare)

| # | Cosa | Evidenza | Correzione |
|---|---|---|---|
| D1 | Stato bozza/rilascio fuorviante | «Stai modificando la bozza» con 23/23 attività `released` | P2 |
| D2 | Anteprima proposta sulla settimana sbagliata | Settimana 42 vuota, attività nella 43 | P3 |
| D3 | Testo ruoli obsoleto in Utenti | «Gli operatori gestiscono attività e pianificazione» | C1 |
| D4 | Tipologia e macchina preselezionate incoerenti nel modulo | «Accoppiatura a fiamma» con ACC-01 hot melt | A3 |
| D5 | Elenco Attività sul più vecchio | Prima riga 01/12/2025, 95 pagine | A1 |
| D6 | Settimana non entra nello schermo | scrollWidth 1.630 / clientWidth 871 a 1440 px | P1 |
| D7 | Quarta macchina a capo in «In reparto» | schede 3+1 a 1440 px | V1 |
| D8 | Titoli con ordine e lotto ripetuti | «Ord. OC-T01 · Lotto TP-01 · … · lotto TP-01» | R2 |
| D9 | KPI «Lotti completi 0/2332» in primo piano | sempre zero con lo storico demo | S7 |
| D10 | *(da verificare su tablet reale)* fascia vuota a sinistra nella console touch a 1024 px | screenshot a 1024×768 | T3 |

---

## 6. Piano di intervento

**Ondata 1 — chiarezza (pochi giorni, nessuna modifica dati)**
D1, D2, D3, D5/A1, D6/P1, D7/V1, D8/R2, D9/S7, S8, P4. Obiettivo: nessuna schermata che confonda al primo sguardo.

**Ondata 2 — il titolare vede il rischio (1–2 settimane)**
S1 puntualità, S2 scostamento %, S3 tendenze, P7 marcatore consegna sul piano, A2 colonne utili, A4 duplica, V2/V3/V4 cruscotto reparto e TV, T1 «cosa viene dopo» in macchina, R1 rilascio compatto, P9 stampa.

**Ondata 3 — il modello conosce l'accoppiatura (da concordare con Aloven)**
Attributi articolo (§3.9 punto 1), attrezzaggio dallo storico (§3.9 punto 2), regole per attributo (punto 3), capacità macchina (punto 4), criterio d'ordine nella proposta (P5), scarto di avviamento (S4/M4), prima pezza (M3), qualità misurata (M6), resa materiale (S5/M5).
Note di metodo: sono modifiche **al nucleo** (valgono per qualunque cliente di accoppiatura), non «Aloven»; vanno estratte come previsto dal metodo MesBeat. Servono migrazioni additive e backup come per le precedenti.

**Ondata 4 — arricchimenti**
Chiamata aiuto (M7), manutenzione preventiva (M8), rilavorazione figlia (M12), urgenza e simulazione (P6/M11), badge/PIN (T6), certificato di conformità PDF (Q4), rotoli individuali (Q1).

**Non toccare:** bozza + rilascio, finestra di riepilogo del rilascio, console touch a tre fasi senza conferme, registro con catena, backup con prova di ripristino, la sobrietà delle statistiche («Come leggere i dati», dati mancanti ≠ zero).

## 7. Cosa toglierei o semplificherei (rumore)

1. **Il titolo-concatenazione** (ordine + lotto + prodotto + lotto) ovunque: sostituirlo con prodotto e campi dedicati (R2). Il riquadro più rumoroso dell'intera app.
2. **«Tipologia» dal modulo attività** finché coincide con la macchina (A3).
3. **Le quattro righe per attività nel rilascio** (R1).
4. **«Dati di prova per la pianificazione: tempi illustrativi»** nel bordo macchina (B2) in produzione.
5. **Il KPI «Lotti completi»** quando non è significativo (S7).
6. **Il colore come esadecimale** nella tabella Tipologie (selettore).
7. **«Matrice» di attrezzaggio per tipologia** una volta introdotte le regole per attributo (§3.9): si tiene per compatibilità, non si promuove.
8. **Tre ruoli visibili al login** per l'operatore: il suo flusso passa già diretto alla console touch; il resto dell'app per lui non esiste (bene, lo confermo).

## 8. Da validare sul campo (non sono verificabili da qui)

1. Il capo reparto legge «In reparto» o chiede all'operatore? (decide se la TV vale lo sforzo)
2. Con quali parole l'operatore chiama il passaggio da un lavoro all'altro: «attrezzaggio», «cambio», «preparazione»? La console usa «Prepara»; il dizionario va allineato (anche per il futuro profilo tessile).
3. Gli attrezzaggi sono davvero guidati da larghezza/adesivo/spessore o dal colore/tessuto? Cambia le regole del §3.9.
4. Quanti articoli diversi hanno in anagrafica, e con che frequenza si ripetono? Decide il valore di «duplica» e di una ricerca nei menù.
5. Si lavora il sabato? (la domanda è già in memoria; incide su Settimana e su P4)
6. Il lotto componente viene letto da barcode o scritto a mano? Decide quanto investire su Q2/M10.

---

*Metodo: esame diretto su database temporaneo (copia dedicata, nessun dato operativo toccato), lettura della memoria di progetto e verifica puntuale nel codice. I numeri delle statistiche sono dimostrativi e servono solo a mostrare come si leggono. I giudizi marcati «da validare» sono di mestiere e vanno confermati con chi lavora in reparto.*
