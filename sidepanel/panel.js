import {
  PRESETS,
  chatEndpoint,
  modelsEndpoint,
  normalizeModels,
  headersFor,
  requestJson,
  loadSettings,
  supportsVision
} from '../shared/providers.js';
import { DiggioClient } from '../background/diggio-client.js';
import { esc, renderText, csvCell } from '../shared/render.js';

const $ = (id) => document.getElementById(id);
let agentRunning = false,
  awaitingReply = false,
  currentSession = [],
  selectedTabId = null,
  attachedImage = null;
let currentMode = 'chat',
  activeState = {},
  profiles = {},
  currentProvider = 'openai',
  settings = {};
const DRAWERS = [
  'settingsPanel',
  'tabsPanel',
  'historyPanel',
  'templatesPanel',
  'toolsPanel',
  'automationsPanel',
  'guidePanel'
];
async function rpc(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (result?.error) throw new Error(result.error);
  return result;
}
function showError(error) {
  $('appNotice').textContent = error.message || String(error);
  $('appNotice').hidden = false;
}
function clearNotice() {
  $('appNotice').hidden = true;
}
function toggleDrawer(id) {
  const opening = $(id).classList.contains('hidden');
  DRAWERS.forEach((x) => $(x).classList.toggle('hidden', x !== id || !opening));
  document
    .querySelectorAll('[data-drawer]')
    .forEach((b) => b.classList.toggle('selected', opening && b.dataset.drawer === id));
  $('btnChat').classList.toggle('selected', !opening);
  if (opening) $(id).querySelector('input,button,select,textarea')?.focus();
}
function closeDrawers() {
  DRAWERS.forEach((x) => $(x).classList.add('hidden'));
  document.querySelectorAll('[data-drawer]').forEach((b) => b.classList.remove('selected'));
  $('btnChat').classList.add('selected');
}
function scrollToBottom() {
  const el = $('messages');
  el.scrollTop = el.scrollHeight;
}
function drawMessage(m) {
  if (m.type === 'screenshot') {
    drawScreenshot(m.data);
    return;
  }
  if (!m.text) return;
  const fold = ['thought', 'action', 'result'].includes(m.type);
  const div = document.createElement(fold ? 'details' : 'article');
  div.className = 'message ' + m.type;
  const labels = {
    user: 'Tu',
    done: 'Diggio',
    thought: 'Ragionamento',
    action: 'Azione',
    result: 'Osservazione',
    error: 'Da verificare',
    info: 'Stato'
  };
  if (fold) {
    const summary = document.createElement('summary');
    summary.textContent = labels[m.type] + ' · ' + m.text.slice(0, 85);
    div.append(summary);
  } else {
    const label = document.createElement('div');
    label.className = 'message-author';
    label.textContent = labels[m.type] || 'Diggio';
    div.append(label);
  }
  const content = document.createElement('div');
  content.className = 'message-content';
  content.innerHTML = renderText(m.text);
  div.append(content);
  $('messages').append(div);
}
function addMessage(text, type = 'info') {
  currentSession.push({ text: String(text || ''), type });
  drawMessage(currentSession.at(-1));
  $('welcome').hidden = true;
  scrollToBottom();
}
function drawScreenshot(data) {
  const details = document.createElement('details');
  details.className = 'message screenshot';
  const summary = document.createElement('summary');
  summary.textContent = 'Screenshot della pagina';
  const img = document.createElement('img');
  img.src = 'data:image/jpeg;base64,' + data;
  img.alt = 'Pagina osservata dall’agente';
  details.append(summary, img);
  $('messages').append(details);
  scrollToBottom();
}
function setRunning(value) {
  agentRunning = value;
  $('btnStop').disabled = !value;
  $('btnStart').disabled = value && !awaitingReply;
  $('modeSelect').disabled = value;
  $('btnClearChat').disabled = value;
}
function applyState(next) {
  activeState = next;
  currentSession = next.messages || [];
  currentMode = next.mode || currentMode;
  $('modeSelect').value = currentMode;
  awaitingReply = next.pending?.type === 'question';
  setRunning(!!next.running);
  $('messages').replaceChildren();
  currentSession.forEach(drawMessage);
  $('welcome').hidden = currentSession.length > 0;
  $('statusText').textContent = next.running ? next.status || 'Attività in corso' : 'Pronto';
  $('statusDot').classList.toggle('busy', !!next.running);
  $('planPanel').hidden = !next.plan;
  if (next.plan) {
    $('planSummary').textContent = next.plan.completed
      ? 'Piano · completato'
      : 'Piano · ' + next.plan.current + '/' + next.plan.steps.length;
    $('planList').innerHTML = next.plan.steps
      .map(
        (step, i) =>
          '<li class="' +
          (i + 1 === next.plan.current ? 'current' : '') +
          '">' +
          esc(step) +
          '</li>'
      )
      .join('');
  }
  $('progressText').textContent =
    next.running && next.step
      ? `${next.step}/${next.maxSteps} passi`
      : next.tokens
        ? `${next.tokens.toLocaleString('it-IT')} token`
        : '';
  $('btnStart').textContent = awaitingReply
    ? 'Rispondi'
    : currentMode === 'chat'
      ? 'Invia'
      : 'Avvia attività';
  $('taskInput').placeholder = awaitingReply
    ? next.pending.question
    : currentMode === 'chat'
      ? 'Scrivi a Diggio…'
      : 'Descrivi cosa vuoi fare nel browser…';
  $('approvalBar').classList.toggle('hidden', next.pending?.type !== 'approval');
  if (next.pending?.type === 'approval') {
    const p = next.pending;
    $('approvalText').textContent = `${p.action} sulla pagina ${p.url}`;
    $('approvalParams').value = JSON.stringify(p.params, null, 2);
  }
  $('questionText').hidden = !awaitingReply;
  $('questionText').textContent = next.pending?.question || '';
  scrollToBottom();
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.type === 'AGENT_STATE') applyState(msg.state);
  if (msg.type === 'AGENT_UPDATE') {
    if (msg.updateType === 'screenshot') {
      currentSession.push({ type: 'screenshot', data: msg.data });
      drawScreenshot(msg.data);
    } else if (msg.text) addMessage(msg.text, msg.updateType);
  }
  if (msg.type === 'EXPORT_REPORT') {
    try {
      downloadReport(currentSession);
      respond({ ok: true });
    } catch (e) {
      respond({ error: e.message });
    }
    return true;
  }
});

