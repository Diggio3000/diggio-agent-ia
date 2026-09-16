export const WRITE_ACTIONS = new Set([
  'click',
  'click_text',
  'click_element',
  'click_coords',
  'type',
  'insert_text',
  'select_option',
  'submit_form',
  'press_key',
  'dismiss_popups',
  'execute_js'
]);
export function needsApproval(action, url, mode = 'auto') {
  if (['done', 'ask_user', 'plan'].includes(action)) return false;
  if (mode === 'ask_first' || action === 'execute_js') return true;
  try {
    return WRITE_ACTIONS.has(action) && /(^|\.)ads\.google\.com$/.test(new URL(url).hostname);
  } catch {
    return WRITE_ACTIONS.has(action);
  }
}
export function browserUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Navigazione consentita solo verso URL HTTP/HTTPS senza credenziali.');
  return url.href;
}
export function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted)
      return reject(signal.reason || new DOMException('Interrotto', 'AbortError'));
    const cancel = () => {
      clearTimeout(timer);
      reject(signal.reason || new DOMException('Interrotto', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    }, ms);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}
export function redact(text) {
  return String(text ?? '').replace(
    /((?:api[_-]?key|token|secret|password|authorization)\s*[=:]\s*)([^\s&,;]+)/gi,
    '$1[omesso]'
  );
}
export function extractJson(text) {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('PARAMS deve contenere un oggetto JSON.');
  let depth = 0,
    quoted = false,
    escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error('JSON incompleto: ripeti l’azione con parametri validi.');
}
