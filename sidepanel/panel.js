// sidepanel/panel.js

const $ = id => document.getElementById(id);

// Versione letta dinamicamente dal manifest
const { version } = chrome.runtime.getManifest();
document.addEventListener('DOMContentLoaded', () => {
  const el = $('footerVersion');
  if (el) el.textContent = `v${version}`;
});

let agentRunning  = false;
let currentMode   = 'auto';       // 'auto' | 'ask_first'
let selectedTabId = null;
let attachedImage = null;         // base64 data URL
let currentSession = [];          // messaggi sessione corrente (per salvataggio)
let awaitingReply  = false;       // true quando l'agente ha fatto una domanda (ask_user)

// Modelli che supportano analisi immagini (vision/multimodal)
const VISION_MODELS = [
  'gpt-4o','gpt-4-turbo','gpt-4-vision','claude-3','claude-opus','claude-sonnet',
  'llama-3.2','llama3.2','gemma4','gemma3','gemma-3',
  'llama-3.2-90b-vision','llama-3.2-11b-vision',
  'llava','bakllava','moondream','minicpm-v','qwen-vl','qwen2-vl',
  'diggio-web','diggio-balanced','diggio-fast'
];

function isVisionModel(modelId = '') {
  return VISION_MODELS.some(vm => modelId.toLowerCase().startsWith(vm.toLowerCase()));
}

function updateVisionWarning() {
  const warn = $('visionWarning');
  if (!warn) return;
  const model = $('modelManual')?.value ?? $('modelSelect')?.value ?? '';
  if (attachedImage && !isVisionModel(model)) {
    warn.classList.remove('hidden');
  } else {
    warn.classList.add('hidden');
  }
}

// Preset endpoint per provider
const PROVIDER_PRESETS = {
  openai:       'https://api.openai.com/v1/chat/completions',
  anthropic:    'https://api.anthropic.com/v1/messages',
  groq:         'https://api.groq.com/openai/v1/chat/completions',
  openrouter:   'https://openrouter.ai/api/v1/chat/completions',
  perplexity:   'https://api.perplexity.ai/chat/completions',
  ollama:       'http://localhost:11434/v1/chat/completions',
  ollama_cloud: 'https://ollama.com/v1/chat/completions',
  lmstudio:     'http://localhost:1234/v1/chat/completions',
  custom:       ''
};

// ── Impostazioni ─────────────────────────────────────────────
$('btnSettings').addEventListener('click', () => {
  toggleDrawer('settingsPanel');
});

// Carica impostazioni salvate
chrome.storage.sync.get(['apiKey', 'model', 'apiEndpoint', 'provider', 'nativeTools'], ({ apiKey, model, apiEndpoint, provider, nativeTools }) => {
  if (apiKey)      $('apiKey').value      = apiKey;
  if (model)       $('modelManual').value = model;
  if (apiEndpoint) $('apiEndpoint').value = apiEndpoint;
  $('nativeToolsCheck').checked = nativeTools === true;
  if (provider)    $('providerSelect').value = provider;
  else             $('providerSelect').value = 'openai';
  // Se non c'è endpoint salvato, usa il preset del provider selezionato
  if (!apiEndpoint) {
    const prov = $('providerSelect').value;
    $('apiEndpoint').value = PROVIDER_PRESETS[prov] ?? '';
  }
});

// Cambio provider → aggiorna endpoint automaticamente
$('providerSelect').addEventListener('change', () => {
  const prov = $('providerSelect').value;
  $('apiEndpoint').value = PROVIDER_PRESETS[prov] ?? '';
});

// Aggiorna avviso vision quando cambia modello
$('modelManual').addEventListener('input', updateVisionWarning);

// Modelli predefiniti per provider che non hanno un endpoint /models
const PROVIDER_MODELS = {
  anthropic: [
    'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001',
    'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022',
    'claude-3-opus-20240229', 'claude-3-sonnet-20240229', 'claude-3-haiku-20240307'
  ],
  perplexity: [
    'sonar-pro', 'sonar', 'sonar-reasoning-pro', 'sonar-reasoning',
    'sonar-deep-research', 'r1-1776'
  ]
};

// Carica modelli disponibili dall'endpoint
$('btnLoadModels').addEventListener('click', async () => {
  const endpoint   = $('apiEndpoint').value.trim();
  const apiKey     = $('apiKey').value.trim();
  const provider   = $('providerSelect').value;
  const statusEl   = $('modelLoadStatus');
  const selectEl   = $('modelSelect');
  if (!endpoint) { statusEl.textContent = '❌ Inserisci prima l\'endpoint'; return; }

  // Provider con lista predefinita (nessun endpoint /models)
  if (PROVIDER_MODELS[provider]) {
    populateModelSelect(selectEl, PROVIDER_MODELS[provider]);
    statusEl.textContent = `✅ ${PROVIDER_MODELS[provider].length} modelli disponibili`;
    return;
  }

  // Ricava URL endpoint modelli (es: .../v1/chat/completions → .../v1/models)
  const modelsUrl = endpoint
    .replace(/\/chat\/completions\/?$/, '/models')
    .replace(/\/messages\/?$/, '/models');
  statusEl.textContent = '⏳ Caricamento modelli...';

  // Headers: Anthropic usa x-api-key, tutti gli altri Bearer
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    if (provider === 'anthropic') {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
  }

  try {
    const res = await fetch(modelsUrl, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const models = (json.data ?? json.models ?? [])
      .map(m => m.id ?? m)
      .filter(Boolean)
      .sort();
    if (models.length === 0) throw new Error('Nessun modello trovato');

    populateModelSelect(selectEl, models);
    statusEl.textContent = `✅ ${models.length} modelli caricati`;
  } catch (e) {
    statusEl.textContent = `❌ ${hintForFetchError(e, endpoint)}`;
  }
});

// Suggerimenti mirati per gli errori più comuni con endpoint locali
function hintForFetchError(e, endpoint) {
  const msg = e.message || String(e);
  const isLocal = endpoint.includes('localhost') || endpoint.includes('127.0.0.1');
  if (isLocal && endpoint.includes('11434')) {
    return `${msg} — Ollama è avviato? Se sì, riavvialo con la variabile OLLAMA_ORIGINS=chrome-extension://* (oppure "*") per consentire l'accesso all'estensione`;
  }
  if (isLocal && endpoint.includes('1234')) {
    return `${msg} — LM Studio è aperto con il server attivo? (Developer → Start Server, abilita CORS)`;
  }
  return msg;
}

function populateModelSelect(selectEl, models) {
  selectEl.innerHTML = models.map(m => `<option value="${esc(m)}">${esc(m)}</option>`).join('');
  selectEl.classList.remove('hidden');

  // Preseleziona il modello già salvato se presente
  const saved = $('modelManual').value;
  if (saved && models.includes(saved)) selectEl.value = saved;

  // Aggiorna modelManual quando si sceglie dal select (una sola volta)
  selectEl.onchange = () => {
    $('modelManual').value = selectEl.value;
    updateVisionWarning();
  };
}

$('btnSaveSettings').addEventListener('click', async () => {
  const apiKey      = $('apiKey').value.trim();
  const model       = $('modelManual').value.trim();
  const apiEndpoint = $('apiEndpoint').value.trim();
  const provider    = $('providerSelect').value;
  if (!apiKey)      { $('testResult').textContent = '❌ Inserisci la API Key!'; return; }
  if (!model)       { $('testResult').textContent = '❌ Inserisci il nome del modello!'; return; }
  if (!apiEndpoint) { $('testResult').textContent = '❌ Inserisci l\'endpoint API!'; return; }

  const nativeTools = $('nativeToolsCheck').checked;
  await chrome.storage.sync.set({ apiKey, model, apiEndpoint, provider, nativeTools });
  $('testResult').textContent = '⏳ Test in corso...';

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role:'user', content:'Reply with just the word OK.' }], stream: false }),
      signal: controller.signal
    });
    clearTimeout(tid);
    const json = await res.json();
    if (json.error) throw new Error(json.error.message ?? JSON.stringify(json.error));
    const reply = json.choices?.[0]?.message?.content ?? '';
    const cleaned = reply.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    $('testResult').textContent = cleaned
      ? `✅ ${model} — "${cleaned.substring(0, 40)}"`
      : '⚠️ Risposta vuota (il modello funziona ma non risponde a messaggi brevi)';
  } catch (e) {
    clearTimeout(tid);
    $('testResult').textContent = e.name === 'AbortError'
      ? '⏱️ Timeout — il modello è lento. Potrebbe comunque funzionare per task complessi.'
      : `❌ ${e.message}`;
  }
});