$('btnStart').addEventListener('click', async () => {
  clearNotice();
  const task = $('taskInput').value.trim();
  if (!task) return;
  try {
    if (awaitingReply) {
      await rpc({ type: 'USER_REPLY', text: task });
      awaitingReply = false;
      $('taskInput').value = '';
      setRunning(true);
      return;
    }
    if (agentRunning) return;
    const cfg = await loadSettings();
    if (!cfg.apiEndpoint || !cfg.model) {
      toggleDrawer('settingsPanel');
      throw new Error('Configura prima una connessione e un modello.');
    }
    setRunning(true);
    await rpc({
      type: 'START_AGENT',
      task,
      mode: currentMode,
      tabId: selectedTabId,
      imageData: attachedImage
    });
    $('taskInput').value = '';
    attachedImage = null;
    $('attachedImagePreview').classList.add('hidden');
  } catch (e) {
    setRunning(false);
    showError(e);
  }
});
$('taskInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (!$('btnStart').disabled) $('btnStart').click();
  }
});
$('btnStop').addEventListener('click', () => rpc({ type: 'STOP_AGENT' }).catch(showError));
$('btnApprove').addEventListener('click', async () => {
  try {
    const params = JSON.parse($('approvalParams').value);
    await rpc({ type: 'APPROVE_ACTION', params });
  } catch (e) {
    showError(e);
  }
});
$('btnSkip').addEventListener('click', () => rpc({ type: 'SKIP_ACTION' }).catch(showError));
$('btnClearChat').addEventListener('click', async () => {
  try {
    applyState((await rpc({ type: 'NEW_CONVERSATION', mode: currentMode })).state);
    closeDrawers();
  } catch (e) {
    showError(e);
  }
});
$('btnChat').addEventListener('click', closeDrawers);
$('modeSelect').addEventListener('change', () => {
  currentMode = $('modeSelect').value;
  $('btnStart').textContent = currentMode === 'chat' ? 'Invia' : 'Avvia attività';
  $('taskInput').placeholder =
    currentMode === 'chat' ? 'Scrivi a Diggio…' : 'Descrivi cosa vuoi fare nel browser…';
});
$('btnSettings').addEventListener('click', () => toggleDrawer('settingsPanel'));
$('btnGuide').addEventListener('click', () => toggleDrawer('guidePanel'));
$('btnTheme').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  chrome.storage.local.set({ theme: next });
});
function applyTheme(theme) {
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
  $('btnTheme').setAttribute(
    'aria-label',
    theme === 'dark' ? 'Attiva tema chiaro' : 'Attiva tema scuro'
  );
  $('btnTheme').textContent = theme === 'dark' ? '☀' : '◐';
}

