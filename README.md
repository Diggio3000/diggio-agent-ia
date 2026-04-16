# 🤖 Diggio Agent IA

**Agente AI che controlla Chrome al posto tuo.**

Descrivi quello che vuoi fare in linguaggio naturale — l'agente naviga siti, clicca, compila form, legge pagine, scatta screenshot e completa task complessi autonomamente.

[![Chrome Web Store](https://img.shields.io/badge/Chrome%20Web%20Store-Disponibile-4285F4?style=flat&logo=googlechrome&logoColor=white)](https://chrome.google.com/webstore)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-10b981?style=flat)](manifest.json)

---

## 📸 Screenshot

<div align="center">
  <img src="schermate/slide1.png" width="800" alt="Home Agent" />
  <br/><br/>
  <img src="schermate/slide2.png" width="800" alt="Funzioni dell'Agente" />
</div>

---

## ✨ Funzionalità principali

- 🧠 **Loop ReAct** fino a 30 passi — Ragionamento → Azione → Osservazione
- 🔑 **Porta la tua API Key** — nessun lock-in, scegli tu il provider
- 🛠️ **20+ azioni** per controllare il browser (naviga, clicca, digita, scrolla, legge, esegue JS…)
- 🤖 **Automazioni programmate** con Chrome Alarms — girano in background anche a pannello chiuso
- 🖼️ **Vision** — allega immagini come riferimento visivo per confronti prodotti
- 📈 **Analisi SEO** completa con punteggio 0-100
- 🛡️ **Controllo sicurezza sito** — VirusTotal, SSL, header, scansione codice sorgente
- 🕵️ **Verifica truffa** — 15 indicatori di frode + WHOIS + Trustpilot
- 💰 **Scraper prezzi** con modalità loop/monitoraggio
- ⚖️ **Confronto prodotti** tra più URL
- 📝 **Form Filler** — compila automaticamente qualsiasi form
- ⭐ **Template** — salva e riutilizza prompt
- 🕐 **Cronologia** — tutte le sessioni salvate e ricercabili
- 📊 **Export** CSV / JSON / Report HTML

---

## 🔑 Provider AI supportati

| Provider | Endpoint | Note |
|----------|----------|------|
| **OpenAI** | `api.openai.com` | GPT-4o, GPT-4o-mini, GPT-4-turbo |
| **Anthropic** | `api.anthropic.com` | Claude Opus, Sonnet, Haiku |
| **Groq** | `api.groq.com` | Llama 3.3, Mixtral, Gemma — gratis con limiti |
| **OpenRouter** | `openrouter.ai` | Centinaia di modelli con una sola chiave |
| **Perplexity AI** | `api.perplexity.ai` | Sonar Pro, Sonar Reasoning |
| **Ollama** | `localhost:11434` | Qualsiasi modello locale — 100% privato |
| **Custom** | Qualsiasi URL | Open WebUI, LM Studio, llama.cpp… |

I modelli vengono **caricati automaticamente** dall'endpoint premendo 🔄 — nessuna configurazione manuale.

---

## 🚀 Installazione

### Da Chrome Web Store *(consigliato)*
1. Vai sul [Chrome Web Store](#) *(link in arrivo)*
2. Clicca **Aggiungi a Chrome**
3. Apri il pannello laterale cliccando l'icona 🤖 in toolbar

### Manuale (sviluppatori)
1. Clona il repository:
   ```bash
   git clone https://github.com/Diggio3000/diggio-agent-ia.git
   ```
2. Apri Chrome e vai su `chrome://extensions/`
3. Attiva **Modalità sviluppatore** (in alto a destra)
4. Clicca **Carica estensione non compressa**
5. Seleziona la cartella `diggio-agent-ia`

---

## ⚙️ Configurazione

1. Clicca **⚙️** nell'header del pannello
2. Seleziona il **Provider AI** (es. OpenAI)
3. L'**endpoint** si compila automaticamente
4. Incolla la tua **API Key**
5. Premi **🔄** per caricare i modelli disponibili
6. Scegli il modello e clicca **💾 Salva e testa**

---

## 💬 Esempi di task

```
Vai su amazon.it e cerca "cuffie wireless" ordinando per prezzo crescente.
Trovami i 3 migliori entro 50€ con almeno 4 stelle e spedizione Prime.
```

```
Analizza la SEO di https://esempio.it e dimmi le 5 cose più urgenti da migliorare.
```

```
Controlla se https://sito-sconosciuto.com è una truffa o un sito legittimo.
```

```
Compila il form di contatto su questa pagina con i miei dati salvati.
```

```
Monitora il prezzo di questo prodotto ogni ora e avvisami quando scende sotto 80€.
```

---

## 🏗️ Struttura del progetto

```
diggio-agent-ia/
├── manifest.json              # Manifest V3
├── background/
│   ├── worker.js              # Service worker: loop agente ReAct
│   ├── diggio-client.js       # Client API multi-provider, system prompt
│   ├── cdp-controller.js      # Chrome DevTools Protocol: azioni browser
│   └── tab-manager.js         # Gestione schede Chrome
├── sidepanel/
│   ├── panel.html             # UI pannello laterale
│   ├── panel.js               # Logica pannello: chat, impostazioni, strumenti
│   └── panel.css              # Stile dark theme
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 🔒 Privacy

- Le API Key sono salvate **solo sul tuo dispositivo** (`chrome.storage.sync`)
- I dati vengono inviati **direttamente al provider AI che hai scelto** — nessun server intermedio
- Nessuna telemetria, nessun tracciamento, nessuna raccolta dati

👉 [Privacy Policy completa](https://Diggio3000.github.io/diggio-agent-ia-privacy/)

---

## 🤝 Contribuire

1. Fai un fork del repository
2. Crea un branch per la tua feature: `git checkout -b feature/nuova-funzione`
3. Commit: `git commit -m 'Aggiunge nuova funzione'`
4. Push: `git push origin feature/nuova-funzione`
5. Apri una Pull Request

Per bug e suggerimenti: apri una [Issue](https://github.com/Diggio3000/diggio-agent-ia/issues).

---

## 📄 Licenza

[GPL v3](LICENSE) — Copyright © 2026 Antonio Di Giorgio (Diggio3000)

---

## 👤 Autore

**Antonio Di Giorgio** — per tutti Diggio3000

📧 [diggiotelefonia@gmail.com](mailto:diggiotelefonia@gmail.com)

---

*Diggio Agent IA — Il tuo agente AI che controlla Chrome al posto tuo.*
