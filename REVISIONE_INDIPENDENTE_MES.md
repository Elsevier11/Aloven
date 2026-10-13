# Revisione indipendente del MES Aloven — 12 ottobre 2026

Revisione pratica del prodotto così com'è nel repository `C:\Dev\Aloven` (working tree, versione con modifiche non ancora committate). Contenuti non inventati: dove manca una prova diretta è dichiarato.

## 0. Metodo, prove eseguite e limiti

**Ambiente di prova.** Copia consistente del database operativo (`VACUUM INTO` da connessione in sola lettura: 2.397 attività, 2.334 consuntivi, 392 fermi, 6.085 righe lotto) avviata su un secondo server (porta 3100) con DB, backup e utenti di revisione separati. Il database reale non è stato scritto: dopo la revisione revisione 74, 5 utenti e 2.334 consuntivi, invariati; servizio su porta 3000 ancora attivo.

**Prove eseguite**
- Schermate reali in browser (1366×768 e 1024×768): Pianificazione, Nuova attività, conferma modifica, Attività, Statistiche (4 viste e “Come leggere i dati”), Bordo macchina classico, Vista touch `/operatore` (preparazione → produzione → dichiarazione, passi Quantità e Lotti), Anagrafiche, Configurazione (Calendario, Utenti, Registro modifiche, Backup).
- 17 prove di validazione sulle attività via API (`/api/preview`), controlli di permesso con un utente operatore, rilascio del piano, ciclo operatore con sequenza vietata, chiusura con quantità anomale, tracciabilità per lotto, 12 login errati consecutivi, intestazioni HTTP.
- Ricalcolo indipendente in SQL di conteggi, quantità, scarti, non conformità e ore di fermo, confrontati con `/api/statistics`.
- `npm test`: 104/104 test unitari/HTTP superati (temporanei, non toccano i dati reali).
- Lettura di `MEMORIA_PROGETTO.md`, README, schema SQLite e dei moduli `shopfloor.mjs`, `quality.mjs`, `planning-release.mjs`.

**Limiti dichiarati.** Nessun accesso a Arca Evolution né a dati reali di produzione: tutto lo storico è dimostrativo (`sim10m-v1`) tranne pochi record inseriti a mano. Non verificati: tablet fisico, lettore barcode, viewport mobile 390 px, Excel esportato, fermo macchina e richiesta di interruzione dall’interfaccia, rettifica amministrativa, ripristino da backup, carico con più utenti, accessibilità formale, schede “Tracciabilità” e “Verifiche qualità” a video (la tracciabilità è stata provata via API). Il ciclo operatore in UI è stato eseguito con un account amministratore. Le suite browser del progetto non sono state rieseguite.

Nota: le prove di scrittura (rilascio, chiusure) esistono **solo nella copia**; la stessa copia mostra quindi un’attività con 999.999 m registrati che nel DB reale non esiste.

---

## 1. Giudizio sintetico

Il MES è un **buon pianificatore e registratore di avanzamento per una macchina alla volta**, con una vista touch chiara e controlli di coerenza seri su sequenza, concorrenza, permessi e rate limiting. I dati statistici verificati coincidono con le fonti.

**Non è ancora adeguato al contesto aziendale descritto** (commesse, materiale cliente, magazzino, due fasi) perché il modello dati non contiene questi concetti: sono assenti dallo schema, dai moduli e dalle statistiche, non solo dall’interfaccia. Inoltre:

1. nel DB attuale **il rilascio del piano al reparto è bloccato** (vedi R1);
2. la chiusura di una lavorazione **non ha controlli di plausibilità** su quantità, consumi e tempo (R2): un errore di digitazione altera subito le statistiche senza segnalazione;
3. in tutti i 2.397 record **ordine, ERP, cliente e consegna sono vuoti**: puntualità, cliente e commessa non sono calcolabili.

Il sistema è adatto a un **pilota controllato** su una macchina e articoli standard dopo la correzione di R1–R3; non a un uso operativo generale.

---

## 2. Rilievi