// ── Modalità ─────────────────────────────────────────────────
$('modeBtn').addEventListener('click', () => {
  currentMode = currentMode === 'auto' ? 'ask_first' : 'auto';
  const btn = $('modeBtn');
  if (currentMode === 'auto') {
    btn.textContent = '⚡ Auto';
    btn.className = 'mode-btn mode-auto';
  } else {
    btn.textContent = '🔔 Chiedi prima';
    btn.className = 'mode-btn mode-ask';
  }
});

// ── Schede ───────────────────────────────────────────────────
$('btnTabs').addEventListener('click', () => {
  toggleDrawer('tabsPanel');
  if (!$('tabsPanel').classList.contains('hidden')) loadTabs();
});

$('btnNewTab').addEventListener('click', () => {
  chrome.tabs.create({ url:'https://www.google.com', active:true });
  setTimeout(loadTabs, 1000);
});

$('btnClearTarget').addEventListener('click', () => {
  selectedTabId = null;
  $('targetTabBadge').classList.add('hidden');
  document.querySelectorAll('.tab-item').forEach(el => el.classList.remove('selected-tab'));
});

function loadTabs() { chrome.runtime.sendMessage({ type:'GET_TABS' }); }

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'TABS_LIST') renderTabs(msg.tabs);
});

function renderTabs(tabs) {
  const list = $('tabsList');
  list.innerHTML = '';
  tabs.forEach(tab => {
    const div = document.createElement('div');
    div.className = `tab-item${tab.active?' active-tab':''}${tab.id===selectedTabId?' selected-tab':''}`;
    const fav = document.createElement('img');
    fav.src = tab.favicon || '';
    fav.onerror = () => fav.style.display='none';
    const info = document.createElement('div');
    info.style.cssText = 'flex:1;overflow:hidden;';
    info.innerHTML = `<div class="tab-title">${esc(tab.title)}</div><div class="tab-url">${esc(tab.url)}</div>`;
    div.append(fav, info);
    div.addEventListener('click', () => {
      selectedTabId = tab.id;
      document.querySelectorAll('.tab-item').forEach(e => e.classList.remove('selected-tab'));
      div.classList.add('selected-tab');
      $('targetTabName').textContent = tab.title.substring(0,35);
      $('targetTabBadge').classList.remove('hidden');
      $('tabsPanel').classList.add('hidden');
    });
    list.appendChild(div);
  });
}

// ── Immagine allegata ─────────────────────────────────────────
$('btnAttach').addEventListener('click', () => $('fileInput').click());

$('fileInput').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    attachedImage = ev.target.result; // data URL base64
    $('attachedThumb').src = attachedImage;
    $('attachedImagePreview').classList.remove('hidden');
    updateVisionWarning();
  };
  reader.readAsDataURL(file);
  e.target.value = '';
});

$('btnRemoveImage').addEventListener('click', () => {
  attachedImage = null;
  $('attachedImagePreview').classList.add('hidden');
  $('attachedThumb').src = '';
  $('visionWarning').classList.add('hidden');
});

// ── Screenshot ────────────────────────────────────────────────
$('btnScreenshot').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type:'SCREENSHOT' });
});

// ── Nuova conversazione (pulisce chat + memoria dell'agente) ──
$('btnClearChat').addEventListener('click', () => {
  if (agentRunning) return;
  // Salva sessione corrente prima di cancellare (se non vuota)
  if (currentSession.length > 0) saveSession();
  $('messages').innerHTML = '';
  currentSession = [];
  attachedImage  = null;
  $('attachedImagePreview').classList.add('hidden');
  // Azzera anche la memoria persistente del worker
  chrome.runtime.sendMessage({ type: 'NEW_CONVERSATION' });
  addMessage('🆕 Nuova conversazione — chat e memoria dell\'agente azzerate', 'info');
});

// ── Cronologia ────────────────────────────────────────────────
$('btnHistory').addEventListener('click', () => {
  toggleDrawer('historyPanel');
  if (!$('historyPanel').classList.contains('hidden')) {
    $('historySearch').value = '';
    renderHistory();
  }
});

$('btnClearAllHistory').addEventListener('click', async () => {
  const keys = await getHistoryKeys();
  await chrome.storage.local.remove(keys);
  renderHistory();
});

// Ricerca live nella cronologia
$('historySearch').addEventListener('input', () => {
  renderHistory($('historySearch').value.trim().toLowerCase());
});

async function getHistoryKeys() {
  return new Promise(resolve => {
    chrome.storage.local.get(null, (items) => {
      resolve(Object.keys(items).filter(k => k.startsWith('session_')));
    });
  });
}

async function saveSession() {
  if (currentSession.length === 0) return;
  const key   = 'session_' + Date.now();
  const first = currentSession.find(m => m.type === 'user')?.text ?? 'Sessione';
  await chrome.storage.local.set({
    [key]: {
      title: first.substring(0,60),
      date:  new Date().toLocaleString('it-IT'),
      messages: currentSession.map(m => ({ type: m.type, text: m.text }))
    }
  });
}

async function renderHistory(filter = '') {
  const list = $('historyList');
  list.innerHTML = '';
  const keys = await getHistoryKeys();

  if (keys.length === 0) {
    list.innerHTML = '<div class="no-history">Nessuna chat salvata</div>';
    return;
  }

  const items = await new Promise(r => chrome.storage.local.get(keys, r));
  // Ordina per data decrescente
  keys.sort((a,b) => parseInt(b.split('_')[1]) - parseInt(a.split('_')[1]));

  // Filtra per testo se presente
  const filtered = filter
    ? keys.filter(key => {
        const s = items[key];
        return s.title?.toLowerCase().includes(filter) ||
               s.messages?.some(m => m.text?.toLowerCase().includes(filter));
      })
    : keys;

  if (filtered.length === 0) {
    list.innerHTML = '<div class="no-history">Nessun risultato</div>';
    return;
  }

  filtered.forEach(key => {
    const s = items[key];
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `
      <div class="h-title">${esc(s.title)}</div>
      <div class="h-date">${esc(s.date)}</div>
      <button class="h-del" data-key="${key}" title="Elimina">🗑</button>
    `;
    div.addEventListener('click', (e) => {
      if (e.target.classList.contains('h-del')) {
        e.stopPropagation();
        chrome.storage.local.remove(e.target.dataset.key, () =>
          renderHistory($('historySearch').value.trim().toLowerCase())
        );
        return;
      }
      restoreSession(s.messages);
      $('historyPanel').classList.add('hidden');
    });
    list.appendChild(div);
  });
}

function restoreSession(messages) {
  if (agentRunning) return;
  $('messages').innerHTML = '';
  currentSession = [];
  messages.forEach(m => addMessage(m.text, m.type));
  addMessage('📂 Sessione ripristinata (sola lettura)', 'info');
}

// ── Approvazione azione (modalità chiedi prima) ───────────────
$('btnApprove').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type:'APPROVE_ACTION' });
  $('approvalBar').classList.add('hidden');
});

$('btnSkip').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type:'SKIP_ACTION' });
  $('approvalBar').classList.add('hidden');
});