// Configurazioni private sul dispositivo. Endpoint custom senza riferimenti preimpostati.
function formConfig() {
  return {
    provider: $('providerSelect').value,
    apiEndpoint: $('apiEndpoint').value.trim(),
    apiKey: $('apiKey').value.trim(),
    model: $('modelManual').value.trim(),
    modelsUrl: $('modelsUrl').value.trim(),
    protocol: $('protocolSelect').value,
    authType: $('authSelect').value,
    authHeader: $('authHeader').value.trim(),
    vision: $('visionSelect').value,
    nativeTools: $('nativeToolsCheck').checked,
    timeoutSeconds: Number($('timeoutSeconds').value),
    maxSteps: Number($('maxSteps').value),
    tokenBudget: Number($('tokenBudget').value)
  };
}
function fillConfig(c) {
  $('apiEndpoint').value = c.apiEndpoint || PRESETS[currentProvider] || '';
  $('apiKey').value = c.apiKey || '';
  $('modelManual').value = c.model || '';
  $('modelsUrl').value = c.modelsUrl || '';
  $('protocolSelect').value = c.protocol || 'auto';
  $('authSelect').value = c.authType || 'auto';
  $('authHeader').value = c.authHeader || 'X-API-Key';
  $('visionSelect').value = c.vision || 'auto';
  $('nativeToolsCheck').checked = !!c.nativeTools;
  $('timeoutSeconds').value = c.timeoutSeconds || 120;
  $('maxSteps').value = c.maxSteps || 40;
  $('tokenBudget').value = c.tokenBudget || 80000;
  $('modelSelect').replaceChildren();
  $('modelSelect').classList.add('hidden');
  $('modelLoadStatus').textContent = '';
  $('testResult').textContent = '';
  updateCustomFields();
  updateVisionWarning();
}
function updateCustomFields() {
  $('customHint').hidden = currentProvider !== 'custom';
  $('authHeaderRow').hidden = $('authSelect').value !== 'header';
}
$('authSelect').addEventListener('change', updateCustomFields);
$('providerSelect').addEventListener('change', () => {
  profiles[currentProvider] = formConfig();
  currentProvider = $('providerSelect').value;
  fillConfig(profiles[currentProvider] || {});
});
$('modelManual').addEventListener('input', updateVisionWarning);
$('visionSelect').addEventListener('change', updateVisionWarning);
function updateVisionWarning() {
  $('visionWarning').classList.toggle(
    'hidden',
    !attachedImage || supportsVision($('modelManual').value, $('visionSelect').value)
  );
}
$('btnLoadModels').addEventListener('click', async () => {
  const button = $('btnLoadModels');
  button.disabled = true;
  $('modelLoadStatus').textContent = 'Caricamento…';
  try {
    const c = formConfig();
    c.apiEndpoint = chatEndpoint(c.apiEndpoint, c.protocol);
    const url = modelsEndpoint(c.apiEndpoint, c.modelsUrl);
    const ids = normalizeModels(
      await requestJson(url, { headers: headersFor(c, url) }, { timeout: 30000 })
    );
    if (!ids.length) throw new Error('Nessun modello disponibile.');
    $('modelSelect').replaceChildren(...ids.map((id) => new Option(id, id)));
    $('modelSelect').classList.remove('hidden');
    if (ids.includes(c.model)) $('modelSelect').value = c.model;
    else if (!c.model) {
      $('modelManual').value = ids[0];
    }
    $('modelLoadStatus').textContent = `${ids.length} modelli disponibili`;
  } catch (e) {
    $('modelLoadStatus').textContent = e.message;
  } finally {
    button.disabled = false;
  }
});
$('modelSelect').addEventListener('change', () => {
  $('modelManual').value = $('modelSelect').value;
  updateVisionWarning();
});
async function saveSettings(test) {
  const c = formConfig();
  if (!c.model) throw new Error('Inserisci o scegli un modello.');
  c.apiEndpoint = chatEndpoint(c.apiEndpoint, c.protocol);
  if (c.modelsUrl) modelsEndpoint(c.apiEndpoint, c.modelsUrl);
  if (
    c.timeoutSeconds < 10 ||
    c.timeoutSeconds > 300 ||
    c.maxSteps < 1 ||
    c.maxSteps > 80 ||
    c.tokenBudget < 1000
  )
    throw new Error('Verifica i limiti: 10–300 secondi, 1–80 passi, almeno 1000 token.');
  headersFor(c);
  profiles[currentProvider] = c;
  await chrome.storage.local.set({
    ...c,
    providerConfigs: profiles,
    userMemory: $('userMemory').value.slice(0, 3000)
  });
  settings = c;
  $('connectionLabel').textContent = c.model;
  $('testResult').textContent = 'Configurazione salvata sul dispositivo.';
  if (test) {
    $('testResult').textContent = 'Verifica connessione…';
    const client = new DiggioClient(c.apiKey, c.model, c.apiEndpoint, c);
    const reply = await client.chat([{ role: 'user', content: 'Rispondi solo OK.' }]);
    $('testResult').textContent = 'Connessione riuscita · ' + reply.slice(0, 70);
  }
}
$('btnSaveSettings').addEventListener('click', async () => {
  const b = $('btnSaveSettings');
  b.disabled = true;
  try {
    await saveSettings(true);
  } catch (e) {
    $('testResult').textContent = e.message;
  } finally {
    b.disabled = false;
  }
});
$('btnSaveOnly').addEventListener('click', () =>
  saveSettings(false).catch((e) => ($('testResult').textContent = e.message))
);
$('btnShowKey').addEventListener('click', () => {
  $('apiKey').type = $('apiKey').type === 'password' ? 'text' : 'password';
  $('btnShowKey').textContent = $('apiKey').type === 'password' ? 'Mostra' : 'Nascondi';
});

$('btnAttach').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', async () => {
  const file = $('fileInput').files[0];
  if (!file) return;
  try {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type) || file.size > 5 * 1024 * 1024)
      throw new Error('Scegli un’immagine PNG, JPEG o WebP sotto 5 MB.');
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width * scale;
    canvas.height = bitmap.height * scale;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    attachedImage = canvas.toDataURL('image/jpeg', 0.75);
    $('attachedThumb').src = attachedImage;
    $('attachedImagePreview').classList.remove('hidden');
    updateVisionWarning();
  } catch (e) {
    showError(e);
  } finally {
    $('fileInput').value = '';
  }
});
$('btnRemoveImage').addEventListener('click', () => {
  attachedImage = null;
  $('attachedImagePreview').classList.add('hidden');
});
$('btnScreenshot').addEventListener('click', async () => {
  try {
    const result = await rpc({ type: 'SCREENSHOT' });
    drawScreenshot(result.data);
  } catch (e) {
    showError(e);
  }
});