Priorità: **bloccante** (prima dell’uso operativo), **alta**, **media**, **bassa**.

### R1 — Il rilascio del piano è bloccato nel DB attuale
- **Priorità:** bloccante (sul DB attuale) · **Area:** dati / processo
- **Evidenza:** `POST /api/planning/release` sulla copia → 409 “Le attività iniziate o completate non possono essere modificate nel piano.” Confronto diretto: per **2.334/2.334** attività completate `runMinutes`, `end`, `segments` e `quantity` differiscono dallo snapshot rilasciato (esempio: 36 min / 360 m attuali contro 180 min / 1.800 m rilasciati); 564 anche in `position`. Causa: lo script di riduzione al 20% aggiornò le attività ma non gli snapshot (`releasedPayload`). In UI il pulsante “Rilascia modifiche” (39 modifiche in attesa) porterebbe allo stesso errore, con un messaggio che non spiega quali attività né come rimediare. Allineando gli snapshot **solo nella copia**, il rilascio è riuscito (versione 2) e il ciclo operatore è partito.
- **Impatto:** nessuna modifica di pianificazione raggiunge il bordo macchina. La memoria di progetto indica “richiedono il normale rilascio”, ma questo non è eseguibile.
- **Correzione:** (a) riallineare gli snapshot delle completate con uno script verificato e backup; (b) rendere il controllo di rilascio non dipendente da campi storici di attività concluse e mostrare quali attività non coincidono; (c) test di regressione che dopo uno script di migrazione dati verifichi il rilascio.
- **Accettazione:** su copia del DB attuale il rilascio riesce senza modificare consuntivi; il test (c) fallisce se uno script lascia snapshot disallineati.
- *Da chiarire:* se il problema riguarda solo i dati dimostrativi, un database di produzione pulito non sarebbe interessato; il rischio di processo però resta per qualsiasi futura migrazione.

### R2 — Nessun controllo di plausibilità alla chiusura
- **Priorità:** alta (bloccante per l’affidabilità delle statistiche) · **Area:** dati / usabilità
- **Evidenza:**
  - Chiusura accettata con **999.999 m buoni su 420 pianificati e 1 m consumato per componente**, e con tempo attivo di pochi secondi (`validateFinishDeclaration` controlla forma, non coerenza).
  - Effetto osservato in Statistiche: il grafico mensile passa a scala 0–1 Mln, ottobre 2026 mostra 1.000.144 m e nessun “previsto”, l’incidenza scarto scende da 1,87% a **0,63%**. Nessun avviso di valore anomalo.
  - Nel DB reale, un record inserito a mano riporta 20 m prodotti con 4 m del componente 1 e 20 m del componente 2.
  - Nella vista touch la quantità buona è **precompilata con la quantità prevista** già dopo 5 secondi di produzione; l’operatore può confermare senza digitare.
- **Impatto:** statistiche, rendimenti e rintracciabilità dipendono da una digitazione non verificata.
- **Correzione:** soglie configurabili con avviso e motivazione obbligatoria: quantità ≫ prevista o ≫ tempo × velocità; consumo componente fuori da una tolleranza del rapporto atteso con l’uscita; nessun valore precompilato oppure precompilazione esplicita “prevista, da confermare”. Contrassegnare i consuntivi “fuori soglia” nelle statistiche invece di nasconderli.
- **Accettazione:** una chiusura 999.999 m / 1 m / 0 min richiede motivazione e compare come “da verificare”; un test dimostra che le soglie sono applicate in UI e API.

### R3 — Il modello dati non rappresenta il processo aziendale
- **Priorità:** bloccante rispetto al perimetro richiesto · **Area:** processo
- **Evidenza (schema `tasks`, form “Nuova attività”, tabelle presenti):**
  - **Commessa vs magazzino:** nessun campo di tipo; stesso per cliente e ordine, solo testo libero facoltativo.
  - **Materiale del cliente:** `articles` ha solo `kind` (componente/prodotto) e unità; `executionLots` non ha proprietà, fornitore o DDT.
  - **Due accoppiamenti:** nessun legame fase/ordine/attività padre; una seconda fase può partire prima della prima; un semilavorato richiederebbe un articolo “entrambi”, senza vincolo di collegamento.
  - **Giacenze e disponibilità:** nessuna tabella di magazzino; la disponibilità dei materiali prima dell’avvio non è controllata (un `start_setup` non verifica alcun materiale).
  - Valori popolati su 2.397 attività: ordine 0, ERP 0, cliente 0, consegna 0, lotto prodotto 0 (e 0 su 2.334 consuntivi).
