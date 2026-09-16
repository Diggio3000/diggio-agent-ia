# Diggio Agent IA 2.0

Chat e automazione del browser con il modello che scegli tu.

## Modalità

- **Chat**: conversazione, scrittura e analisi degli allegati, senza accesso al browser.
- **Agente autonomo**: lavora sulla scheda scelta. JavaScript e azioni sui domini sensibili richiedono approvazione.
- **Con approvazione**: esamina, modifica o salta ogni comando prima dell’esecuzione.

Tema chiaro/scuro selezionabile, piano di lavoro visibile, conversazioni riprendibili, preferenze personali, strumenti guidati e automazioni programmate.

## Installazione locale

1. Apri `chrome://extensions` in Chrome 120 o successivo.
2. Attiva Modalità sviluppatore.
3. Scegli **Carica estensione non pacchettizzata** e seleziona questa cartella.
4. Apri il pannello dall’icona dell’estensione e configura il modello.

Il pacchetto nella cartella `dist` contiene solo l’estensione. Estrailo prima di caricarlo manualmente.

## Connessioni e servizi custom

Scegli un provider oppure **Endpoint custom**. Inserisci:

- Indirizzo base, come `https://api.example.com/v1`, oppure endpoint completo.
- Chiave API, solo se richiesta dal servizio.
- Nome esatto del modello, scritto manualmente o selezionato con **Carica**.

Nella compatibilità avanzata puoi scegliere OpenAI compatibile o Anthropic Messages, un URL separato per l’elenco modelli, autenticazione Bearer o tramite header personalizzato, oppure nessuna autenticazione. Per un gateway PHP, l’elenco viene richiesto con GET allo stesso endpoint; è possibile cambiarlo. Sono riconosciute liste OpenAI, Ollama e risposte con modelli dentro `data.models`.

Per i modelli con nomi personalizzati imposta esplicitamente il supporto immagini. Il servizio deve implementare uno dei protocolli supportati: il modulo non converte API arbitrarie o pagine HTML in API AI. Gli endpoint locali possono richiedere una configurazione CORS sul server.

I profili dei provider vengono conservati separatamente. **Salva** non invia richieste; **Salva e verifica** invia un breve messaggio al servizio scelto. Un elenco modelli su un’origine differente non riceve implicitamente la chiave dell’endpoint chat.

## Conversazioni e dati

Le chiavi e le impostazioni sono nello storage locale di Chrome; le impostazioni precedentemente in Sync vengono migrate e rimosse da Sync. Nessun server dello sviluppatore è necessario. Testo, immagini e osservazioni necessari al compito vengono trasmessi al provider configurato.

Le conversazioni vengono aggiornate senza duplicati e si possono riprendere dalla Cronologia. Sono conservate fino a 30 conversazioni entro un budget di circa 6,5 MB stimati. Le preferenze personali si modificano nelle Impostazioni; le note tecniche dei siti negli Strumenti. Non salvare password nelle preferenze.

I valori dei campi password vengono esclusi dalla numerazione e mascherati negli screenshot. L’agente non compila campi password e alcuni campi riservati. Questo non costituisce una garanzia di rimozione di ogni dato sensibile presente su una pagina.

## Automazioni

Un’attività programmata conserva la connessione scelta alla creazione, utilizza una scheda dedicata e salva il risultato in Cronologia. Puoi impostare intervallo o giorni/orario, massimo esecuzioni e una condizione di arresto in linguaggio naturale. Il modello deve fornire un’evidenza per dichiararla raggiunta.

Un’attività che richiede conferma o risposta attende l’utente e mostra una notifica. Stop interrompe la richiesta corrente e impedisce nuovi comandi; non annulla azioni già eseguite. Il computer e Chrome devono essere disponibili per eseguire gli eventi programmati.

## Sviluppo e verifica

Richiede Node.js recente e Python 3 per creare lo ZIP.

```sh
npm ci
npm test
npx playwright install chromium
npm run test:ui
npm run package
```

Le prove browser usano un profilo isolato e un servizio AI simulato sulla macchina locale. Non richiedono chiavi e non contattano servizi AI commerciali. Screenshot e report di test finiscono in `test-results`, esclusa da Git e dal pacchetto.

Il codice comune alle edizioni si aggiorna tramite lo script di sincronizzazione nella cartella del progetto principale. Non modificare separatamente copie dei moduli condivisi.

## Struttura

- `background`: ciclo agente, controllo CDP e client AI.
- `shared`: provider, sicurezza, scheduler e rendering.
- `sidepanel`: interfaccia senza framework e senza dipendenze runtime.
- `tests`: regressioni e prove browser.
- `scripts`: packaging riproducibile.

Licenza GPL v3. Autore: Antonio Di Giorgio — [www.diggio3000.it](https://www.diggio3000.it).