$('btnTabs').addEventListener('click', async () => {
  toggleDrawer('tabsPanel');
  try {
    renderTabs((await rpc({ type: 'GET_TABS' })).tabs);
  } catch (e) {
    showError(e);
  }
});
$('btnNewTab').addEventListener('click', async () => {
  await chrome.tabs.create({ url: 'https://www.google.com' });
  renderTabs((await rpc({ type: 'GET_TABS' })).tabs);
});
$('btnClearTarget').addEventListener('click', () => {
  selectedTabId = null;
  $('targetBadge').classList.add('hidden');
});
function renderTabs(tabs) {
  $('tabsList').replaceChildren();
  tabs
    .filter((t) => /^https?:/.test(t.url))
    .forEach((t) => {
      const b = document.createElement('button');
      b.className = 'tab-item';
      b.innerHTML = `<div><strong>${esc(t.title)}</strong><div class="tab-url">${esc(t.url)}</div></div>`;
      b.addEventListener('click', () => {
        selectedTabId = t.id;
        $('targetTabName').textContent = t.title;
        $('targetBadge').classList.remove('hidden');
        closeDrawers();
      });
      $('tabsList').append(b);
    });
}
$('btnHistory').addEventListener('click', () => {
  toggleDrawer('historyPanel');
  renderHistory();
});
$('historySearch').addEventListener('input', () => renderHistory($('historySearch').value));
async function renderHistory(filter = '') {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all)
    .filter((k) => k.startsWith('session_'))
    .sort((a, b) => (all[b].updated || 0) - (all[a].updated || 0));
  $('historyList').replaceChildren();
  for (const key of keys) {
    const item = all[key];
    if (!JSON.stringify(item.messages).toLowerCase().includes(filter.toLowerCase())) continue;
    const row = document.createElement('div');
    row.className = 'history-item';
    const open = document.createElement('button');
    open.className = 'history-open';
    open.innerHTML = `<strong>${esc(item.title)}</strong><small>${esc(item.date)}</small>`;
    open.addEventListener('click', async () => {
      try {
        applyState((await rpc({ type: 'RESTORE_CONVERSATION', key })).state);
        closeDrawers();
      } catch (e) {
        showError(e);
      }
    });
    const del = document.createElement('button');
    del.className = 'h-del';
    del.textContent = '×';
    del.title = 'Elimina conversazione';
    del.addEventListener('click', async () => {
      if (confirm('Eliminare questa conversazione?')) {
        await chrome.storage.local.remove(key);
        renderHistory(filter);
      }
    });
    row.append(open, del);
    $('historyList').append(row);
  }
  if (!$('historyList').children.length)
    $('historyList').textContent = 'Nessuna conversazione trovata.';
}
$('btnClearAllHistory').addEventListener('click', async () => {
  if (!confirm('Eliminare tutte le conversazioni salvate?')) return;
  const all = await chrome.storage.local.get(null);
  await chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith('session_')));
  renderHistory();
});
function downloadBlob(content, type, name) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function downloadReport(messages) {
  if (!messages.length) throw new Error('La conversazione è vuota.');
  const title = messages.find((m) => m.type === 'user')?.text || 'Conversazione';
  downloadBlob(
    `<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title.slice(0, 80))}</title><style>body{font:16px/1.6 system-ui;max-width:900px;margin:40px auto;padding:20px;color:#17324a}article{padding:20px;border-bottom:1px solid #ddd}pre{white-space:pre-wrap}table{border-collapse:collapse}td,th{border:1px solid #ddd;padding:8px}a{color:#0754be}</style><h1>${esc(title)}</h1>${messages.map((m) => `<article><b>${esc(m.type)}</b>${m.type === 'screenshot' ? '<img alt="Screenshot" style="max-width:100%" src="data:image/jpeg;base64,' + esc(m.data) + '">' : renderText(m.text)}</article>`).join('')}</html>`,
    'text/html;charset=utf-8',
    'diggio-report.html'
  );
}
$('btnDownload').addEventListener('click', () => {
  try {
    downloadReport(currentSession);
  } catch (e) {
    showError(e);
  }
});
$('btnExportCSV').addEventListener('click', () => {
  $('exportOptions').hidden = !$('exportOptions').hidden;
});
for (const b of document.querySelectorAll('[data-export]'))
  b.addEventListener('click', () => {
    const format = b.dataset.export;
    if (format === 'html') downloadReport(currentSession);
    else if (format === 'json')
      downloadBlob(
        JSON.stringify({ date: new Date().toISOString(), messages: currentSession }, null, 2),
        'application/json',
        'diggio-chat.json'
      );
    else
      downloadBlob(
        '\uFEFF' +
          [['tipo', 'testo'], ...currentSession.map((m) => [m.type, m.text])]
            .map((row) => row.map(csvCell).join(','))
            .join('\r\n'),
        'text/csv;charset=utf-8',
        'diggio-chat.csv'
      );
    $('exportOptions').hidden = true;
  });