- **Impatto:** non si possono né distinguere né analizzare produzione su commessa, per magazzino, materiali cliente e prodotti a due fasi; “Consegne · 0” è sempre vuoto.
- **Correzione:** il progetto già pianifica l’integrazione Arca e le due fasi come temi futuri: definirne i requisiti con il cliente prima del pilota. Minimo di campi: tipo ordine (commessa/magazzino), cliente, scadenza obbligatori per le commesse; proprietà del materiale (aziendale/cliente) su articolo e lotto; fase N di M con collegamento alla fase precedente.
- **Accettazione:** su un ordine a due fasi, la seconda non è avviabile prima della chiusura della prima e le quantità non vengono contate due volte (prova con 2 attività collegate).

### R4 — Creare un’attività sposta altre attività in date passate
- **Priorità:** alta · **Area:** processo / usabilità
- **Evidenza:** salvare una nuova attività *da pianificare* apre “Conferma la modifica” con **6 attività già pianificate di ACC-01** che passano a “08 ott” (oggi è 12 ott); `/api/preview` conferma 6 variazioni (es. 09 ott 09:00 → 08 ott 14:00; 14 ott 16:19 → 09 ott 13:07). Il dialogo non spiega perché una nuova attività muova altre; l’ancoraggio della macchina è nel passato e non esiste un limite “non prima di adesso”.
- **Impatto:** il pianificatore può confermare spostamenti involontari o rinunciare a salvare.
- **Correzione:** nessun ricalcolo delle altre attività per modifiche anagrafiche non pianificate; in ogni caso mai prima dell’ora corrente e con motivo visibile.
- **Accettazione:** l’anteprima di una nuova attività non pianificata ha 0 variazioni; un test verifica che nessuna data venga anticipata oltre l’ora corrente.

### R5 — Lotti liberi, senza anagrafica né proprietà
- **Priorità:** alta · **Area:** dati / tracciabilità
- **Evidenza:** i lotti sono testo libero fino a 80 caratteri (nel DB reale esistono “lko” e “fdgt”). Nel dimostrativo i 6.085 codici lotto sono tutti diversi: ogni bobina compare in un solo lavoro, quindi non si è provato il caso reale “un rotolo → più lavorazioni”. Il lotto prodotto è assente su tutta la storia (0 su 2.334 consuntivi; la schermata della copia mostra “Lotti completi 1/2335” solo per la mia prova di chiusura). La tracciabilità lavora per lavorazione, non per rotolo (dichiarato dal progetto).
- **Impatto:** in un richiamo o reclamo, la ricerca per lotto dà falsi negativi (refusi) e non distingue fornitori e proprietà.
- **Correzione:** anagrafica lotti/rotoli con articolo, proprietà, quantità ricevuta/residua e stato; scansione barcode obbligatoria dove il processo la prevede; formato lotto per articolo.
- **Accettazione:** un lotto consumato in più lavorazioni è ricercabile con elenco completo; un lotto inesistente o di altro articolo viene rifiutato.

### R6 — Componenti uguali accettati; quantità e scadenza facoltative
- **Priorità:** media · **Area:** dati
- **Evidenza:** `/api/preview` accetta `component1 == component2` (salvato anche dal modulo), quantità assente e scadenza 2020-01-01. Rifiuta correttamente quantità ≤ 0, minuti non interi, cliente > 200 caratteri e un articolo di tipo errato.
- **Impatto:** attività senza quantità non hanno “previsto” in statistiche; componenti identici sono quasi sempre un errore.
- **Correzione:** avviso (non blocco) sui componenti uguali; quantità e scadenza obbligatorie per le commesse; avviso per scadenza passata.
- **Accettazione:** i tre casi mostrano un messaggio chiaro e non si salvano senza conferma.

