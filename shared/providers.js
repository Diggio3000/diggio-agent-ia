import { migrateTokenBudgets, migrateStepBudgets } from './budget.js';

export const PRESETS = {
  openai: 'https://api.openai.com/v1/chat/completions',
  anthropic: 'https://api.anthropic.com/v1/messages',
  groq: 'https://api.groq.com/openai/v1/chat/completions',
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  perplexity: 'https://api.perplexity.ai/chat/completions',
  ollama: 'http://localhost:11434/v1/chat/completions',
  ollama_cloud: 'https://ollama.com/v1/chat/completions',
  lmstudio: 'http://localhost:1234/v1/chat/completions',
  custom: ''
};

export function endpointUrl(value) {
  const url = new URL(String(value).trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Usa un indirizzo HTTP/HTTPS senza credenziali nell’URL.');
  if (url.hash) throw new Error('L’endpoint non può contenere un frammento #.');
  return url;
}

export function chatEndpoint(value, protocol = 'openai') {
  const url = endpointUrl(value);
  const path = url.pathname.replace(/\/$/, '');
  if (!path || /\/v\d+$/.test(path))
    url.pathname = (path || '/v1') + (protocol === 'anthropic' ? '/messages' : '/chat/completions');
  return url.href;
}

export function modelsEndpoint(endpoint, custom = '') {
  if (custom.trim()) return endpointUrl(custom).href;
  const url = endpointUrl(endpoint);
  if (/\.php$/i.test(url.pathname)) return url.href;
  url.pathname = url.pathname.replace(/\/(chat\/completions|messages)\/?$/, '/models');
  return url.href;
}

export function normalizeModels(json) {
  const source = Array.isArray(json)
    ? json
    : (json.data?.models ?? json.data?.data ?? json.data ?? json.models);
  if (!Array.isArray(source))
    throw new Error(
      'Formato elenco modelli non riconosciuto. Puoi inserire il modello manualmente.'
    );
  return [
    ...new Set(
      source
        .map((m) => (typeof m === 'string' ? m : (m?.id ?? m?.name ?? m?.model)))
        .filter((m) => typeof m === 'string' && m.trim())
    )
  ].sort();
}

export function protocolFor(config) {
  return config.protocol && config.protocol !== 'auto'
    ? config.protocol
    : new URL(config.apiEndpoint).hostname === 'api.anthropic.com'
      ? 'anthropic'
      : 'openai';
}

export function headersFor(config, endpoint = config.apiEndpoint) {
  const headers = { 'Content-Type': 'application/json' };
  const protocol = protocolFor(config);
  const auth = config.authType || 'auto';
  if (protocol === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    headers['anthropic-dangerous-direct-browser-access'] = 'true';
  }
  if (config.apiKey && auth !== 'none') {
    // A separate model-list host must not receive the chat credential implicitly.
    if (new URL(endpoint).origin !== new URL(config.apiEndpoint).origin)
      throw new Error(
        'L’elenco modelli deve usare la stessa origine dell’endpoint per ricevere la chiave.'
      );
    const name =
      auth === 'header'
        ? config.authHeader
        : auth === 'auto' && protocol === 'anthropic'
          ? 'x-api-key'
          : 'Authorization';
    if (
      !name ||
      !/^[A-Za-z0-9-]+$/.test(name) ||
      /^(host|cookie|origin|referer|content-length)$/i.test(name)
    )
      throw new Error('Nome dell’header di autenticazione non valido.');
    headers[name] =
      name === 'Authorization' && auth !== 'header' ? `Bearer ${config.apiKey}` : config.apiKey;
  }
  return headers;
}

export function supportsVision(model, setting = 'auto') {
  if (setting !== 'auto') return setting === 'on';
  return /^(gpt-4o|gpt-4\.1|gpt-5|claude-|gemini-|gemma3|gemma4|llava|bakllava|moondream|minicpm-v|qwen.*vl)/i.test(
    model
  );
}

export function anthropicMessages(messages) {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      ...m,
      content: Array.isArray(m.content)
        ? m.content.map((p) => {
            if (p.type !== 'image_url') return p;
            const url = p.image_url.url;
            const match = /^data:(image\/[\w.+-]+);base64,([\s\S]+)$/.exec(url);
            return {
              type: 'image',
              source: match
                ? { type: 'base64', media_type: match[1], data: match[2] }
                : { type: 'url', url }
            };
          })
        : m.content
    }));
}

export async function requestJson(
  url,
  options = {},
  { signal, timeout = 120000, onResponse } = {}
) {
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(
    () => controller.abort(new DOMException('Tempo di risposta superato', 'TimeoutError')),
    timeout
  );
  let response, json;
  try {
    response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    try {
      json = JSON.parse(text);
    } catch {
      const error = new Error(
        `Risposta non JSON (HTTP ${response.status}). Verifica l’indirizzo dell’API.`
      );
      error.status = response.status;
      throw error;
    }
    if (!response.ok || !json || json.error || json.status === 'error') {
      const error = new Error(
        (typeof json?.error === 'string' ? json.error : json?.error?.message) ||
        json?.message || `Errore HTTP ${response.status}`
      );
      error.status = response.status;
      throw error;
    }
    return json;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    if (response && onResponse) {
      try {
        await onResponse({ json, headers: response.headers, status: response.status });
      } catch {
        console.warn('Impossibile aggiornare il registro consumi.');
      }
    }
  }
}

let migration;
const SETTINGS_KEYS = [
  'apiKey',
  'model',
  'apiEndpoint',
  'provider',
  'nativeTools',
  'source',
  'sourceConfigs',
  'providerConfigs',
  'vision',
  'protocol',
  'modelsUrl',
  'authType',
  'authHeader',
  'theme',
  'userMemory',
  'timeoutSeconds',
  'maxSteps',
  'tokenBudget'
];
export function loadSettings() {
  migration ??= (async () => {
    const keys = [
      'apiKey',
      'model',
      'apiEndpoint',
      'provider',
      'nativeTools',
      'source',
      'sourceConfigs',
      'providerConfigs',
      'vision',
      'protocol',
      'modelsUrl',
      'authType',
      'authHeader'
    ];
    const old = await chrome.storage.sync.get(keys);
    const local = await chrome.storage.local.get([...SETTINGS_KEYS, 'optionalTokenBudgetVersion', 'optionalStepBudgetVersion', 'automations']);
    const missing = Object.fromEntries(Object.entries(old).filter(([key]) => !(key in local)));
    if (Object.keys(missing).length) await chrome.storage.local.set(missing);
    const budgetMigration = migrateTokenBudgets({ ...missing, ...local });
    if (Object.keys(budgetMigration).length) await chrome.storage.local.set(budgetMigration);
    const stepMigration = migrateStepBudgets({ ...missing, ...local, ...budgetMigration });
    if (Object.keys(stepMigration).length) await chrome.storage.local.set(stepMigration);
    if (!(local.provider || old.provider) && (local.source || old.source)) {
      const source = local.source || old.source;
      await chrome.storage.local.set({
        provider: source === 'ollama_local' ? 'ollama' : PRESETS[source] ? source : 'custom'
      });
    }
    await chrome.storage.sync.remove(keys);
    await chrome.storage.local.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' });
  })().catch((e) => {
    migration = null;
    throw e;
  });
  return migration.then(() => chrome.storage.local.get(SETTINGS_KEYS));
}
