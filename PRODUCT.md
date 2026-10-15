# Aloven — contesto del prodotto

MES per un reparto di accoppiatura tessuti, con pianificazione multiutente e console operatore tablet in italiano e inglese. Database SQLite locale; finora nessuna movimentazione reale di magazzino. Previsti ma non ancora implementati: collegamento con Arca (ordini, distinta base, documenti di carico e scarico con lotti) e sequenziamento automatico per criteri specifici; lavorazioni con più fasi rimandate dall'utente.

Il pianificatore deve scegliere le attività da produrre, ordinarle per macchina e rilasciare il piano. Le macchine di destinazione già definite evitano un'assegnazione manuale superflua. Compatibilità e preferenza sono distinte; più macchine compatibili non autorizzano un bilanciamento automatico.

Le modifiche alle attività non iniziate si preparano come bozza. Solo il rilascio aggiorna il piano visibile a bordo macchina. Preparazione e produzione già iniziate sono protette. Il pianificatore può richiedere un'interruzione eccezionale motivata; l'operatore conferma la fermata e registra gli eventuali consuntivi. Storico, tempi e lotti restano conservati.

La proposta per periodo aiuta a scegliere le attività che entrano nel calendario disponibile, considerando consegne, attrezzaggi e code esistenti. Mostra inclusioni, esclusioni e capacità residua; richiede controllo e rilascio umano. Non promette ottimizzazione matematica o OEE.

L'interfaccia deve privilegiare code leggibili e comandi espliciti. Calendario e carico supportano la verifica dei tempi. Conservare identità Aloven, sei sezioni principali, convenzioni esistenti e accessibilità dei comandi. Non aumentare le conferme delle normali azioni touch: conferma dedicata solo per l'interruzione eccezionale.

Verifica su database temporanei; migrazioni additive con backup e controllo di preservazione dei dati operativi. Gli utenti di reparto reali devono ancora validare la comprensibilità sul campo.