### R7 — Calendario senza festività né chiusure
- **Priorità:** media · **Area:** processo
- **Evidenza:** “Eccezioni generali · 0”; lo storico mostra la caduta di agosto (132 consuntivi contro ~250), ma il calendario non conosce Ferragosto, 8 e 25 dicembre ecc.
- **Impatto:** capacità e date previste ottimistiche in periodi di chiusura.
- **Correzione:** preimpostare festività italiane e chiusure aziendali (modificabili).
- **Accettazione:** una lavorazione che attraversa il 25 dicembre salta il giorno.

### R8 — Regole di attrezzaggio vuote
- **Priorità:** media · **Area:** processo / statistiche
- **Evidenza:** `setupRules` = 0 righe; il tempo di attrezzaggio è quello base per ogni attività, e il “delta attrezzaggio” (+35 h su 837 h reali) viene confrontato con tempi non dipendenti dalla sequenza.
- **Impatto:** il confronto previsto/effettivo e l’ordine ottimale non sono significativi.
- **Correzione:** inserire le matrici reali per macchina e tipologia o dichiarare nelle statistiche che sono tempi base.

### R9 — Identità utenti e sicurezza
- **Priorità:** media · **Area:** sicurezza
- **Evidenza (positiva):** 429 dopo 10 login errati; password minimo 10 caratteri con hash scrypt; CSP, `X-Frame-Options`, `nosniff`; 403 per operatore su macchine, calendario, articoli, utenti, audit, backup e rilascio; l’operatore non vede l’elenco utenti; operazioni di scrittura con intestazione e controllo origine. **Rilievi:** due account con lo stesso nome visualizzato “Mario Rossi” (admin e operatore) rendono ambigua la lettura dell’audit; cookie `Secure` e HTTPS solo opzionali (`COOKIE_SECURE`); sessione 12 ore; nessuna autenticazione a più fattori; il registro è append-only per l’applicazione ma non a prova di manomissione; backup di default sullo stesso disco.
- **Correzione:** nome univoco per persona; HTTPS dietro reverse proxy e `COOKIE_SECURE=1` in produzione; destinazione backup separata; hash a catena per il registro.

### R10 — Usabilità: punti osservati
| Punto | Osservazione | Proposta |
|---|---|---|
| Pianificazione (1366×768) | Barra con 8+ controlli (5 giorni/Giorno, data, Oggi, macchina, ricerca, Prepara periodo, Consegne, Opzioni vista), banner ambra permanente “Piano da verificare · 4 macchine” e “Non inviata al reparto” ripetuto su tutte le 24 schede | Una sola spia di stato bozza/rilascio; i controlli secondari in Opzioni; il badge solo sulle eccezioni |
| Pianificazione | Attività “Pianificata / Inviata al reparto” con inizio 8–9 ottobre (passato) mostrate senza avviso nell’elenco Attività | Segnalare “inizio superato” anche nell’elenco e nel bordo macchina |
| Nuova attività | Modulo lungo: cliente, ordine e scadenza sono nella sezione finale “Riferimenti ordine e lotto”, tutti opzionali | Per le commesse portarli in alto e renderli obbligatori |
| Rilascio | Un solo pulsante per tutta la bozza (39 modifiche, tutte le macchine) | Rilascio per macchina o selezione (richiesta futura, non approvata) |
| Touch `/operatore` | Chiarezza buona: una sola azione, tre passi, pulsanti grandi, IT/EN. Il toast “Rilevazione registrata.” copre in parte “Dettagli lavorazione”; la quantità precompilata favorisce la conferma passiva (R2) | Toast sopra la barra azioni; quantità vuota o chiaramente “prevista” |
| Bordo macchina classico | Chiaro, ma la scheda non mostra cliente, ordine, consegna o priorità (dati oggi assenti) | Mostrarli appena disponibili (R3) |
| Statistiche | KPI cliccabili, spiegazioni “Come leggere i dati” e unità chiare; “Quantità prevista” è il previsto delle sole lavorazioni consuntivate, non il carico ordini | Rinominare in “Previsto delle lavorazioni chiuse” |