for (const b of document.querySelectorAll('[data-prompt]'))
  b.addEventListener('click', () => {
    $('taskInput').value = b.dataset.prompt;
    if (b.dataset.agent) {
      currentMode = 'ask_first';
      $('modeSelect').value = currentMode;
      $('modeSelect').dispatchEvent(new Event('change'));
    }
    $('taskInput').focus();
  });
for (const drawer of DRAWERS) {
  const button = document.createElement('button');
  button.className = 'drawer-close';
  button.textContent = 'Chiudi ×';
  button.addEventListener('click', closeDrawers);
  $(drawer).prepend(button);
}
for (const button of document.querySelectorAll('button[title]'))
  button.setAttribute('aria-label', button.title);
for (const label of document.querySelectorAll('label')) {
  const field = label.nextElementSibling;
  if (field?.id && ['INPUT', 'SELECT', 'TEXTAREA'].includes(field.tagName))
    label.htmlFor = field.id;
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeDrawers();
});
async function initialize() {
  settings = await loadSettings();
  profiles = settings.providerConfigs || {};
  currentProvider = settings.provider || 'openai';
  $('providerSelect').value = currentProvider;
  profiles[currentProvider] ||= settings;
  fillConfig(profiles[currentProvider]);
  $('userMemory').value = settings.userMemory || '';
  applyTheme(
    settings.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  );
  $('footerVersion').textContent = 'v' + chrome.runtime.getManifest().version;
  $('connectionLabel').textContent = settings.model || 'Configura il tuo modello';
  applyState((await rpc({ type: 'GET_STATE' })).state);
}
initialize().catch(showError);

// ── Riassunto pagina ──────────────────────────────────────────
$('btnSummary').addEventListener('click', () => {
  $('taskInput').value = `Analizza e riassumi la pagina corrente:
1. Usa read_page() per leggere il contenuto completo
2. Scatta uno screenshot per vedere il layout visivo
3. Produci un riassunto strutturato con:
   - Titolo e scopo della pagina
   - Punti chiave (max 10 bullet point)
   - Informazioni importanti (prezzi, date, contatti se presenti)
   - Link e risorse principali trovati`;
  currentMode = 'ask_first';
  $('modeSelect').value = currentMode;
  $('modeSelect').dispatchEvent(new Event('change'));
  closeDrawers();
  $('taskInput').focus();
});

