# Modifiche

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