Il lessico (bozza, rilascio, sequenza, “Togli dal piano”) è coerente e comprensibile. La terminologia “consuntivo” e “rilascio” richiede una breve formazione.

---

## 3. Flussi verificati (caso concreto)

**Caso 1 — Commessa singola con due componenti.** Nuova attività ART-01-001 su ACC-01, 200 m, cliente e consegna → in Pianificazione compare tra “Da pianificare”; salvataggio chiede conferma e (R4) sposta altre attività → *dopo l’allineamento della copia* il rilascio riesce → il bordo macchina mostra la fase “Prepara” con i due componenti e la quantità. **Cosa manca:** tipo commessa, materiale cliente, disponibilità materiali. L’operatore vede solo il prodotto e i componenti.

**Caso 2 — Ciclo operatore.** Provato con API e UI: `start_setup` fuori sequenza → rifiutato (“Completa prima le attività precedenti della macchina”); `start_run` senza fine attrezzaggio → rifiutato; seconda attività con la prima in corso → rifiutata. Ciclo regolare accettato: attrezzaggio → produzione → dichiarazione (quantità buona/scarto, causale se scarto, lotti dei due componenti, esiti aspetto/incollaggio). La coerenza di fase è buona; la coerenza dei **valori** no (R2).

**Caso 3 — Due accoppiamenti successivi.** Non modellabile oggi: due attività indipendenti, nessun vincolo di precedenza, nessun trasferimento di quantità. Nessuna verifica operativa possibile oltre la lettura dello schema.

**Caso 4 — Produzione per magazzino (15%).** Nessuna distinzione, nessuna giacenza né collegamento con ordini successivi.

**Caso 5 — Fermo e causali.** 392 fermi con causali tabellate nelle statistiche e il pulsante “Segnala fermo macchina” a video, con motivo, senza conferma. Registrazione di un fermo e ripresa non eseguite dall’interfaccia in questa revisione.

---

## 4. Statistiche

| Indicatore | Stato | Verifica |
|---|---|---|
| Consuntivi chiusi, quantità buona e scarto per unità, % scarto, non conformi, fermi (n. e ore) | **Affidabili** | Ricalcolo SQL su 01/01–30/09/2026: 2.074 consuntivi, 441.396,4 m buoni, 8.404 m scarto, 117 NC, 346 fermi / 105,95 h: identici all’API |
| Ore previste/effettive di lavorazione e attrezzaggio, velocità effettiva, heatmap giornaliera | Plausibili, **non ricalcolati** | Formula esposta in “Come leggere i dati”; non riverificati in SQL |
| Produzione mensile “previsto vs buona” | **Da correggere** (etichetta) | È il previsto delle lavorazioni consuntivate, non il carico ordini; sensibile ai valori anomali (R2) |
| Incidenza scarto | **Da usare con cautela** | Corretta formula (scarto ÷ buona+scarto), ma distorta da un solo record anomalo: 1,87% → 0,63% |
| Conformità 94,25% | **Da chiarire** | Esclude “da verificare”; nel dimostrativo 126 consuntivi sono “da verificare” e 253 attendono decisione |
| Lotti completi (0/2.334 nel DB reale) | **Da correggere come KPI** | Valore nullo per assenza storica del lotto prodotto, non per difetto operativo: finché la storia non è bonificata il KPI non è informativo |
| Ritardi/puntualità consegne | **Non calcolabile** | `dueDate` vuoto in 2.397/2.397 |
| Commessa vs magazzino, cliente, fase | **Non calcolabile** | Campi assenti (R3) |
| Consumo/resa materiali, residui, giacenze, rotazione | **Non calcolabile** | Nessuna giacenza; consumi non confrontati con un teorico |
| Rilavorazioni | **Non calcolabile** | Esiste la decisione “rilavorazione” ma nessun flusso né dati |
| Confronto stagionale | **Non calcolabile in modo significativo** | 10 mesi simulati (dic 2025–set 2026): nessun anno precedente; la caduta di agosto è un’impostazione del generatore |
| OEE | **Non introdotto, correttamente** | Richiede definizioni condivise (ISO 22400-2 come riferimento) |