// ── Traduci e analizza ────────────────────────────────────────
$('btnTranslate').addEventListener('click', () => {
  $('taskInput').value = `Traduci e analizza la pagina corrente:
1. Usa read_page() per leggere il testo originale
2. Scatta uno screenshot per vedere il contesto visivo
3. Produci in italiano:
   - Traduzione fedele del contenuto principale
   - Riassunto dei punti chiave
   - Eventuali informazioni importanti (prezzi, date, contatti)
   - Note su elementi tecnici o culturali rilevanti`;
  currentMode = 'ask_first';
  $('modeSelect').value = currentMode;
  $('modeSelect').dispatchEvent(new Event('change'));
  closeDrawers();
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
  return new Promise((r) => chrome.storage.local.get('templates', (d) => r(d.templates || [])));
}

async function renderTemplates(filter = '') {
  const list = $('templateList');
  list.innerHTML = '';
  const templates = await loadTemplates();
  const filtered = filter
    ? templates.filter(
        (t) => t.title.toLowerCase().includes(filter) || t.text.toLowerCase().includes(filter)
      )
    : templates;

  if (filtered.length === 0) {
    list.innerHTML = `<div class="no-history">${filter ? 'Nessun risultato' : 'Nessun template salvato'}</div>`;
    return;
  }

  filtered.forEach((t) => {
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
        const updated = all.filter((x) => x.id !== parseInt(e.target.dataset.id));
        await chrome.storage.local.set({ templates: updated });
        renderTemplates($('templateSearchInput').value.trim().toLowerCase());
        return;
      }
      $('taskInput').value = t.text;
      closeDrawers();
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
    list.innerHTML =
      '<div class="no-history">Nessun appunto ancora — l\'agente impara mentre naviga</div>';
    return;
  }
  domains.forEach((d) => {
    const entry = knowledge[d];
    const notes = entry?.notes ?? [];
    const div = document.createElement('div');
    div.className = 'history-item';
    div.innerHTML = `
      <div class="h-title">🌐 ${esc(d)} <span style="color:#94a3b8;font-weight:400">(${notes.length} appunt${notes.length === 1 ? 'o' : 'i'})</span></div>
      <div class="h-date" style="white-space:pre-line">${esc(notes.map((n) => '• ' + n).join('\n'))}</div>
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
  const url = $('scraperUrl').value.trim();
  const target = $('scraperTarget').value.trim();
  if (!url || !target) {
    alert('Inserisci URL e cosa estrarre.');
    return;
  }

  const loop = $('scraperLoop').checked;
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
  currentMode = 'ask_first';
  $('modeSelect').value = currentMode;
  $('modeSelect').dispatchEvent(new Event('change'));
  $('taskInput').focus();
});

// — Confronto Prodotti —
$('btnConfrontoGenera').addEventListener('click', () => {
  const urls = [
    $('confrontoUrl1').value.trim(),
    $('confrontoUrl2').value.trim(),
    $('confrontoUrl3').value.trim()
  ].filter(Boolean);

  if (urls.length < 2) {
    alert('Inserisci almeno 2 URL da confrontare.');
    return;
  }

  const urlList = urls.map((u, i) => `${i + 1}. ${u}`).join('\n');
  const prompt = `Confronta questi prodotti visitandoli in sequenza:
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
  currentMode = 'ask_first';
  $('modeSelect').value = currentMode;
  $('modeSelect').dispatchEvent(new Event('change'));
  $('taskInput').focus();
});

// — Form Filler —
async function loadFormFillerData() {
  const data = await new Promise((r) =>
    chrome.storage.local.get('formFillerData', (d) => r(d.formFillerData || ''))
  );
  $('formFillerData').value = data;
}

$('btnFormFillerSave').addEventListener('click', async () => {
  const data = $('formFillerData').value.trim();
  await chrome.storage.local.set({ formFillerData: data });
  const btn = $('btnFormFillerSave');
  btn.textContent = '✅ Salvato!';
  setTimeout(() => {
    btn.textContent = '💾 Salva';
  }, 1500);
});

$('btnFormFillerGenera').addEventListener('click', async () => {
  let data = $('formFillerData').value.trim();
  if (!data) {
    data = await new Promise((r) =>
      chrome.storage.local.get('formFillerData', (d) => r(d.formFillerData || ''))
    );
  }
  if (!data) {
    alert('Inserisci i dati da usare per compilare i form.');
    return;
  }

  const prompt = `Compila il form sulla pagina corrente usando questi dati:
${data}

Istruzioni:
- Analizza la pagina con read_page() per identificare tutti i campi del form
- Abbina ogni campo ai dati forniti (nome, email, telefono, indirizzo, ecc.)
- Compila tutti i campi trovati usando type() e select_option()
- Scatta uno screenshot dopo aver compilato per mostrare il risultato
- NON inviare il form — fermati prima del submit e aspetta conferma`;

  $('taskInput').value = prompt;
  toggleDrawer('toolsPanel');
  currentMode = 'ask_first';
  $('modeSelect').value = currentMode;
  $('modeSelect').dispatchEvent(new Event('change'));
  $('taskInput').focus();
});

// — Analisi SEO —
$('btnSeoGenera').addEventListener('click', () => {
  const url = $('seoUrl').value.trim();
  if (!url) {
    alert("Inserisci l'URL del sito da analizzare.");
    return;
  }

  const checks = Array.from(document.querySelectorAll('.seo-cb:checked')).map((cb) => cb.value);

  const checkMap = {
    meta: "meta title, meta description (lunghezza e presenza), canonical URL, og:title/og:description, twitter card, lang dell'html",
    headings:
      'struttura heading H1-H6: presenza H1 unico, gerarchia corretta, testi significativi, keyword stuffing',
    links:
      'link interni (con anchor text), link esterni (follow/nofollow), link rotti (errori 404), link con target=_blank senza rel=noopener',
    images:
      'tutte le immagini: verifica alt text mancante o vuoto, dimensioni enormi non ottimizzate, lazy loading assente',
    robots:
      'carica /robots.txt e /sitemap.xml: verifica presenza, direttive Disallow, sitemap correttamente dichiarata',
    speed:
      'dimensione HTML, numero di script/CSS bloccanti, uso di webfonts esterni, script in <head> senza async/defer',
    mobile:
      'meta viewport presente e corretto, testi leggibili senza zoom, elementi cliccabili abbastanza grandi, larghezza contenuto',
    schema:
      'cerca JSON-LD o microdati: tipo di schema (Article, Product, Organization, BreadcrumbList, FAQPage), validità struttura'
  };

  const tasks = checks.map((c) => `- ${checkMap[c] ?? c}`).join('\n');

  const prompt = `Esegui un'analisi SEO completa di: ${url}

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
  currentMode = 'ask_first';
  $('modeSelect').value = currentMode;
  $('modeSelect').dispatchEvent(new Event('change'));
  $('taskInput').focus();
});

// — Analisi Google Ads —
$('btnAdsGenera').addEventListener('click', () => {
  const scope = $('adsScope').value;
  const fix = $('adsFix').checked;

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

  const fixPart = fix
    ? `

DOPO L'ANALISI — CORREZIONI (una alla volta):
Per ogni problema trovato, in ordine di impatto:
1. Spiega con ask_user() la correzione proposta (cosa, dove, impatto atteso) e chiedi conferma
2. Se confermo: applica la modifica e scatta screenshot di verifica
3. Se rifiuto: passa alla correzione successiva
Correzioni tipiche: aggiungere parole chiave negative, mettere in pausa keyword con quality score
molto basso, segnalare campagne con budget da rivedere (NON cambiare mai i budget senza il mio ok esplicito).`
    : `

NON applicare nessuna modifica — solo analisi e suggerimenti.`;

  const prompt = `Analizza il mio account Google Ads (sono già loggato su ads.google.com).
⚠️ L'interfaccia è una SPA lenta: dopo ogni navigazione usa wait(4) prima di leggere.

${scopeSteps[scope] ?? scopeSteps.full}

REPORT FINALE:
- 📊 Tabella riassuntiva per campagna: stato, budget, CTR, CPC, conversioni, costo
- ⚠️ Problemi trovati in ordine di impatto economico
- 💡 Per ogni problema: suggerimento concreto e impatto stimato
- 🏆 Le 3 azioni prioritarie da fare subito${fixPart}`;

  $('taskInput').value = prompt;
  toggleDrawer('toolsPanel');
  currentMode = 'ask_first';
  $('modeSelect').value = currentMode;
  $('modeSelect').dispatchEvent(new Event('change'));
  $('taskInput').focus();
});

// — Controllo Sicurezza Sito —
$('btnSecGenera').addEventListener('click', () => {
  const url = $('secUrl').value.trim();
  if (!url) {
    alert("Inserisci l'URL del sito da controllare.");
    return;
  }

  const checks = Array.from(document.querySelectorAll('.sec-cb:checked')).map((cb) => cb.value);
  const domain = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  })();

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

  const prompt = `Esegui un controllo di sicurezza completo per: ${url}
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
  currentMode = 'ask_first';
  $('modeSelect').value = currentMode;
  $('modeSelect').dispatchEvent(new Event('change'));
  $('taskInput').focus();
});

// — Verifica Sito Truffa —
$('btnScamGenera').addEventListener('click', () => {
  const url = $('scamUrl').value.trim();
  const deep = $('scamDeep').checked;
  if (!url) {
    alert("Inserisci l'URL del sito da verificare.");
    return;
  }

  const domain = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  })();

  const deepSteps = deep
    ? `
STEP REPUTAZIONE ESTERNA (cerca conferme indipendenti):
- navigate("https://www.google.com/search?q=${encodeURIComponent('"' + domain + '" truffa OR recensioni OR opinioni OR scam OR fake')}")
- read_page() per leggere i primi risultati di ricerca
- navigate("https://www.trustpilot.com/review/${domain}") e leggi le recensioni (se presenti)
- navigate("https://web.archive.org/web/*/${domain}") per verificare da quando esiste il sito
- Se trovi forum/blog con segnalazioni, annota le URL`
    : '';

  const prompt = `Verifica se questo sito è legittimo o una possibile truffa: ${url}

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
  currentMode = 'ask_first';
  $('modeSelect').value = currentMode;
  $('modeSelect').dispatchEvent(new Event('change'));
  $('taskInput').focus();
});

// — Ricerca Google —
$('btnGoogleGenera').addEventListener('click', () => {
  const query = $('googleQuery').value.trim();
  const linksOnly = $('googleLinksOnly').checked;
  if (!query) {
    alert('Inserisci una query di ricerca.');
    return;
  }

  let prompt;
  if (linksOnly) {
    prompt = `Vai su https://www.google.com e cerca: "${query}"
Usa read_page() per estrarre tutti i link dei risultati organici (ignora pubblicità e box Google).
Restituisci una lista ordinata con: numero, titolo, URL e descrizione breve per ogni risultato.
Non aprire i singoli link.`;
  } else {
    prompt = `Vai su https://www.google.com e cerca: "${query}"
Usa read_page() per vedere i risultati, poi apri i primi 3-5 risultati organici più pertinenti.
Per ogni pagina: usa read_page() per leggere il contenuto rilevante e scatta uno screenshot.
Alla fine sintetizza le informazioni trovate in un report completo con fonti e link diretti.`;
  }

  $('taskInput').value = prompt;
  toggleDrawer('toolsPanel');
  currentMode = 'ask_first';
  $('modeSelect').value = currentMode;
  $('modeSelect').dispatchEvent(new Event('change'));
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
  if (!name) {
    alert("Inserisci un nome per l'automazione.");
    return;
  }
  if (!task) {
    alert('Inserisci il task da eseguire.');
    return;
  }

  const schedType = document.querySelector('input[name="schedType"]:checked').value;
  const intervalVal = parseInt($('autoIntervalVal').value) || 1;
  const intervalUnit = parseInt($('autoIntervalUnit').value) || 60;
  const intervalMinutes = intervalVal * intervalUnit;

  const days = Array.from(document.querySelectorAll('.day-cb:checked')).map((cb) =>
    parseInt(cb.value)
  );

  const idVal = $('autoId').value;
  const automation = {
    id: idVal ? parseInt(idVal) : Date.now(),
    name,
    task,
    scheduleType: schedType,
    intervalMinutes: schedType === 'interval' ? intervalMinutes : null,
    time: schedType === 'daily' ? $('autoTime').value : null,
    days: schedType === 'daily' ? days : [],
    stopCondition: $('autoStop').value.trim(),
    maxRuns: parseInt($('autoMaxRuns').value) || 0,
    runsCount: 0,
    active: true,
    lastRun: null,
    lastResult: null,
    nextRun: null,
    model: $('autoModel').value
  };

  // Mantieni runsCount se è una modifica
  if (idVal) {
    const existing = await getAutoById(parseInt(idVal));
    if (existing) automation.runsCount = existing.runsCount || 0;
  }

  try {
    await rpc({ type: 'SAVE_AUTOMATION', automation });
  } catch (e) {
    showError(e);
    return;
  }
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
  $('autoId').value = auto ? auto.id : '';
  $('autoName').value = auto ? auto.name : '';
  $('autoTask').value = auto ? auto.task : '';
  $('autoStop').value = auto ? auto.stopCondition || '' : '';
  $('autoMaxRuns').value = auto ? auto.maxRuns || 0 : 0;
  $('autoModel').value = auto ? auto.model || '' : '';
  $('autoFormTitle').textContent = auto ? 'Modifica Automazione' : 'Nuova Automazione';

  if (auto?.scheduleType === 'daily') {
    $('radioDaily').checked = true;
    $('radioInterval').checked = false;
    $('schedInterval').classList.add('hidden');
    $('schedDaily').classList.remove('hidden');
    $('autoTime').value = auto.time || '09:00';
    document.querySelectorAll('.day-cb').forEach((cb) => {
      cb.checked = (auto.days || []).map(Number).includes(parseInt(cb.value));
    });
  } else {
    $('radioInterval').checked = true;
    $('radioDaily').checked = false;
    $('schedInterval').classList.remove('hidden');
    $('schedDaily').classList.add('hidden');
    if (auto?.intervalMinutes) {
      // Cerca unità migliore
      if (auto.intervalMinutes % 1440 === 0) {
        $('autoIntervalVal').value = auto.intervalMinutes / 1440;
        $('autoIntervalUnit').value = '1440';
      } else if (auto.intervalMinutes % 60 === 0) {
        $('autoIntervalVal').value = auto.intervalMinutes / 60;
        $('autoIntervalUnit').value = '60';
      } else {
        $('autoIntervalVal').value = auto.intervalMinutes;
        $('autoIntervalUnit').value = '1';
      }
    } else {
      $('autoIntervalVal').value = 1;
      $('autoIntervalUnit').value = '60';
    }
  }

  $('autoList').classList.add('hidden');
  $('autoForm').classList.remove('hidden');
}

async function getAutoById(id) {
  return new Promise((r) =>
    chrome.storage.local.get('automations', (d) => {
      r((d.automations || []).find((a) => a.id === id) || null);
    })
  );
}

async function renderAutomations() {
  const list = $('autoList');
  list.innerHTML = '';
  const automations = await new Promise((r) =>
    chrome.storage.local.get('automations', (d) => r(d.automations || []))
  );

  if (automations.length === 0) {
    list.innerHTML = '<div class="no-history">Nessuna automazione. Creane una con + Nuova.</div>';
    return;
  }

  automations.forEach((a) => {
    const card = document.createElement('div');
    card.className = `auto-item${a.active ? '' : ' auto-paused'}`;

    const schedLabel =
      a.scheduleType === 'interval'
        ? formatInterval(a.intervalMinutes)
        : `${a.time} (${formatDays(a.days)})`;

    const lastRun = a.lastRun ? new Date(a.lastRun).toLocaleString('it-IT') : '—';
    const nextRun = a.nextRun ? new Date(a.nextRun).toLocaleString('it-IT') : '—';
    const runs = a.maxRuns > 0 ? `${a.runsCount || 0}/${a.maxRuns}` : a.runsCount || 0;

    card.innerHTML = `
      <div class="auto-item-header">
        <span class="auto-name">${esc(a.name)}</span>
        <span class="auto-badge ${a.active ? 'badge-active' : 'badge-paused'}">${a.active ? '▶ Attiva' : '⏸ In pausa'}</span>
      </div>
      <div class="auto-meta">🕐 ${schedLabel} &nbsp;·&nbsp; Esecuzioni: ${runs}</div>
      <div class="auto-meta">Ultimo run: ${lastRun}</div>
      <div class="auto-meta">Prossimo: ${nextRun}</div>
      ${a.lastResult && a.lastResult !== 'In esecuzione...' ? `<div class="auto-result">${esc(a.lastResult.substring(0, 120))}</div>` : ''}
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
  list.querySelectorAll('.auto-btn-toggle').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.id);
      const active = btn.dataset.active === 'true';
      await chrome.runtime.sendMessage({ type: 'TOGGLE_AUTOMATION', id, active: !active });
      renderAutomations();
    });
  });
  list.querySelectorAll('.auto-btn-run').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = parseInt(btn.dataset.id);
      try {
        await rpc({ type: 'RUN_AUTOMATION_NOW', id });
      } catch (e) {
        showError(e);
        return;
      }
      btn.textContent = '⏳ Avviato';
      btn.disabled = true;
    });
  });
  list.querySelectorAll('.auto-btn-edit').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const auto = await getAutoById(parseInt(btn.dataset.id));
      if (auto) openAutoForm(auto);
    });
  });
  list.querySelectorAll('.auto-btn-del').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('Eliminare questa automazione?')) return;
      await chrome.runtime.sendMessage({ type: 'DELETE_AUTOMATION', id: parseInt(btn.dataset.id) });
      renderAutomations();
    });
  });
}

function formatInterval(minutes) {
  if (!minutes) return '—';
  if (minutes % 1440 === 0)
    return `Ogni ${minutes / 1440} giorn${minutes / 1440 === 1 ? 'o' : 'i'}`;
  if (minutes % 60 === 0) return `Ogni ${minutes / 60} or${minutes / 60 === 1 ? 'a' : 'e'}`;
  return `Ogni ${minutes} minuti`;
}

function formatDays(days) {
  if (!days || days.length === 0) return 'nessun giorno';
  const names = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  return days
    .map(Number)
    .sort()
    .map((d) => names[d] ?? d)
    .join(' ');
}