// ── Avvio agente ──────────────────────────────────────────────
$('btnStart').addEventListener('click', async () => {
  const task = $('taskInput').value.trim();
  if (!task) return;

  // Se l'agente ha fatto una domanda (ask_user), questo testo è la RISPOSTA
  if (awaitingReply) {
    addMessage(task, 'user');
    $('taskInput').value = '';
    setAwaitingReply(false);
    chrome.runtime.sendMessage({ type: 'USER_REPLY', text: task });
    return;
  }

  const { apiKey, model, apiEndpoint, nativeTools } = await chrome.storage.sync.get(['apiKey','model','apiEndpoint','nativeTools']);
  if (!apiKey) {
    addMessage('❌ Configura la API Key nelle impostazioni ⚙️', 'error');
    $('settingsPanel').classList.remove('hidden');
    return;
  }

  // Costruisci contesto dalla sessione corrente (messaggi rilevanti degli ultimi passi)
  let sessionContext = null;
  if (currentSession.length > 0) {
    const relevant = currentSession
      .filter(m => ['user','thought','action','result','done','error'].includes(m.type))
      .slice(-25);
    if (relevant.length > 0) {
      sessionContext = relevant
        .map(m => `[${m.type.toUpperCase()}] ${m.text.substring(0, 200)}`)
        .join('\n');
    }
  }

  addMessage(task, 'user');
  if (attachedImage) {
    const div = document.createElement('div');
    div.className = 'message user';
    const img = document.createElement('img');
    img.src = attachedImage;
    div.appendChild(img);
    $('messages').appendChild(div);
    scrollToBottom();
    currentSession.push({ type:'user', text:'[immagine allegata]' });
  }

  $('taskInput').value = '';
  setRunning(true);

  chrome.runtime.sendMessage({
    type:           'START_AGENT',
    task,
    apiKey,
    model:          model || 'gpt-4o-mini',
    endpoint:       apiEndpoint || null,
    nativeTools:    nativeTools === true,
    tabId:          selectedTabId,
    mode:           currentMode,
    imageData:      attachedImage,
    sessionContext
  });

  attachedImage = null;
  $('attachedImagePreview').classList.add('hidden');
});

$('btnStop').addEventListener('click', () => {
  chrome.runtime.sendMessage({ type:'STOP_AGENT' });
});

// ── Messaggi dal worker ───────────────────────────────────────
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'AGENT_UPDATE') return;

  if (msg.updateType === 'screenshot') {
    const div = document.createElement('div');
    div.className = 'message result';
    const img = document.createElement('img');
    img.src = `data:image/jpeg;base64,${msg.data}`;
    div.appendChild(img);
    $('messages').appendChild(div);
    currentSession.push({ type:'result', text:'[screenshot]' });
    scrollToBottom();
    return;
  }

  if (msg.updateType === 'approval_request') {
    $('approvalText').textContent = `⚡ ${msg.extra?.action}(${JSON.stringify(msg.extra?.params)})`;
    $('approvalBar').classList.remove('hidden');
  } else {
    $('approvalBar').classList.add('hidden');
  }

  addMessage(msg.text, msg.updateType);

  // L'agente ha fatto una domanda: sblocca l'input per la risposta
  if (msg.updateType === 'ask_user') {
    setAwaitingReply(true);
    return;
  }

  if (msg.updateType === 'save_report') {
    downloadReport(currentSession);
    return;
  }

  if (msg.updateType === 'done' || msg.text?.includes('Sessione terminata')) {
    setAwaitingReply(false);
    setRunning(false);
    saveSession();
  }
});

// Modalità "risposta all'agente": input abilitato anche mentre l'agente gira
function setAwaitingReply(active) {
  awaitingReply = active;
  const btn = $('btnStart');
  if (active) {
    btn.disabled    = false;
    btn.textContent = '↩ Rispondi';
    $('taskInput').placeholder = 'Scrivi la risposta per l\'agente...';
    $('taskInput').focus();
  } else {
    btn.textContent = '▶ Avvia';
    btn.disabled    = agentRunning;
    $('taskInput').placeholder = 'Descrivi cosa vuoi fare...';
  }
}

// ── Helpers ───────────────────────────────────────────────────

