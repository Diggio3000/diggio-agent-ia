# Chrome Web Store — materiali Diggio Agent IA 2.2.5

Lo stato effettivo dell’invio e della disponibilità pubblica è documentato in PUBBLICAZIONE.md.

Novità 2.2.5: budget token e limite passaggi facoltativi, disattivati per impostazione predefinita; recupero delle schede, gestione delle risposte incomplete e lettura dello stato visibile di Google Fogli migliorati.

## Descrizione breve

Chat AI e agente browser con il tuo modello: procedure riutilizzabili, consumi e comandi autonomi o da approvare.

## Descrizione completa

Diggio Agent IA ti aiuta a scrivere, leggere pagine e svolgere attività nel browser con il provider AI che scegli tu.

QUATTRO MODI DI LAVORARE
• Chat: ragiona, scrivi e analizza gli allegati, senza leggere o controllare il browser. Un avviso lo chiarisce prima dell’invio; Usa il browser permette di passare alla modalità Con approvazione.
• Agente autonomo: esegue il compito sulla scheda selezionata; alcune azioni richiedono comunque conferma.
• Con approvazione: esamina, modifica o salta i comandi prima dell’esecuzione.
• Insegnami: descrivi una procedura o registra i tuoi clic, controlla la bozza e salvala per riutilizzarla. Si salvano istruzioni, senza addestrare i pesi del modello.

IL TUO MODELLO, IL TUO SERVIZIO
Configura un provider supportato, Ollama o un endpoint personalizzato compatibile. Puoi impostare indirizzo, modello, autenticazione ed elenco modelli. Al primo avvio il pannello ti guida alla configurazione. Il plugin non include crediti AI; i servizi esterni possono applicare costi. Gli abbonamenti web ChatGPT e Claude non sostituiscono le rispettive credenziali API.

UN ASSISTENTE NEL BROWSER
Analizza pagine, confronta informazioni, prepara testi ed esegui operazioni con clic, tastiera, attese e osservazioni. Puoi preparare richieste per lavorare in Documenti, Fogli e Presentazioni Google attraverso la pagina aperta, senza integrazioni API Google. La disponibilità delle operazioni dipende dall’editor, dalla sua accessibilità e dal modello; verifica i risultati delle modifiche. Login e campi riservati restano sotto il tuo controllo.

PROCEDURE CHE PUOI CORREGGERE
Registra una breve dimostrazione nella scheda scelta oppure costruisci una procedura in chat. I valori dei campi non vengono conservati nella registrazione. Controlla comunque etichette, selettori e percorsi prima di approvare la bozza. Le procedure salvate si possono modificare, eliminare e preparare in chat prima di inviarle.

CONSUMI E ATTIVITÀ
Consulta i token comunicati dai provider, i limiti disponibili e i collegamenti alle dashboard, anche per Ollama cloud. I dati mancanti sono indicati e i conteggi locali non sono il saldo dell’account. Programma attività con intervallo o giorni/orario, limite di esecuzioni e condizione di arresto. Chrome e il computer devono essere disponibili.

Budget token e limite di passaggi sono facoltativi e disattivati per default. Puoi configurarli in Impostazioni → Memoria e limiti; campo vuoto o zero significa nessuna soglia locale. Restano Stop, timeout e gestione degli errori. Letture identiche ripetute provocano un cambio di strategia e, se persistono, una richiesta di indicazioni.

INTERFACCIA E DATI
Temi chiaro e scuro, piano di lavoro, cronologia riprendibile, preferenze e report esportabili. Impostazioni e chiavi restano nello storage locale dell’estensione, senza Chrome Sync. I contenuti necessari al compito sono inviati al provider scelto. Non è richiesto un server dello sviluppatore e il codice non include telemetria dello sviluppatore.

Stop interrompe le nuove azioni ma non annulla quelle già eseguite. Inizia con approvazione dei comandi e verifica i risultati prima di usarli.

Sviluppatore: Antonio Di Giorgio · Diggio3000
Sito: https://www.diggio3000.it
Privacy: https://diggio3000.github.io/diggio-agent-ia-privacy/

## Immagini da caricare

Cinque PNG 1280×800 in `docs/assets/01-interfaccia.png` fino a `05-procedure.png`; tile promozionale `promo-440x280.png`; banner facoltativo `marquee-1400x560.png`. Le immagini mostrano l’interfaccia reale in un ambiente dimostrativo, con dati simulati, senza account o documenti privati. Non mostrano esecuzioni reali su Google Workspace.

## Note per la revisione

Scopo unico: assistente AI per l’utente nel browser. Richiede un endpoint AI configurato dall’utente. Per provare senza acquistare crediti è possibile configurare un’istanza Ollama locale accessibile dal browser; il modello deve supportare il formato di azioni richiesto. I test nel repository usano risposte locali simulate e verificano i controlli, non la qualità di un modello specifico.

Permessi e trattamento sono descritti in [Privacy](PRIVACY.md). Il nuovo permesso scripting esegue funzioni incluse nel pacchetto per verificare elementi e focus e registrare dimostrazioni avviate dall’utente. debugger controlla solo le schede delle attività. Gli host generici servono ai siti scelti dall’utente e agli endpoint custom.

Il comando JavaScript esistente esegue nella pagina codice proposto dal modello dopo approvazione esplicita. Dichiarato come codice remoto al revisore, con riferimento alla deroga Debugger API nella sezione 2 delle Additional Requirements for Manifest V3: https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements. Non è garantita l’accettazione da parte dello Store. Il pacchetto non scarica dipendenze runtime.

## Dichiarazioni sui dati

Il modulo privacy dello Store deve riflettere i contenuti effettivamente trattati: autenticazione (chiavi API), attività/interazioni nelle pagine e contenuti dei siti, comunicazioni e qualsiasi categoria personale presente nei materiali che l’utente chiede di analizzare. Non dichiarare “nessun dato trattato” soltanto perché il trasferimento va direttamente al provider. Non selezionare usi pubblicitari o vendita dei dati: il codice non li implementa. Controllare le definizioni esatte del modulo prima dell’invio.

La pubblicazione del codice e il caricamento dello ZIP non equivalgono all’approvazione della nuova versione nello Store. Registrare separatamente caricamento, invio in revisione e disponibilità pubblica.

Categorie dichiarate nella dashboard: identificazione personale, dati finanziari e di pagamento, autenticazione, comunicazioni personali, cronologia web delle attività, attività utente e contenuti dei siti. Non sono dichiarate raccolte dedicate di dati sanitari o posizione.

Icone scelte dall’autore: D rossa nel plugin e nel pannello; logo Diggio con pianeta per l’icona del negozio.