Il dato dimostrativo non è realistico per validare l’utilità: le sei causali di scarto pesano quasi uguali (≈17% ciascuna), la produzione mensile è piatta (~52.000 m), ogni lotto compare una sola volta, tutte le quantità sono in metri e tutto è a fase singola.

---

## 5. Norme, standard e buone pratiche (da verificare, non è una dichiarazione di conformità)

| Riferimento | Natura | Perché potrebbe riguardare il MES | Cosa manca per confermare |
|---|---|---|---|
| **Statuto dei lavoratori art. 4 (L. 300/1970, come modificato dal D.Lgs. 151/2015) e GDPR (Reg. UE 2016/679)** | Obbligo | Registrazione di operatore, orari e tempi per attività può costituire controllo indiretto a distanza e trattamento di dati personali | Finalità, accordo sindacale o autorizzazione, informativa, tempi di conservazione: consulente del lavoro/DPO |
| **ISO 9001:2015 §8.5.2 (identificazione e rintracciabilità) e §7.5 (informazioni documentate)** | Standard volontario | Registro modifiche, lotti, decisioni qualità | Se l’azienda è certificata e quali registrazioni il manuale richiede |
| **IATF 16949 / requisiti cliente automotive** | Volontario o contrattuale | Esempi a catalogo con articoli automotive | Se esistono clienti IATF; livello di tracciabilità richiesto (per rotolo) |
| **GRS, OEKO-TEX, GOTS o simili** | Volontario/richiesto dai clienti | Separazione e trasferimento delle certificazioni lungo i lotti; materiale cliente | Quali certificazioni e quali dati di lotto devono transitare |
| **Reg. UE 1007/2011 (etichettatura fibre tessili)** | Obbligo per chi immette il prodotto sul mercato | Composizione del prodotto accoppiato | Se l’azienda o il cliente è responsabile; il MES non la gestisce |
| **REACH (Reg. CE 1907/2006) e schede di sicurezza degli adesivi (es. PUR con isocianati)** | Obbligo | Tracciabilità dei lotti di adesivo/ausiliari non gestiti oggi come consumi | Se i lotti adesivo vanno registrati per prassi o per cliente |
| **Gestione materiale in conto lavorazione (documenti di trasporto, giacenza del cliente)** | Obbligo fiscale/contabile | Materiale di proprietà del cliente senza registrazione | Commercialista/consulente: modalità attuale |
| **Direttiva Macchine 2006/42/CE (Reg. UE 2023/1230 dal 2027) / D.Lgs. 81/2008** | Obbligo | Non pertinente finché il MES **non comanda** le macchine (oggi segnala solo il fermo) | Rivedere se si integra un PLC |
| **NIS2 (D.Lgs. 138/2024)** | Obbligo condizionato | Probabile non applicabilità al settore tessile | Rientro per codice ATECO/dimensione |
| **ISA-95 / ISO 22400-2** | Riferimento | Modello dei livelli e KPI di produzione | Uso come guida; nessuna certificazione |

Buone pratiche già presenti: backup coerente con verifica e prova di ripristino, audit con prima/dopo, rilascio separato dalla bozza, protezione delle lavorazioni avviate. Da aggiungere: conservazione e ripristino definiti per scritto, destinazione backup separata, controlli di coerenza (R2), anagrafica lotti (R5).

---

## 6. Esito

### 6.1 Da risolvere prima dell’uso operativo
1. **R1** rilascio bloccato nel DB attuale.
2. **R2** controlli di plausibilità alla chiusura.
3. **R3** requisiti dati: tipo ordine, proprietà del materiale, fasi, giacenza (definizione con il cliente).
4. **R4** ricalcolo e spostamenti nel passato alla creazione di un’attività.
5. **R5** anagrafica lotti, almeno per articoli con tracciabilità richiesta.

