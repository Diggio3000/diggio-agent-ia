# Modifiche

## 2.2.5 — 18 settembre 2026

- Limite dei passaggi facoltativo e disattivato per default: campo vuoto o zero significa nessun limite. Migrazione una tantum del precedente valore predefinito di 40; soglie personalizzate diverse conservate.
- Le letture identiche ripetute fanno cambiare strategia e, se persistono, richiedono indicazioni all’utente. Stop, timeout e controlli degli errori restano attivi.
- Corretto il segnaposto di privacy reinviato al modello: i valori digitati restano disponibili durante l’attività, mentre sono omessi dalla cronologia delle azioni salvata. Il segnaposto non può essere digitato come contenuto.
- Lettura dello stato visibile di Google Fogli (selezione, barra della formula, editor e salvataggio), senza API Google. I modelli configurati senza visione ricevono istruzioni coerenti con gli strumenti disponibili.
- Test automatici per attività oltre 40 passaggi, limiti personalizzati, letture ripetute e conservazione temporanea del testo inserito. Il collaudo completo su Google Fogli e Documenti resta necessario prima della pubblicazione.

## 2.2.4 — 18 settembre 2026

- Ripresa delle schede aperte dall’agente nella stessa conversazione e sessione del browser; gli ID non vengono riutilizzati dopo il riavvio di Chrome.
- Messaggi del provider conservati anche quando l’errore è restituito come stringa.
- Risposte troncate dal provider riconosciute: nessun comando incompleto eseguito; in Chat il testo disponibile è indicato come parziale.
- Le risposte di solo ragionamento non vengono mostrate come risultati.

## 2.2.3 — 17 settembre 2026

- Budget token facoltativo, disattivato per impostazione predefinita. Campo vuoto o zero salvati come nessun limite; una soglia positiva resta configurabile.
- Migrazione una tantum del precedente valore predefinito di 80.000, anche nei profili e nelle automazioni. Soglie personalizzate diverse conservate; 80.000 può essere scelto di nuovo dopo l’aggiornamento.
- Riepilogo Consumi coerente con la soglia disattivata; conteggi e limite dei passaggi indipendenti.
- Test di regressione per cancellazione/salvataggio/riapertura e attività completata oltre 80.000 token, con provider simulato.

## 2.2.2 — 16 settembre 2026

- Avviso Chat sempre visibile prima dell’invio e pulsante Usa il browser: seleziona Con approvazione senza inviare la bozza.
- Risultati aperti con ID espliciti, elenco delle schede dell’attività e cambio della scheda controllata. Letture associate all’URL della fonte.
- Parser tollerante a etichette Markdown, maiuscole/minuscole e oggetto JSON esplicito; comandi ambigui o incompleti restano rifiutati. Recupero automatico limitato delle risposte fuori formato, senza falso completamento.
- Contesto più compatto: meno testo ripetuto delle pagine precedenti e descrizioni degli strumenti non duplicate con tool calling nativo.
- Messaggi e impostazioni distinguono budget locale cumulativo dell’attività, crediti e quote del provider. Una bozza non recuperabile resta indicata come non verificata.

## 2.2.1 — 16 settembre 2026

- Icona D-128 fornita dall’autore applicata all’estensione, al pannello e alle grafiche pubbliche.


## 2.2.0 — 16 settembre 2026

- Procedure Insegnami da chat e registrazione clic, bozze approvate, revisioni e riutilizzo.
- Controllo browser più robusto: bersagli univoci, Shadow DOM, attese interrompibili, focus verificato, accessibilità, doppio clic e scorciatoie.
- Strumenti guidati per operare su Documenti, Fogli e Presentazioni attraverso il browser. Nessuna integrazione API Google.
- Documentazione, esempi, privacy e immagini aggiornati.

## 2.1.0 — 16 settembre 2026

- Consumi per connessione/modello, limiti dichiarati, dashboard e quota chiave OpenRouter.
- Indicazioni Ollama cloud e distinzione fra dati ignoti e zero.
- Firma autore e sito ripristinati; configurazione iniziale ben visibile.


## 2.0.0 — revisione locale

- Nuova interfaccia adattabile al pannello, con temi chiaro/scuro persistenti.
- Modalità Chat senza controllo browser, Agente autonomo e Agente con approvazione.
- Piano di lavoro visibile, parametri modificabili prima dell’approvazione, arresto della richiesta e dei nuovi comandi.
- Conversazioni persistenti con ripristino del contesto e dello stato di attesa; preferenze personali modificabili.
- Endpoint custom generico: URL base/completo o gateway PHP, elenco modelli configurabile, protocollo OpenAI/Anthropic, autenticazione Bearer/header/nessuna, capacità immagini configurabile.
- Adattatore condiviso per connessione, chat e agente; immagini nel formato corretto per Anthropic.
- Chiavi migrate da Chrome Sync allo storage locale dell’estensione.
- Parser strutturale e validazione azioni; niente completamenti impliciti da risposte incomplete.
- Esclusione password dalle etichette, protezione dei campi riservati, verifica del focus e rimozione dei click automatici sui popup.
- Conferme estese a click numerati e tastiera sui domini sensibili; JavaScript sempre da approvare.
- Automazioni in schede dedicate, retry separato dalla periodicità, condizione di arresto con evidenza e risultati in cronologia.
- Link con query integri, tabelle e codice nei messaggi, export CSV protetto da formule e report HTML.
- Timeout sull’intera risposta, limiti di passaggi/token, interruzione degli errori ripetuti e conservazione limitata delle chat.
- Test automatici e packaging con controllo di assenza di riferimenti a infrastrutture interne.

Limiti: la condizione di arresto e il piano sono interpretati dal modello; non è garantita la correttezza del contenuto generato. Stop non annulla azioni già completate. Le sessioni si recuperano tramite conversazione; un riavvio del browser non riprende automaticamente un comando in corso.
