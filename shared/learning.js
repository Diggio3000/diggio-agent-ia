export function cleanRecordingUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Scegli una pagina HTTP/HTTPS.');
  return url.origin + url.pathname;
}
export function validateProcedure(input) {
  const name = String(input?.name || '').trim();
  const instructions = String(input?.instructions || '').trim();
  if (!name || name.length > 100) throw new Error('Titolo richiesto, massimo 100 caratteri.');
  if (!instructions || instructions.length > 12000)
    throw new Error('Descrivi i passaggi, massimo 12.000 caratteri.');
  const origin = input.origin ? new URL(cleanRecordingUrl(input.origin)).origin : '';
  return {
    id:
      typeof input.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(input.id)
        ? input.id
        : crypto.randomUUID(),
    name,
    instructions,
    origin,
    source: input.source === 'recording' ? 'recording' : 'chat',
    updated: Date.now()
  };
}
export function recordedInstructions(recording) {
  return (recording?.steps || [])
    .map((s, i) => {
      if (s.kind === 'navigate')
        return `${i + 1}. Apri ${s.url} (parametri URL esclusi: aggiungili solo se necessari).`;
      if (s.kind === 'manual')
        return `${i + 1}. Chiedi all’utente di completare manualmente il campo riservato.`;
      const target = `«${s.label}»${s.selector ? ' — selettore: ' + s.selector : ''}`;
      if (s.kind === 'type') return `${i + 1}. Compila ${target} con {{dato_${i + 1}}}.`;
      if (s.kind === 'select_option')
        return `${i + 1}. Seleziona {{opzione_${i + 1}}} in ${target}.`;
      return `${i + 1}. Clicca ${target} e verifica il risultato prima di proseguire.`;
    })
    .join('\n');
}
export function normalizeRecordingEvent(event) {
  if (!['click', 'type', 'select_option', 'manual'].includes(event?.kind)) return null;
  if (event.kind === 'manual') return { kind: 'manual' };
  // Whitelist: mai conservare valori dei campi, HTML o dati extra del messaggio.
  return {
    kind: event.kind,
    selector: String(event.selector || '').slice(0, 1000),
    label: String(event.label || 'elemento').slice(0, 100)
  };
}

// Funzione autosufficiente iniettata soltanto nella scheda scelta dall'utente.
export function recordPage(id) {
  globalThis.__diggioStopRecording?.();
  if (!id) return;
  const dom = globalThis.__diggioDom;
  if (!dom) throw new Error('Motore di registrazione non inizializzato.');
  const badge = document.createElement('div');
  badge.textContent = '● Diggio sta registrando i passaggi · Stop nel pannello';
  badge.style.cssText =
    'position:fixed;bottom:12px;right:12px;padding:10px 14px;background:#172131;color:white;border:1px solid #80aaff;border-radius:9px;z-index:2147483647;font:12px sans-serif;pointer-events:none';
  document.documentElement.append(badge);
  let timer;
  const cleanup = () => {
    document.removeEventListener('click', handler, true);
    document.removeEventListener('input', handler, true);
    document.removeEventListener('change', handler, true);
    clearTimeout(timer);
    badge.remove();
  };
  const handler = (event) => {
    if (!event.isTrusted) return;
    const el = event
      .composedPath()
      .find((node) =>
        node?.matches?.(
          'a[href],button,input,textarea,select,[role=button],[role=link],[role=tab],[role=checkbox],[role=radio],[contenteditable=true],summary'
        )
      );
    if (!el) return;
    const editable = ['INPUT', 'TEXTAREA'].includes(el.tagName) || el.isContentEditable;
    if (
      event.type === 'click' &&
      ((editable && !['checkbox', 'radio', 'submit', 'button'].includes(el.type)) ||
        el.tagName === 'SELECT')
    )
      return;
    if (event.type !== 'click' && !editable && el.tagName !== 'SELECT') return;
    if (event.type !== 'click' && ['checkbox', 'radio'].includes(el.type)) return;
    const step = dom.sensitive(el)
      ? { kind: 'manual' }
      : {
          kind:
            event.type === 'click' ? 'click' : el.tagName === 'SELECT' ? 'select_option' : 'type',
          selector: dom.selector(el),
          label: dom.name(el)
        };
    chrome.runtime
      .sendMessage({ type: 'RECORD_DEMONSTRATION_EVENT', id, event: step })
      .then((r) => {
        if (!r?.active) cleanup();
      }, cleanup);
  };
  globalThis.__diggioStopRecording = cleanup;
  document.addEventListener('click', handler, true);
  document.addEventListener('input', handler, true);
  document.addEventListener('change', handler, true);
  timer = setTimeout(cleanup, 20 * 60 * 1000);
}
