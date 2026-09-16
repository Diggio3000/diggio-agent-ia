# Privacy — Diggio Agent IA

Aggiornamento: 16 settembre 2026 · versione 2.2.1

## Sviluppatore e scopo

Antonio Di Giorgio (Diggio3000) sviluppa questa estensione per conversare con un modello AI scelto dall’utente e svolgere attività nel browser. Contatto: diggiotelefonia@gmail.com · https://www.diggio3000.it.

## Dati sul dispositivo

Lo storage locale dell’estensione conserva impostazioni, chiavi API, profili di connessione, conversazioni e allegati, preferenze, template, dati forniti per compilare form, note tecniche, procedure e automazioni. Lo stato dell’attività e l’ultima registrazione sono conservati anche nello storage di sessione. Le vecchie impostazioni in Chrome Sync vengono migrate nello storage locale e rimosse da Sync.

Lo storage non è un gestore cifrato di segreti. Proteggi il dispositivo e il profilo Chrome. Le chiavi servono ad autenticare le richieste al servizio configurato; non salvarle nelle istruzioni, nelle preferenze o nelle procedure.

## Richieste ai servizi

Messaggi, cronologia pertinente, allegati e osservazioni necessari al compito vengono inviati direttamente al provider AI scelto. Le osservazioni possono comprendere testo, link, screenshot, albero di accessibilità, contenuti dell’editor a fuoco, console e informazioni sulle richieste di rete della scheda. Possono contenere dati personali o riservati presenti nei materiali analizzati.

Non è richiesto un server dello sviluppatore. Con un modello realmente eseguito sul dispositivo, le richieste AI restano locali; i siti visitati possono comunque comunicare con Internet. Un endpoint locale Ollama che inoltra richieste a un modello cloud invia invece i contenuti al servizio cloud. Ogni provider applica i propri termini, costi e criteri di conservazione: l’estensione non può cancellare dati già ricevuti da questi servizi.

Documenti, Fogli e Presentazioni vengono utilizzati attraverso la sessione Google nel browser, senza integrazione OAuth/API Google. I contenuti osservati per il compito possono essere inviati al provider AI configurato, anche se diverso da Google. La normale attività sui siti comunica inoltre con i rispettivi gestori.

## Insegnami e registrazione

La registrazione si attiva su richiesta nella scheda selezionata e mostra un avviso nella pagina. Raccoglie tipi di azione, etichette, selettori e percorsi di navigazione; non conserva i valori digitati o selezionati nei campi. Query e frammenti vengono rimossi dagli URL di navigazione registrati. Etichette, attributi, selettori e percorsi possono comunque contenere dati personali: la bozza deve essere controllata prima di salvarla.

La registrazione riguarda il documento principale e lo Shadow DOM aperto, non gli eventi dentro gli iframe. Si ferma al cambio di origine, alla chiusura della scheda oppure al limite di 20 minuti o 100 passaggi. L’ultima registrazione resta nello storage di sessione per il recupero finché viene sostituita o la sessione termina. Le dimostrazioni hanno effetto reale sui siti.

Le procedure si salvano solo con l’approvazione dell’utente, fino a 50, e sono eliminabili o modificabili dal pannello. Una procedura scelta per il riutilizzo viene inserita nella bozza della chat e inviata al modello quando l’utente invia il messaggio. Insegnami conserva istruzioni: non addestra i pesi del modello. Il trattamento successivo del provider resta regolato dalle sue condizioni.

## Consumi

Il registro locale conserva conteggi e limiti ricevuti, data, modello, host e impronta della connessione; non contiene messaggi o chiavi API. Mostra fino a 30 giorni e 200 combinazioni di connessione e modello; la pulizia dei dati obsoleti avviene durante gli aggiornamenti del registro.

L’aggiornamento esplicito della quota OpenRouter invia la chiave salvata soltanto all’API ufficiale OpenRouter. I link alle dashboard dei provider si aprono su richiesta. I conteggi locali e i limiti rilevati non sostituiscono il saldo del provider.

## Controllo e conservazione

Chat e Insegnami in chat non controllano il browser. L’agente usa la scheda scelta; le automazioni usano schede dedicate. La modalità con approvazione consente di esaminare i comandi. Le azioni JavaScript e quelle sui domini riconosciuti come sensibili richiedono conferma anche in modalità automatica. Stop impedisce nuovi comandi ma non annulla azioni già eseguite.

I campi riconosciuti come password o riservati vengono esclusi da alcune letture e protetti dall’inserimento automatico. Il mascheramento degli screenshot riguarda i campi identificabili nel documento principale e nello Shadow DOM aperto. Non garantisce la rimozione di ogni dato sensibile, specialmente in immagini, canvas e iframe. Valuta i contenuti prima di chiedere all’agente di osservarli.

La cronologia conserva fino a 30 conversazioni entro un budget stimato di circa 6,5 MB; quando viene superato, vengono eliminate le più vecchie. Conversazioni, template, note, procedure e automazioni sono eliminabili dai rispettivi pannelli. Le chiavi si cancellano o sostituiscono nelle Impostazioni. Disinstallando si rimuove lo storage dal profilo; restano eventuali esportazioni, documenti creati sui siti e dati già inviati ai provider.

## Permessi

- debugger: osservazione e controllo della scheda mediante Chrome DevTools Protocol.
- scripting: individuazione degli elementi, verifica del focus, mascheramento dei campi e registrazione esplicitamente avviata.
- tabs e tabGroups: selezione e organizzazione delle schede dell’attività.
- sidePanel: interfaccia laterale.
- storage: impostazioni e dati sul dispositivo.
- alarms: attività programmate.
- notifications: risultati, errori e richieste di intervento.
- Accesso agli host: attività sui siti scelti e richieste agli endpoint configurati, compresi servizi locali e personalizzati.

## Telemetria

Il codice dell’estensione non include telemetria, tracciamento analitico o vendita di dati da parte dello sviluppatore. I servizi configurati e i siti visitati applicano le loro politiche. Le modifiche a questa informativa vengono pubblicate con una nuova data di aggiornamento.