function renderText(raw) {
  let s = raw
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  // URL → link cliccabile
  s = s.replace(/(https?:\/\/[^\s&<>"]+)/g,
    '<a href="$1" target="_blank" rel="noopener" class="msg-link">$1</a>');
  // **bold**
  s = s.replace(/\*\*([^*\n]{1,100})\*\*/g, '<strong>$1</strong>');
  // *italic*
  s = s.replace(/(?<!\*)\*([^*\n]{1,100})\*(?!\*)/g, '<em>$1</em>');
  // Voci lista (- o •)
  s = s.replace(/^[-•]\s+(.+)$/gm, '<span class="li">▸ $1</span>');
  // Newline → <br>
  s = s.replace(/\n/g, '<br>');
  return s;
}

function addMessage(text, type = 'info') {
  const div = document.createElement('div');
  div.className = `message ${type}`;
  div.innerHTML = renderText(text);
  $('messages').appendChild(div);
  currentSession.push({ type, text });
  scrollToBottom();
}

function scrollToBottom() {
  const m = $('messages');
  m.scrollTop = m.scrollHeight;
}

function setRunning(running) {
  agentRunning = running;
  $('btnStart').disabled = running;
  $('btnStop').disabled  = !running;
}

function toggleDrawer(id) {
  const all = ['settingsPanel','tabsPanel','historyPanel','templatesPanel','toolsPanel','automationsPanel','guidePanel'];
  all.forEach(p => { if (p !== id) $(p).classList.add('hidden'); });
  $(id).classList.toggle('hidden');
}

// ── Guida ─────────────────────────────────────────────────────
$('btnGuide').addEventListener('click', () => {
  toggleDrawer('guidePanel');
});

function esc(str = '') {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Download Report HTML ──────────────────────────────────────
$('btnDownload').addEventListener('click', () => {
  if (currentSession.length === 0) {
    addMessage('⚠️ Nessuna chat da scaricare', 'info');
    return;
  }
  downloadReport(currentSession);
});

function downloadReport(messages) {
  const title = messages.find(m => m.type === 'user')?.text ?? 'Ricerca Diggio';
  const date  = new Date().toLocaleString('it-IT');

  const typeInfo = {
    user:     { icon: '👤', label: 'Utente',    cls: 'msg-user'    },
    thought:  { icon: '💭', label: 'Pensiero',  cls: 'msg-thought' },
    action:   { icon: '⚡', label: 'Azione',    cls: 'msg-action'  },
    result:   { icon: '📋', label: 'Risultato', cls: 'msg-result'  },
    done:     { icon: '✅', label: 'Completato',cls: 'msg-done'    },
    error:    { icon: '❌', label: 'Errore',    cls: 'msg-error'   },
    info:     { icon: 'ℹ️', label: 'Info',      cls: 'msg-info'    },
  };

  const rows = messages
    .filter(m => m.type !== 'thinking')
    .map(m => {
      const t = typeInfo[m.type] ?? { icon: '•', label: m.type, cls: '' };
      const html = renderText(m.text ?? '');
      return `
        <div class="msg ${t.cls}">
          <span class="badge">${t.icon} ${t.label}</span>
          <div class="content">${html}</div>
        </div>`;
    }).join('');

  const html = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<title>Report Diggio — ${esc(title.substring(0, 60))}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #0f0f1a; color: #e2e8f0; margin: 0; padding: 24px; }
  .header { background: linear-gradient(135deg,#6366f1,#818cf8);
            border-radius: 12px; padding: 20px 24px; margin-bottom: 24px; }
  .header h1 { margin: 0 0 4px; font-size: 1.3rem; color: #fff; }
  .header p  { margin: 0; font-size: 0.85rem; color: rgba(255,255,255,0.75); }
  .msg { background: #1e1e2e; border-radius: 10px; padding: 12px 16px;
         margin-bottom: 10px; border-left: 3px solid #444; }
  .msg-user    { border-color: #6366f1; background: #1e1b3a; }
  .msg-thought { border-color: #a78bfa; background: #1e1a2e; }
  .msg-action  { border-color: #38bdf8; background: #0f2033; }
  .msg-result  { border-color: #34d399; background: #0f2a1e; }
  .msg-done    { border-color: #4ade80; background: #0f2a18; }
  .msg-error   { border-color: #f87171; background: #2a0f0f; }
  .msg-info    { border-color: #94a3b8; }
  .badge { font-size: 0.72rem; font-weight: 700; text-transform: uppercase;
           letter-spacing: .05em; color: #94a3b8; display: block; margin-bottom: 6px; }
  .content { font-size: 0.9rem; line-height: 1.6; }
  .content a { color: #818cf8; }
  .content strong { color: #c4b5fd; }
  .content .li { display: block; margin: 2px 0 2px 12px; }
  .footer { text-align: center; margin-top: 32px; font-size: 0.75rem; color: #475569; }
</style>
</head>
<body>
  <div class="header">
    <h1>📄 Report Diggio Agent</h1>
    <p>${esc(title.substring(0, 100))} &nbsp;·&nbsp; ${date}</p>
  </div>
  ${rows}
  <div class="footer">Generato da Diggio Agent IA · ${date} · <a href="https://www.diggio3000.it" style="color:#818cf8">www.diggio3000.it</a></div>
</body>
</html>`;

  downloadBlob(html, 'text/html;charset=utf-8', 'diggio-report-' + Date.now() + '.html');
}

// ── Export CSV / JSON ─────────────────────────────────────────
$('btnExportCSV').addEventListener('click', () => {
  if (currentSession.length === 0) {
    addMessage('⚠️ Nessun dato da esportare', 'info');
    return;
  }
  showExportMenu();
});

function showExportMenu() {
  // Rimuovi menu già aperto (toggle)
  const existing = $('exportMenu');
  if (existing) { existing.remove(); return; }

  const menu = document.createElement('div');
  menu.id = 'exportMenu';
  menu.className = 'export-menu';
  menu.innerHTML = `
    <button class="export-opt" data-fmt="csv">📊 Esporta CSV</button>
    <button class="export-opt" data-fmt="json">{ } Esporta JSON</button>
  `;

  const btn = $('btnExportCSV');
  const rect = btn.getBoundingClientRect();
  menu.style.cssText = `position:fixed;bottom:${window.innerHeight - rect.top + 6}px;right:${window.innerWidth - rect.right}px;z-index:1000;`;
  document.body.appendChild(menu);

  menu.querySelectorAll('.export-opt').forEach(opt => {
    opt.addEventListener('click', () => {
      exportData(opt.dataset.fmt);
      menu.remove();
    });
  });

  // Chiudi cliccando fuori (timeout per evitare chiusura immediata)
  setTimeout(() => {
    document.addEventListener('click', function handler() {
      menu.remove();
      document.removeEventListener('click', handler);
    }, { once: true });
  }, 0);
}

function exportData(format) {
  const messages = currentSession.filter(m => !['thinking', 'info'].includes(m.type));

  if (format === 'json') {
    const json = JSON.stringify({
      exportDate: new Date().toISOString(),
      task: currentSession.find(m => m.type === 'user')?.text ?? '',
      session: messages
    }, null, 2);
    downloadBlob(json, 'application/json;charset=utf-8', 'diggio-export-' + Date.now() + '.json');
    return;
  }

  // CSV
  const rows = [['tipo', 'testo']];
  messages.forEach(m => {
    const text = (m.text || '').replace(/"/g, '""').replace(/\n/g, ' ');
    rows.push([m.type, `"${text}"`]);
  });
  const csv = '\uFEFF' + rows.map(r => r.join(',')).join('\n'); // BOM per Excel
  downloadBlob(csv, 'text/csv;charset=utf-8', 'diggio-export-' + Date.now() + '.csv');
}

function downloadBlob(content, mimeType, filename) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Riassunto pagina ──────────────────────────────────────────
$('btnSummary').addEventListener('click', () => {
  $('taskInput').value =
`Analizza e riassumi la pagina corrente:
1. Usa read_page() per leggere il contenuto completo
2. Scatta uno screenshot per vedere il layout visivo
3. Produci un riassunto strutturato con:
   - Titolo e scopo della pagina
   - Punti chiave (max 10 bullet point)
   - Informazioni importanti (prezzi, date, contatti se presenti)
   - Link e risorse principali trovati`;
  $('taskInput').focus();
});

// ── Traduci e analizza ────────────────────────────────────────
$('btnTranslate').addEventListener('click', () => {
  $('taskInput').value =
`Traduci e analizza la pagina corrente:
1. Usa read_page() per leggere il testo originale
2. Scatta uno screenshot per vedere il contesto visivo
3. Produci in italiano:
   - Traduzione fedele del contenuto principale
   - Riassunto dei punti chiave
   - Eventuali informazioni importanti (prezzi, date, contatti)
   - Note su elementi tecnici o culturali rilevanti`;
  $('taskInput').focus();
});

// ── Template Salvati ──────────────────────────────────────────
$('btnTemplates').addEventListener('click', () => {
  toggleDrawer('templatesPanel');
  if (!$('templatesPanel').classList.contains('hidden')) {
    $('templateSearchInput').value = '';
    renderTemplates();
  }
});

$('btnAddTemplate').addEventListener('click', async () => {
  const text = $('taskInput').value.trim();
  if (!text) {
    alert('Scrivi prima un prompt nella textarea, poi salvalo come template.');
    return;
  }
  const title = prompt('Nome per questo template:', text.substring(0, 50));
  if (!title) return;
  const templates = await loadTemplates();
  templates.push({ id: Date.now(), title, text });
  await chrome.storage.local.set({ templates });
  renderTemplates();
});

$('templateSearchInput').addEventListener('input', () => {
  renderTemplates($('templateSearchInput').value.trim().toLowerCase());
});

async function loadTemplates() {
  return new Promise(r => chrome.storage.local.get('templates', d => r(d.templates || [])));
}

async function renderTemplates(filter = '') {
  const list = $('templateList');
  list.innerHTML = '';
  const templates = await loadTemplates();
  const filtered = filter
    ? templates.filter(t =>
        t.title.toLowerCase().includes(filter) || t.text.toLowerCase().includes(filter)
      )
    : templates;

  if (filtered.length === 0) {
    list.innerHTML = `<div class="no-history">${filter ? 'Nessun risultato' : 'Nessun template salvato'}</div>`;
    return;
  }

  filtered.forEach(t => {
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `
      <div class="h-title">${esc(t.title)}</div>
      <button class="h-del" data-id="${t.id}" title="Elimina">🗑</button>
    `;
    div.addEventListener('click', async (e) => {
      if (e.target.classList.contains('h-del')) {
        e.stopPropagation();
        const all = await loadTemplates();
        const updated = all.filter(x => x.id !== parseInt(e.target.dataset.id));
        await chrome.storage.local.set({ templates: updated });
        renderTemplates($('templateSearchInput').value.trim().toLowerCase());
        return;
      }
      $('taskInput').value = t.text;
      $('templatesPanel').classList.add('hidden');
      $('taskInput').focus();
    });
    list.appendChild(div);
  });
}

// ── Strumenti (tools panel) ───────────────────────────────────
$('btnTools').addEventListener('click', () => {
  toggleDrawer('toolsPanel');
  if (!$('toolsPanel').classList.contains('hidden')) {
    loadFormFillerData();
    renderSiteKnowledge();
  }
});

// — Memoria Siti (apprendimento) —
async function renderSiteKnowledge() {
  const list = $('siteKnowledgeList');
  if (!list) return;
  let knowledge = {};
  try {
    const res = await chrome.runtime.sendMessage({ type: 'GET_SITE_KNOWLEDGE' });
    knowledge = res?.knowledge ?? {};
  } catch {}
  const domains = Object.keys(knowledge).sort();
  list.innerHTML = '';
  if (domains.length === 0) {
    list.innerHTML = '<div class="no-history">Nessun appunto ancora — l\'agente impara mentre naviga</div>';
    return;
  }
  domains.forEach(d => {
    const entry = knowledge[d];
    const notes = entry?.notes ?? [];
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `
      <div class="h-title">🌐 ${esc(d)} <span style="color:#94a3b8;font-weight:400">(${notes.length} appunt${notes.length === 1 ? 'o' : 'i'})</span></div>
      <div class="h-date" style="white-space:pre-line">${esc(notes.map(n => '• ' + n).join('\n'))}</div>
      <button class="h-del" title="Dimentica questo sito">🗑</button>
    `;
    div.querySelector('.h-del').addEventListener('click', async (e) => {
      e.stopPropagation();
      await chrome.runtime.sendMessage({ type: 'DELETE_SITE_KNOWLEDGE', domain: d });
      renderSiteKnowledge();
    });
    list.appendChild(div);
  });
}

$('btnClearKnowledge').addEventListener('click', async () => {
  if (!confirm('Dimenticare tutti gli appunti appresi su tutti i siti?')) return;
  await chrome.runtime.sendMessage({ type: 'DELETE_SITE_KNOWLEDGE' });
  renderSiteKnowledge();
});

// — Scraper Prezzi —
$('scraperLoop').addEventListener('change', () => {
  $('scraperCondition').classList.toggle('tool-input-hidden', !$('scraperLoop').checked);
});

$('btnScraperGenera').addEventListener('click', () => {
  const url    = $('scraperUrl').value.trim();
  const target = $('scraperTarget').value.trim();
  if (!url || !target) { alert('Inserisci URL e cosa estrarre.'); return; }

  const loop      = $('scraperLoop').checked;
  const condition = $('scraperCondition').value.trim();

  let prompt = `Vai su: ${url}\n\nAnalizza la pagina e trova: ${target}\n`;

  if (loop) {
    prompt += `
Modalità LOOP — monitoraggio attivo:
- Leggi il valore attuale e registralo
- Scatta uno screenshot iniziale
- Ricarica la pagina (usa navigate() sullo stesso URL) e confronta il nuovo valore con quello precedente
- Continua a monitorare finché non si verifica questa condizione: ${condition || 'il valore cambia'}
- Ad ogni variazione rilevata, segnalala con screenshot e valore aggiornato`;
  } else {
    prompt += `
- Leggi il valore esatto con read_page()
- Scatta uno screenshot della sezione rilevante
- Riportami il risultato in modo chiaro con valore, data rilevazione e link diretto`;
  }

  $('taskInput').value = prompt;
  toggleDrawer('toolsPanel');
  $('taskInput').focus();
});

// — Confronto Prodotti —
$('btnConfrontoGenera').addEventListener('click', () => {
  const urls = [
    $('confrontoUrl1').value.trim(),
    $('confrontoUrl2').value.trim(),
    $('confrontoUrl3').value.trim(),
  ].filter(Boolean);

  if (urls.length < 2) { alert('Inserisci almeno 2 URL da confrontare.'); return; }

  const urlList = urls.map((u, i) => `${i + 1}. ${u}`).join('\n');
  const prompt =
`Confronta questi prodotti visitandoli in sequenza:
${urlList}

Per ogni prodotto:
- Vai sull'URL e leggi nome completo, prezzo, disponibilità, caratteristiche principali
- Scatta uno screenshot del prodotto
- Usa read_page() per raccogliere tutti i dati

Alla fine genera:
- Tabella comparativa con nome, prezzo, disponibilità, punti di forza e debolezze
- Consiglio finale su quale acquistare e perché
- Link diretto a ogni prodotto

Usa open_tabs per aprire i prodotti in schede separate se necessario.`;

  $('taskInput').value = prompt;
  toggleDrawer('toolsPanel');
  $('taskInput').focus();
});

// — Form Filler —
async function loadFormFillerData() {
  const data = await new Promise(r =>
    chrome.storage.local.get('formFillerData', d => r(d.formFillerData || ''))
  );
  $('formFillerData').value = data;
}

$('btnFormFillerSave').addEventListener('click', async () => {
  const data = $('formFillerData').value.trim();
  await chrome.storage.local.set({ formFillerData: data });
  const btn = $('btnFormFillerSave');
  btn.textContent = '✅ Salvato!';
  setTimeout(() => { btn.textContent = '💾 Salva'; }, 1500);
});

$('btnFormFillerGenera').addEventListener('click', async () => {
  let data = $('formFillerData').value.trim();
  if (!data) {
    data = await new Promise(r =>
      chrome.storage.local.get('formFillerData', d => r(d.formFillerData || ''))
    );
  }
  if (!data) { alert('Inserisci i dati da usare per compilare i form.'); return; }

  const prompt =
`Compila il form sulla pagina corrente usando questi dati:
${data}

Istruzioni:
- Analizza la pagina con read_page() per identificare tutti i campi del form
- Abbina ogni campo ai dati forniti (nome, email, telefono, indirizzo, ecc.)
- Compila tutti i campi trovati usando type() e select_option()
- Scatta uno screenshot dopo aver compilato per mostrare il risultato
- NON inviare il form — fermati prima del submit e aspetta conferma`;

  $('taskInput').value = prompt;
  toggleDrawer('toolsPanel');
  $('taskInput').focus();
});

// — Analisi SEO —
$('btnSeoGenera').addEventListener('click', () => {
  const url = $('seoUrl').value.trim();
  if (!url) { alert('Inserisci l\'URL del sito da analizzare.'); return; }

  const checks = Array.from(document.querySelectorAll('.seo-cb:checked')).map(cb => cb.value);

  const checkMap = {
    meta:     'meta title, meta description (lunghezza e presenza), canonical URL, og:title/og:description, twitter card, lang dell\'html',
    headings: 'struttura heading H1-H6: presenza H1 unico, gerarchia corretta, testi significativi, keyword stuffing',
    links:    'link interni (con anchor text), link esterni (follow/nofollow), link rotti (errori 404), link con target=_blank senza rel=noopener',
    images:   'tutte le immagini: verifica alt text mancante o vuoto, dimensioni enormi non ottimizzate, lazy loading assente',
    robots:   'carica /robots.txt e /sitemap.xml: verifica presenza, direttive Disallow, sitemap correttamente dichiarata',
    speed:    'dimensione HTML, numero di script/CSS bloccanti, uso di webfonts esterni, script in <head> senza async/defer',
    mobile:   'meta viewport presente e corretto, testi leggibili senza zoom, elementi cliccabili abbastanza grandi, larghezza contenuto',
    schema:   'cerca JSON-LD o microdati: tipo di schema (Article, Product, Organization, BreadcrumbList, FAQPage), validità struttura'
  };

  const tasks = checks.map(c => `- ${checkMap[c] ?? c}`).join('\n');

  const prompt =
`Esegui un'analisi SEO completa di: ${url}

STEP 1 — Vai sul sito principale:
- navigate("${url}")
- read_page() per il contenuto e i link
- execute_js con questo codice per estrarre i meta tag:
  document.querySelector('title')?.textContent + ' | ' + document.querySelector('meta[name=description]')?.content + ' | canonical: ' + document.querySelector('link[rel=canonical]')?.href

STEP 2 — Controlla robots.txt e sitemap:
- navigate("${url.replace(/\/$/, '')}/robots.txt") e leggi il contenuto
- navigate("${url.replace(/\/$/, '')}/sitemap.xml") e verifica presenza

STEP 3 — Analisi approfondita con execute_js sulla pagina principale:
Torna su ${url} e usa execute_js per estrarre:
- Tutti gli H1-H6 con testi
- Tutte le immagini senza alt o con alt vuoto
- Tutti i link con anchor text e href
- Script con src esterni (potenzialmente bloccanti)
- Meta viewport, og:*, twitter:*, JSON-LD schema

STEP 4 — DIAGNOSTICA TECNICA (console e rete):
- read_console() → errori JavaScript e warning della pagina
- read_network() → script esterni caricati (quali tecnologie/tracker usa il sito) e risorse che falliscono (404/500)
Nota: console e rete si registrano da quando sei connesso — hai già navigato quindi i dati ci sono.

STEP 5 — Genera il report finale con queste sezioni:
${tasks}

Per ogni punto indica: ✅ OK / ⚠️ Da migliorare / ❌ Problema critico
Concludi con un punteggio SEO stimato (0-100) e le 5 azioni prioritarie da fare subito.
Scatta screenshot della homepage e del report finale.`;

  $('taskInput').value = prompt;
  toggleDrawer('toolsPanel');
  $('taskInput').focus();
});

// — Analisi Google Ads —
$('btnAdsGenera').addEventListener('click', () => {
  const scope = $('adsScope').value;
  const fix   = $('adsFix').checked;

  const scopeSteps = {
    campaigns: `STEP — CAMPAGNE:
- navigate("https://ads.google.com/aw/campaigns") → wait(4) → screenshot
- Estrai la tabella campagne con execute_js (righe con nome, stato, budget, impressioni, click, CTR, CPC, conversioni, costo)
- Segnala: campagne "Limitata dal budget", CTR sotto media, costo/conversione alto`,
    keywords: `STEP — PAROLE CHIAVE:
- Naviga nella sezione "Parole chiave" → wait(4) → screenshot
- Estrai keyword con punteggio di qualità e CPC usando execute_js
- Poi apri "Termini di ricerca" e individua query irrilevanti che consumano budget
- Proponi le parole chiave negative da aggiungere`,
    ads: `STEP — ANNUNCI:
- Naviga nella sezione "Annunci" → wait(4) → screenshot
- Verifica stato di ogni annuncio: attivo, in verifica, rifiutato (e motivo)
- Controlla efficacia annuncio ("Scarsa", "Media", "Ottima") dove visibile`,
    full: `STEP 1 — PANORAMICA: navigate("https://ads.google.com/aw/overview") → wait(4) → screenshot
STEP 2 — CAMPAGNE: navigate("https://ads.google.com/aw/campaigns") → wait(4) → estrai la tabella con execute_js
  (nome, stato, budget/giorno, impressioni, click, CTR, CPC medio, conversioni, costo)
STEP 3 — PAROLE CHIAVE: sezione "Parole chiave" → punteggio di qualità e CPC per keyword
STEP 4 — TERMINI DI RICERCA: individua query irrilevanti che consumano budget
STEP 5 — ANNUNCI: stato, annunci rifiutati e motivo`
  };

  const fixPart = fix ? `

DOPO L'ANALISI — CORREZIONI (una alla volta):
Per ogni problema trovato, in ordine di impatto:
1. Spiega con ask_user() la correzione proposta (cosa, dove, impatto atteso) e chiedi conferma
2. Se confermo: applica la modifica e scatta screenshot di verifica
3. Se rifiuto: passa alla correzione successiva
Correzioni tipiche: aggiungere parole chiave negative, mettere in pausa keyword con quality score
molto basso, segnalare campagne con budget da rivedere (NON cambiare mai i budget senza il mio ok esplicito).` : `

NON applicare nessuna modifica — solo analisi e suggerimenti.`;

  const prompt =
`Analizza il mio account Google Ads (sono già loggato su ads.google.com).
⚠️ L'interfaccia è una SPA lenta: dopo ogni navigazione usa wait(4) prima di leggere.

${scopeSteps[scope] ?? scopeSteps.full}

REPORT FINALE:
- 📊 Tabella riassuntiva per campagna: stato, budget, CTR, CPC, conversioni, costo
- ⚠️ Problemi trovati in ordine di impatto economico
- 💡 Per ogni problema: suggerimento concreto e impatto stimato
- 🏆 Le 3 azioni prioritarie da fare subito${fixPart}`;

  $('taskInput').value = prompt;
  toggleDrawer('toolsPanel');
  $('taskInput').focus();
});

// — Controllo Sicurezza Sito —
$('btnSecGenera').addEventListener('click', () => {
  const url = $('secUrl').value.trim();
  if (!url) { alert('Inserisci l\'URL del sito da controllare.'); return; }

  const checks = Array.from(document.querySelectorAll('.sec-cb:checked')).map(cb => cb.value);
  const domain = (() => { try { return new URL(url).hostname; } catch { return url; } })();

  const steps = [];

  if (checks.includes('virustotal')) {
    steps.push(`STEP VIRUSTOTAL:
- navigate("https://www.virustotal.com/gui/domain/${domain}")
- Attendi caricamento completo (puoi usare wait(3))
- read_page() e screenshot per leggere il punteggio (es: "X engines detected this")
- Annota: numero di engine che segnalano minacce, categorie rilevate, data ultimo scan`);
  }

  if (checks.includes('safebrowsing')) {
    steps.push(`STEP GOOGLE SAFE BROWSING:
- navigate("https://transparencyreport.google.com/safe-browsing/search?url=${encodeURIComponent(url)}")
- wait(3) e screenshot
- Leggi lo stato: sito sicuro o segnalato come pericoloso`);
  }

  if (checks.includes('urlhaus')) {
    steps.push(`STEP URLHAUS / ABUSE.CH:
- navigate("https://urlhaus.abuse.ch/browse.php?search=${encodeURIComponent(domain)}")
- read_page() e screenshot
- Verifica se il dominio appare nella lista di URL malevoli`);
  }

  if (checks.includes('ssl')) {
    steps.push(`STEP CERTIFICATO SSL:
- navigate("https://www.ssllabs.com/ssltest/analyze.html?d=${domain}&hideResults=on")
- wait(5) e screenshot — attendi che il test inizi
- Poi navigate("https://crt.sh/?q=${domain}") e leggi i certificati emessi per il dominio`);
  }

  if (checks.includes('headers')) {
    steps.push(`STEP HEADER DI SICUREZZA:
- navigate("https://securityheaders.com/?q=${encodeURIComponent(url)}&followRedirects=on")
- wait(3) e screenshot
- Leggi il punteggio e i header mancanti (Content-Security-Policy, HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)`);
  }

  if (checks.includes('source')) {
    steps.push(`STEP SCANSIONE CODICE SORGENTE:
- navigate("${url}")
- Usa execute_js con questo codice per estrarre e analizzare il sorgente:

(function() {
  const results = [];
  const html = document.documentElement.outerHTML;
  const scripts = Array.from(document.querySelectorAll('script'));
  const iframes = Array.from(document.querySelectorAll('iframe'));

  // 1. Script esterni sospetti
  scripts.forEach(s => {
    if (s.src) {
      const suspicious = /pastebin|raw\\.github|cdn77|ucoz|webs\\.com|000webhost|bit\\.ly|tinyurl|t\\.co/i.test(s.src);
      if (suspicious) results.push('⚠️ Script esterno sospetto: ' + s.src);
    }
  });

  // 2. Codice ofuscato: eval+atob, eval+unescape
  if (/eval\\s*\\(\\s*atob/i.test(html))    results.push('❌ CRITICO: eval(atob(...)) — codice ofuscato in base64');
  if (/eval\\s*\\(\\s*unescape/i.test(html)) results.push('❌ CRITICO: eval(unescape(...)) — codice ofuscato');
  if (/eval\\s*\\(\\s*String\\.fromCharCode/i.test(html)) results.push('❌ CRITICO: eval(String.fromCharCode) — iniezione tramite charcode');
  if (/document\\.write\\s*\\(\\s*unescape/i.test(html)) results.push('❌ CRITICO: document.write(unescape) — iniezione ofuscata');

  // 3. Iframe nascosti
  iframes.forEach(fr => {
    const s = fr.style;
    if (s.display === 'none' || s.visibility === 'hidden' ||
        parseInt(fr.width) === 0 || parseInt(fr.height) === 0 ||
        fr.getAttribute('width') === '0' || fr.getAttribute('height') === '0') {
      results.push('⚠️ Iframe nascosto rilevato: src=' + (fr.src || 'nessun src'));
    }
  });

  // 4. Crypto miner
  if (/coinhive|cryptonight|minero|coin-hive|webmr\\.js|deepMiner/i.test(html))
    results.push('❌ CRITICO: possibile crypto miner rilevato nel codice');

  // 5. Keylogger pattern
  if (/addEventListener\\s*\\(\\s*["\\'"]keydown["\\'"]/i.test(html))
    results.push('⚠️ addEventListener keydown trovato — possibile keylogger (verifica manuale)');

  // 6. Redirect sospetti
  if (/window\\.location\\s*=\\s*atob/i.test(html))
    results.push('❌ CRITICO: redirect tramite base64 decodificato');

  // 7. Raccolta dati sospetta verso domini esterni
  const fetchMatches = html.match(/fetch\\s*\\(["\\'"][^"\\'"]+["\\'"]/g) || [];
  const xhrMatches   = html.match(/XMLHttpRequest[^;]+open\\s*\\([^)]+\\)/g) || [];
  [...fetchMatches, ...xhrMatches].forEach(m => {
    if (!/\\.${domain.replace('.', '\\\\.')}/i.test(m) && !/localhost/i.test(m))
      results.push('⚠️ Richiesta HTTP a dominio esterno: ' + m.substring(0, 100));
  });

  // 8. Base64 lunghi sospetti (payload nascosti)
  const b64matches = html.match(/[A-Za-z0-9+\\/]{200,}={0,2}/g) || [];
  if (b64matches.length > 0)
    results.push('⚠️ ' + b64matches.length + ' stringhe base64 lunghe trovate nel sorgente — possibili payload nascosti');

  return results.length > 0
    ? 'PROBLEMI TROVATI:\\n' + results.join('\\n')
    : '✅ Nessun pattern malevolo evidente nel sorgente';
})()

- Leggi e riporta l'output completo di execute_js
- Scatta screenshot del sito per documentazione visiva
- Controlla anche le schede Network per risorse caricate da domini sospetti usando read_page() sulla pagina principale`);
  }

  const prompt =
`Esegui un controllo di sicurezza completo per: ${url}
(Dominio: ${domain})

${steps.join('\n\n')}

REPORT FINALE:
Genera un report strutturato con:
- Punteggio sicurezza complessivo (0-10)
- ✅ / ⚠️ / ❌ per ogni controllo eseguito
- Elenco di tutte le minacce o anomalie trovate
- Raccomandazioni immediate per il proprietario del sito
- Verdetto finale: SICURO / SOSPETTO / PERICOLOSO`;

  $('taskInput').value = prompt;
  toggleDrawer('toolsPanel');
  $('taskInput').focus();
});

// — Verifica Sito Truffa —
$('btnScamGenera').addEventListener('click', () => {
  const url  = $('scamUrl').value.trim();
  const deep = $('scamDeep').checked;
  if (!url) { alert('Inserisci l\'URL del sito da verificare.'); return; }

  const domain = (() => { try { return new URL(url).hostname; } catch { return url; } })();

  const deepSteps = deep ? `
STEP REPUTAZIONE ESTERNA (cerca conferme indipendenti):
- navigate("https://www.google.com/search?q=${encodeURIComponent('"' + domain + '" truffa OR recensioni OR opinioni OR scam OR fake')}")
- read_page() per leggere i primi risultati di ricerca
- navigate("https://www.trustpilot.com/review/${domain}") e leggi le recensioni (se presenti)
- navigate("https://web.archive.org/web/*/${domain}") per verificare da quando esiste il sito
- Se trovi forum/blog con segnalazioni, annota le URL` : '';

  const prompt =
`Verifica se questo sito è legittimo o una possibile truffa: ${url}

STEP 1 — Analisi visiva e contenuto:
- navigate("${url}")
- read_page() e screenshot
- Analizza i seguenti 15 indicatori di truffa:

INDICATORI DA VERIFICARE (segna ✅ OK / ⚠️ Sospetto / ❌ Red flag):

1. PREZZI: I prezzi sono realistici o troppo bassi per essere veri? (es: iPhone a 50€)
2. CONTATTI: C'è un indirizzo fisico reale, numero di telefono, email aziendale?
3. DATI LEGALI: P.IVA o codice fiscale presente? Ragione sociale chiara?
4. HTTPS: Il sito usa HTTPS con certificato valido?
5. GRAMMATICA: Testo scritto in italiano corretto o pieno di errori e traduzioni automatiche?
6. POLICY: Privacy policy e termini di servizio presenti e leggibili?
7. PAGAMENTI: Accetta solo metodi non tracciabili (crypto, bonifico) o anche PayPal/carte?
8. DOMINIO: Il dominio è recente (< 1 anno)? Ha un nome simile a brand famosi (typosquatting)?
9. DESIGN: Sito copiato o clone di un altro sito legittimo? Loghi fuori posto?
10. SOCIAL PROOF: Recensioni presenti? Sembrano false (tutte 5 stelle, testi generici)?
11. RESI E GARANZIE: Politica di reso chiara con tempi e modalità?
12. STOCK: Tutti i prodotti sempre "disponibili" anche rari o fuori produzione?
13. URGENZA ARTIFICIALE: Timer conto alla rovescia, "Solo 2 rimasti!", pressione all'acquisto?
14. IMMAGINI: Immagini rubate da altri siti o con watermark? Immagini stock generiche?
15. ABOUT US: Pagina "Chi siamo" presente con storia reale dell'azienda?
${deepSteps}

STEP 2 — Controllo WHOIS:
- navigate("https://who.is/whois/${domain}")
- Leggi: data registrazione, registrar, paese, privacy shield attivo

REPORT FINALE:
- Punteggio affidabilità (0-10)
- Elenco dei red flag trovati con spiegazione
- Verdetto: LEGITTIMO ✅ / SOSPETTO ⚠️ / PROBABILE TRUFFA ❌
- Consigli all'utente (acquistare o evitare? usare protezioni aggiuntive?)`;

  $('taskInput').value = prompt;
  toggleDrawer('toolsPanel');
  $('taskInput').focus();
});

// — Ricerca Google —
$('btnGoogleGenera').addEventListener('click', () => {
  const query     = $('googleQuery').value.trim();
  const linksOnly = $('googleLinksOnly').checked;
  if (!query) { alert('Inserisci una query di ricerca.'); return; }

  let prompt;
  if (linksOnly) {
    prompt =
`Vai su https://www.google.com e cerca: "${query}"
Usa read_page() per estrarre tutti i link dei risultati organici (ignora pubblicità e box Google).
Restituisci una lista ordinata con: numero, titolo, URL e descrizione breve per ogni risultato.
Non aprire i singoli link.`;
  } else {
    prompt =
`Vai su https://www.google.com e cerca: "${query}"
Usa read_page() per vedere i risultati, poi apri i primi 3-5 risultati organici più pertinenti.
Per ogni pagina: usa read_page() per leggere il contenuto rilevante e scatta uno screenshot.
Alla fine sintetizza le informazioni trovate in un report completo con fonti e link diretti.`;
  }

  $('taskInput').value = prompt;
  toggleDrawer('toolsPanel');
  $('taskInput').focus();
});

// ══════════════════════════════════════════════════════════════
// AUTOMAZIONI
// ══════════════════════════════════════════════════════════════

// Apri pannello
$('btnAutomations').addEventListener('click', () => {
  toggleDrawer('automationsPanel');
  if (!$('automationsPanel').classList.contains('hidden')) {
    $('autoForm').classList.add('hidden');
    renderAutomations();
  }
});

// Toggle tra sezioni orario/intervallo
$('radioInterval').addEventListener('change', () => {
  $('schedInterval').classList.remove('hidden');
  $('schedDaily').classList.add('hidden');
});
$('radioDaily').addEventListener('change', () => {
  $('schedInterval').classList.add('hidden');
  $('schedDaily').classList.remove('hidden');
});

// Pulsante "Nuova automazione"
$('btnNewAuto').addEventListener('click', () => {
  openAutoForm(null);
});

// Annulla form
$('btnAutoCancel').addEventListener('click', () => {
  $('autoForm').classList.add('hidden');
  $('autoList').classList.remove('hidden');
});

// Salva automazione
$('btnAutoSave').addEventListener('click', async () => {
  const name = $('autoName').value.trim();
  const task = $('autoTask').value.trim();
  if (!name) { alert('Inserisci un nome per l\'automazione.'); return; }
  if (!task) { alert('Inserisci il task da eseguire.'); return; }

  const schedType = document.querySelector('input[name="schedType"]:checked').value;
  const intervalVal  = parseInt($('autoIntervalVal').value) || 1;
  const intervalUnit = parseInt($('autoIntervalUnit').value) || 60;
  const intervalMinutes = intervalVal * intervalUnit;

  const days = Array.from(document.querySelectorAll('.day-cb:checked')).map(cb => parseInt(cb.value));

  const idVal = $('autoId').value;
  const automation = {
    id:              idVal ? parseInt(idVal) : Date.now(),
    name,
    task,
    scheduleType:    schedType,
    intervalMinutes: schedType === 'interval' ? intervalMinutes : null,
    time:            schedType === 'daily' ? $('autoTime').value : null,
    days:            schedType === 'daily' ? days : [],
    stopCondition:   $('autoStop').value.trim(),
    maxRuns:         parseInt($('autoMaxRuns').value) || 0,
    runsCount:       0,
    active:          true,
    lastRun:         null,
    lastResult:      null,
    nextRun:         null,
    model:           $('autoModel').value
  };

  // Mantieni runsCount se è una modifica
  if (idVal) {
    const existing = await getAutoById(parseInt(idVal));
    if (existing) automation.runsCount = existing.runsCount || 0;
  }

  await chrome.runtime.sendMessage({ type: 'SAVE_AUTOMATION', automation });
  $('autoForm').classList.add('hidden');
  $('autoList').classList.remove('hidden');
  renderAutomations();
});

// Ascolta aggiornamenti dal worker (automazione appena terminata)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'AUTOMATION_UPDATED') {
    if (!$('automationsPanel').classList.contains('hidden')) renderAutomations();
  }
});

function openAutoForm(auto) {
  $('autoId').value    = auto ? auto.id : '';
  $('autoName').value  = auto ? auto.name : '';
  $('autoTask').value  = auto ? auto.task : '';
  $('autoStop').value  = auto ? (auto.stopCondition || '') : '';
  $('autoMaxRuns').value = auto ? (auto.maxRuns || 0) : 0;
  $('autoModel').value = auto ? (auto.model || '') : '';
  $('autoFormTitle').textContent = auto ? 'Modifica Automazione' : 'Nuova Automazione';

  if (auto?.scheduleType === 'daily') {
    $('radioDaily').checked    = true;
    $('radioInterval').checked = false;
    $('schedInterval').classList.add('hidden');
    $('schedDaily').classList.remove('hidden');
    $('autoTime').value = auto.time || '09:00';
    document.querySelectorAll('.day-cb').forEach(cb => {
      cb.checked = (auto.days || []).map(Number).includes(parseInt(cb.value));
    });
  } else {
    $('radioInterval').checked = true;
    $('radioDaily').checked    = false;
    $('schedInterval').classList.remove('hidden');
    $('schedDaily').classList.add('hidden');
    if (auto?.intervalMinutes) {
      // Cerca unità migliore
      if (auto.intervalMinutes % 1440 === 0) {
        $('autoIntervalVal').value  = auto.intervalMinutes / 1440;
        $('autoIntervalUnit').value = '1440';
      } else if (auto.intervalMinutes % 60 === 0) {
        $('autoIntervalVal').value  = auto.intervalMinutes / 60;
        $('autoIntervalUnit').value = '60';
      } else {
        $('autoIntervalVal').value  = auto.intervalMinutes;
        $('autoIntervalUnit').value = '1';
      }
    } else {
      $('autoIntervalVal').value  = 1;
      $('autoIntervalUnit').value = '60';
    }
  }

  $('autoList').classList.add('hidden');
  $('autoForm').classList.remove('hidden');
}

async function getAutoById(id) {
  return new Promise(r => chrome.storage.local.get('automations', d => {
    r((d.automations || []).find(a => a.id === id) || null);
  }));
}

async function renderAutomations() {
  const list = $('autoList');
  list.innerHTML = '';
  const automations = await new Promise(r =>
    chrome.storage.local.get('automations', d => r(d.automations || []))
  );

  if (automations.length === 0) {
    list.innerHTML = '<div class="no-history">Nessuna automazione. Creane una con + Nuova.</div>';
    return;
  }

  automations.forEach(a => {
    const card = document.createElement('div');
    card.className = `auto-item${a.active ? '' : ' auto-paused'}`;

    const schedLabel = a.scheduleType === 'interval'
      ? formatInterval(a.intervalMinutes)
      : `${a.time} (${formatDays(a.days)})`;

    const lastRun  = a.lastRun  ? new Date(a.lastRun).toLocaleString('it-IT')  : '—';
    const nextRun  = a.nextRun  ? new Date(a.nextRun).toLocaleString('it-IT')  : '—';
    const runs     = a.maxRuns > 0 ? `${a.runsCount || 0}/${a.maxRuns}` : (a.runsCount || 0);

    card.innerHTML = `
      <div class="auto-item-header">
        <span class="auto-name">${esc(a.name)}</span>
        <span class="auto-badge ${a.active ? 'badge-active' : 'badge-paused'}">${a.active ? '▶ Attiva' : '⏸ In pausa'}</span>
      </div>
      <div class="auto-meta">🕐 ${schedLabel} &nbsp;·&nbsp; Esecuzioni: ${runs}</div>
      <div class="auto-meta">Ultimo run: ${lastRun}</div>
      <div class="auto-meta">Prossimo: ${nextRun}</div>
      ${a.lastResult && a.lastResult !== 'In esecuzione...' ? `<div class="auto-result">${esc(a.lastResult.substring(0,120))}</div>` : ''}
      <div class="auto-actions">
        <button class="btn-secondary btn-sm auto-btn-toggle" data-id="${a.id}" data-active="${a.active}">${a.active ? '⏸ Pausa' : '▶ Riprendi'}</button>
        <button class="btn-secondary btn-sm auto-btn-run"    data-id="${a.id}">⚡ Esegui ora</button>
        <button class="btn-secondary btn-sm auto-btn-edit"   data-id="${a.id}">✏️ Modifica</button>
        <button class="btn-danger    btn-sm auto-btn-del"    data-id="${a.id}">🗑</button>
      </div>
    `;
    list.appendChild(card);
  });

  // Event listeners sui bottoni delle card
  list.querySelectorAll('.auto-btn-toggle').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id     = parseInt(btn.dataset.id);
      const active = btn.dataset.active === 'true';
      await chrome.runtime.sendMessage({ type: 'TOGGLE_AUTOMATION', id, active: !active });
      renderAutomations();
    });
  });
  list.querySelectorAll('.auto-btn-run').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.id);
      await chrome.runtime.sendMessage({ type: 'RUN_AUTOMATION_NOW', id });
      btn.textContent = '⏳ Avviato';
      btn.disabled = true;
    });
  });
  list.querySelectorAll('.auto-btn-edit').forEach(btn => {
    btn.addEventListener('click', async () => {
      const auto = await getAutoById(parseInt(btn.dataset.id));
      if (auto) openAutoForm(auto);
    });
  });
  list.querySelectorAll('.auto-btn-del').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Eliminare questa automazione?')) return;
      await chrome.runtime.sendMessage({ type: 'DELETE_AUTOMATION', id: parseInt(btn.dataset.id) });
      renderAutomations();
    });
  });
}

function formatInterval(minutes) {
  if (!minutes) return '—';
  if (minutes % 1440 === 0) return `Ogni ${minutes / 1440} giorn${minutes / 1440 === 1 ? 'o' : 'i'}`;
  if (minutes % 60  === 0) return `Ogni ${minutes / 60} or${minutes / 60 === 1 ? 'a' : 'e'}`;
  return `Ogni ${minutes} minuti`;
}

function formatDays(days) {
  if (!days || days.length === 0) return 'nessun giorno';
  const names = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];
  return days.map(Number).sort().map(d => names[d] ?? d).join(' ');
}

// Enter per inviare
$('taskInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!agentRunning || awaitingReply) $('btnStart').click();
  }
});