### 6.2 Migliorie consigliate (impatto/impegno)
| Ordine | Intervento | Impatto | Impegno |
|---|---|---|---|
| 1 | Soglie di plausibilità e avvisi (R2) | Alto | Basso |
| 2 | Riallineamento snapshot + test di regressione (R1) | Alto | Basso |
| 3 | Nessun ricalcolo non richiesto, mai nel passato (R4) | Alto | Medio |
| 4 | Campi tipo ordine, cliente, scadenza obbligatori per commessa (R3/R6) | Alto | Medio |
| 5 | Calendario con festività/chiusure (R7) | Medio | Basso |
| 6 | Avvisi su componenti uguali, scadenza passata (R6) | Medio | Basso |
| 7 | Nome utente univoco, HTTPS e backup su altro dispositivo (R9) | Medio | Basso |
| 8 | Anagrafica lotti e proprietà (R5) | Alto | Alto |
| 9 | Due fasi con vincoli e trasferimento quantità | Alto | Alto |
| 10 | Giacenze/disponibilità e collegamento Arca | Alto | Alto |

### 6.3 Domande aperte per l’azienda
1. Come si identifica una commessa e quale dato Arca la definisce (ordine, riga, cliente)? Chi stabilisce priorità e consegna?
2. Il tessuto del cliente viene ricevuto con DDT e lotto? Va tenuto separato in magazzino e nelle statistiche? Chi risponde di scarti sul materiale del cliente?
3. Nelle due fasi il semilavorato ha codice proprio? La seconda fase può partire con quantità parziali? Chi decide lo scarto tra le fasi?
4. Come si gestisce oggi l’articolo standard a magazzino: scorta minima, ordine di produzione di reintegro?
5. Quali tolleranze di consumo e rendimento sono accettabili per articolo (R2)? Chi autorizza gli scostamenti?
6. Quali controlli qualità servono per articolo, oltre ad aspetto e incollaggio? Esistono prove di laboratorio da registrare?
7. Tracciabilità: per rotolo, per lotto di fornitura o per lavorazione? Quali clienti o certificazioni la richiedono?
8. Le unità di misura sono sempre metri? Consumi in m² o kg con conversione?
9. Quali giorni di chiusura, turni e straordinari vanno nel calendario?
10. Chi usa quali dispositivi (tablet reparto, PC ufficio) e con quali credenziali: account personali o di postazione?
11. È stato definito con il consulente l’impiego dei dati individuali di operatori (art. 4 Statuto, GDPR)?
12. Per quanti anni conservare dati e backup, e dove?
13. Come si definisce OEE e tempo disponibile (turni, pause, manutenzione)?
14. Quando sono disponibili dati reali di almeno 24 mesi per confronti stagionali?

### 6.4 Spiegazione per gli operatori (basata sui flussi verificati)
> **Come si usa Aloven.** Il pianificatore prepara il piano come *bozza*: finché non viene *rilasciato* non lo vedi in reparto. Sul tablet apri `/operatore`, scegli la tua macchina e vedi **una sola azione grande**: *Inizia preparazione* → *Termina preparazione* → *Inizia produzione*. Puoi mettere in pausa il lavoro con un motivo, oppure segnalare un fermo macchina (non ferma fisicamente la macchina; la ripresa del lavoro la fai tu). A fine lavoro premi *Dichiara e completa*: 1) quantità buona e scarto (con la causale se c’è scarto), 2) lotto e metri consumati per ciascuno dei due componenti, con lettore barcode o a mano, 3) esito qualità di aspetto e incollaggio. Inserisci i **numeri reali**, non quelli proposti: il sistema non li controlla ancora e ogni errore finisce nelle statistiche. Non puoi iniziare una lavorazione fuori sequenza o con un’altra già in corso: se serve cambiare ordine, chiama il pianificatore. Il sistema oggi **non** gestisce magazzino, materiale del cliente, commesse e seconda fase: queste informazioni vanno trattate fuori dal MES.

---

## 7. Che cosa non è stato verificato
Interfacce su dispositivi fisici e con lettore barcode; flusso di fermo e di interruzione da interfaccia; rettifiche e decisioni qualità; esportazione Excel; ripristino da backup; mobile 390 px; carico con più utenti; accessibilità secondo WCAG; correttezza dei calcoli di ore previste/effettive e velocità; contenuto delle schede “Tracciabilità” e “Verifiche qualità” a video; qualunque integrazione ERP.


## 8. Stato delle correzioni — 13 ottobre 2026

Questa sezione aggiorna gli esiti senza modificare le evidenze della revisione originale.

| Rilievo | Esito dell'intervento |
|---|---|
| R1 | Corretto: 2.334 snapshot storici riallineati nel DB operativo dopo backup verificato; consuntivi invariati. Rilascio riuscito su copia; completate non bloccano più il rilascio e attività in corso restano protette. Script di riduzione corretto e riparazione idempotente. Nessuna bozza pubblicata automaticamente. |
| R2 | Corretto: soglie configurabili, motivazione obbligatoria, rifiuto atomico senza motivazione, flag persistenti e attenzione qualità/statistiche/export. Quantità effettiva da digitare, previsto come suggerimento. Tolleranze aziendali da concordare; unità diverse non confrontate senza conversione. |
| R3 | Aperto: definire con il cliente commessa/magazzino, proprietà materiale, codice semilavorato, avvio parziale e trasferimento quantitativo. Nessun modello inventato né giacenza/ERP implementati. |
| R4 | Corretto: schede non pianificate non muovono altre attività; ricalcoli e nuove pianificazioni rispettano l'ora di Roma arrotondata in avanti al minuto. Nuovi pin nel passato rifiutati; storico e pin già esistenti preservati. |
| R5 | Aperto: livello di tracciabilità e anagrafica rotoli richiedono regole articolo/proprietà/ricevimento del cliente. Ricerca dei lotti dichiarati e storico preservati. |
| R6 | Avvisi e conferma implementati per componenti uguali, quantità/consegna mancanti e consegna passata. Obbligatorietà per commessa rinviata alla definizione del tipo ordine (R3). |
| R7 | Preset festività implementato, selezionabile per anno con anteprima/conferma e precedenze conservate; nessuna chiusura applicata automaticamente al DB reale. Festa patronale e chiusure aziendali da fornire. |
| R8 | Statistiche chiariscono uso dei tempi base quando mancano matrici. Matrici reali da fornire. |
| R9 | Nomi duplicati nuovi rifiutati; duplicati esistenti segnalati e ID autore in audit. Catena hash e verifica integrità implementate. HTTPS, cookie Secure e backup esterno restano configurazioni dell'installazione; la catena non impedisce la riscrittura dell'intero database da parte di chi lo controlla. |
| R10 | Avvisi di inizio superato anche in Attività/reparto, quantità effettiva vuota, riferimenti aperti, toast spostato e KPI chiariti. Rilascio per macchina/selezione resta futuro; interfaccia di rilascio esistente preservata. |

Verifiche finali: 114/114 unitari/HTTP; browser Edge su DB temporanei: revisione 5/5, operatore 6/6, statistiche 16/16, MES 9/9, planner 10/10. Nessun difetto bloccante di layout nelle schermate desktop/tablet/mobile ispezionate. Verifica dati: riparazione revisione 74→75, migrazioni additive 75→77, nessuna variazione inattesa delle colonne operative originali (sessioni escluse), integrità SQLite e catena audit valide. Servizio locale aggiornato; nessun nuovo rilascio del piano, commit o push.

Memoria aggiornata in MEMORIA_PROGETTO.md. Report: .artifacts/revision-repair-preservation.json, revision-upgrade-preservation.json, revision-review-report.json e revision-unit-tests.log; ulteriori esiti nei report operatore/statistiche/MES/planner. Le domande aziendali della sezione 6.3 restano aperte; l'intervento non dichiara conformità normativa né idoneità produttiva generale.
