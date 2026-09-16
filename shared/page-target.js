// Eseguita nel mondo ISOLATED dell'estensione. Deve restare autosufficiente.
export function pageTarget(operation, query = {}, value = '') {
  const interactive =
    'a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[role=combobox],[role=checkbox],[role=radio],[role=option],[contenteditable=true],summary';
  function roots(root = document) {
    const result = [root];
    for (const el of root.querySelectorAll('*'))
      if (el.shadowRoot) result.push(...roots(el.shadowRoot));
    return result;
  }
  function all(selector) {
    const parts = selector.split('>>>').map((s) => s.trim());
    let found = roots().flatMap((r) => [...r.querySelectorAll(parts[0])]);
    for (const part of parts.slice(1))
      found = found.flatMap((el) =>
        el.shadowRoot ? [...el.shadowRoot.querySelectorAll(part)] : []
      );
    return [...new Set(found)];
  }
  function sensitive(el) {
    return el.type === 'password' || /password|cc-|one-time-code/i.test(el.autocomplete || '');
  }
  function name(el) {
    const labels = [...(el.labels || [])].map((l) => l.textContent).join(' ');
    const labelled = (el.getAttribute('aria-labelledby') || '')
      .split(/\s+/)
      .map((id) => el.getRootNode().getElementById?.(id)?.textContent || '')
      .join(' ');
    return (
      el.getAttribute('aria-label') ||
      labelled.trim() ||
      labels ||
      el.placeholder ||
      el.title ||
      (!['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && !el.isContentEditable
        ? el.textContent
        : '') ||
      el.name ||
      el.type ||
      el.tagName
    )
      .trim()
      .replace(/\s+/g, ' ')
      .slice(0, 100);
  }
  function selector(el) {
    const root = el.getRootNode();
    const choices = [
      el.id ? '#' + CSS.escape(el.id) : '',
      ...['data-testid', 'name', 'aria-label'].map((key) =>
        el.getAttribute(key)
          ? el.tagName.toLowerCase() + '[' + key + '=' + JSON.stringify(el.getAttribute(key)) + ']'
          : ''
      )
    ];
    let css = choices.find((s) => s && root.querySelectorAll(s).length === 1);
    if (!css) {
      const path = [];
      let current = el;
      while (current?.nodeType === 1) {
        const siblings = [...(current.parentNode?.children || [])].filter(
          (e) => e.tagName === current.tagName
        );
        path.unshift(
          current.tagName.toLowerCase() + ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')'
        );
        if (root.querySelectorAll(path.join(' > ')).length === 1) break;
        current = current.parentElement;
      }
      css = path.join(' > ');
    }
    return root.host ? selector(root.host) + ' >>> ' + css : css;
  }
  function visible(el) {
    const r = el.getBoundingClientRect(),
      s = getComputedStyle(el);
    return (
      el.isConnected &&
      r.width > 0 &&
      r.height > 0 &&
      s.visibility !== 'hidden' &&
      s.display !== 'none' &&
      s.opacity !== '0'
    );
  }
  function fingerprint(el) {
    return [el.tagName, el.type, name(el), el.getAttribute('href'), el.getAttribute('role')].join(
      '|'
    );
  }
  function point(el) {
    const r = el.getBoundingClientRect();
    const l = Math.max(0, r.left),
      t = Math.max(0, r.top),
      right = Math.min(innerWidth, r.right),
      bottom = Math.min(innerHeight, r.bottom);
    if (right <= l || bottom <= t) return null;
    for (const [fx, fy] of [
      [0.5, 0.5],
      [0.25, 0.5],
      [0.75, 0.5],
      [0.5, 0.25],
      [0.5, 0.75]
    ]) {
      const x = l + (right - l) * fx,
        y = t + (bottom - t) * fy;
      let hit = document.elementFromPoint(x, y);
      while (hit?.shadowRoot) {
        const deeper = hit.shadowRoot.elementFromPoint(x, y);
        if (!deeper || deeper === hit) break;
        hit = deeper;
      }
      for (let current = hit; current; current = current.parentNode || current.host)
        if (current === el) return { x, y };
    }
    return null;
  }
  globalThis.__diggioDom = { selector, name, sensitive };
  if (operation === 'editor' || operation === 'checkEditor' || operation === 'keyGuard') {
    let el = document.activeElement;
    for (let depth = 0; depth < 20 && el; depth++) {
      const shadow = el.shadowRoot?.activeElement;
      let frame = null;
      try {
        if (el.tagName === 'IFRAME') frame = el.contentDocument?.activeElement;
      } catch {}
      if (!shadow && !frame) break;
      el = shadow || frame;
    }
    if (operation === 'keyGuard')
      return el && (sensitive(el) || el.tagName === 'IFRAME') && !['Tab', 'Escape'].includes(query.key)
        ? { ok: false, error: 'La tastiera nei campi riservati o nei frame non verificabili resta sotto il controllo dell’utente.' }
        : { ok: true };
    const editable = el && (el.isContentEditable || ['TEXTAREA', 'INPUT'].includes(el.tagName));
    if (
      !editable ||
      el.readOnly ||
      el.disabled ||
      sensitive(el) ||
      (el.tagName === 'INPUT' &&
        !['text', 'search', 'url', 'email', 'tel', 'number'].includes(el.type))
    )
      return {
        ok: false,
        error:
          'Nessun editor di testo modificabile attivo. Seleziona il campo o entra in modifica, poi usa read_editor.'
      };
    if (operation === 'checkEditor') {
      const previous = globalThis.__diggioEditor;
      if (
        !previous ||
        previous.el !== el ||
        previous.token !== query.target ||
        previous.url !== location.href ||
        Date.now() - previous.time > 120000 ||
        previous.fingerprint !== fingerprint(el)
      )
        return {
          ok: false,
          error:
            'Il focus dell’editor è cambiato o scaduto: usa di nuovo read_editor prima di inserire testo.'
        };
      return { ok: true };
    }
    const token = crypto.randomUUID();
    globalThis.__diggioEditor = {
      el,
      token,
      url: location.href,
      time: Date.now(),
      fingerprint: fingerprint(el)
    };
    return {
      ok: true,
      target: token,
      name: name(el),
      tag: el.tagName,
      role: el.getAttribute('role'),
      text: String(el.isContentEditable ? el.innerText : el.value).slice(0, 4000),
      note: 'Testo dell’editor attivo: può essere soltanto una cella o un controllo di input, non l’intero documento.'
    };
  }
  if (operation === 'install') return true;
  if (operation === 'unmark') {
    document.querySelectorAll('.diggio-som').forEach((el) => el.remove());
    return true;
  }
  if (operation === 'mask') {
    globalThis.__diggioMasked = all('input')
      .filter(sensitive)
      .map((el) => [
        el,
        el.style.getPropertyValue('visibility'),
        el.style.getPropertyPriority('visibility')
      ]);
    for (const [el] of globalThis.__diggioMasked)
      el.style.setProperty('visibility', 'hidden', 'important');
    return true;
  }
  if (operation === 'unmask') {
    for (const [el, style, priority] of globalThis.__diggioMasked || []) {
      if (style) el.style.setProperty('visibility', style, priority);
      else el.style.removeProperty('visibility');
    }
    globalThis.__diggioMasked = [];
    return true;
  }
  if (operation === 'mark') {
    document.querySelectorAll('.diggio-som').forEach((el) => el.remove());
    const entries = all(interactive)
      .filter((el) => !sensitive(el) && visible(el) && point(el))
      .slice(0, 120);
    globalThis.__diggioTargets = {
      url: location.href,
      time: Date.now(),
      entries: entries.map((el) => ({ el, fingerprint: fingerprint(el) }))
    };
    return (
      entries
        .map((el, i) => {
          const r = el.getBoundingClientRect();
          const badge = document.createElement('div');
          badge.className = 'diggio-som';
          badge.textContent = i + 1;
          badge.style.cssText = `position:fixed;left:${Math.max(0, r.left)}px;top:${Math.max(0, r.top - 14)}px;background:#2364dd;color:white;font:bold 11px/16px monospace;padding:0 4px;border-radius:3px;z-index:2147483647;pointer-events:none`;
          document.documentElement.append(badge);
          return `[${i + 1}] <${el.tagName.toLowerCase()}> ${name(el)}${el.disabled || el.getAttribute('aria-disabled') === 'true' ? ' [disabilitato]' : ''} · ${selector(el)}`;
        })
        .join('\n')
        .slice(0, 10000) || 'Nessun elemento interattivo visibile.'
    );
  }
  if (operation === 'coords') {
    if (
      !Number.isFinite(query.x) ||
      !Number.isFinite(query.y) ||
      query.x < 0 ||
      query.y < 0 ||
      query.x >= innerWidth ||
      query.y >= innerHeight
    )
      return {
        ok: false,
        error: 'Coordinate fuori dalla viewport. Acquisisci uno screenshot aggiornato.'
      };
    return { ok: true };
  }
  let candidates;
  if (query.mark) {
    const m = globalThis.__diggioTargets;
    const entry = m?.entries[query.mark - 1];
    if (
      !m ||
      m.url !== location.href ||
      Date.now() - m.time > 120000 ||
      !entry?.el.isConnected ||
      fingerprint(entry.el) !== entry.fingerprint
    )
      return {
        ok: false,
        fatal: true,
        error: 'Elemento numerato cambiato o scaduto: richiama mark_page.'
      };
    candidates = [entry.el];
  } else if (query.text) {
    const text = query.text.trim().toLocaleLowerCase();
    const available = all(interactive).filter(visible);
    const exact = available.filter((el) => name(el).toLocaleLowerCase() === text);
    candidates = exact.length
      ? exact
      : available.filter((el) => name(el).toLocaleLowerCase().includes(text));
  } else {
    try {
      candidates = all(query.selector);
    } catch {
      return { ok: false, fatal: true, error: 'Selettore non valido.' };
    }
  }
  const matches = candidates.filter(visible);
  if (operation === 'presence')
    return { ok: true, visible: matches.length > 0, count: matches.length };
  if (matches.length !== 1)
    return {
      ok: false,
      fatal: matches.length > 1,
      error: matches.length
        ? 'Elemento ambiguo: usa un selettore o numero univoco.'
        : 'Campo assente o elemento non visibile.'
    };
  const el = matches[0];
  if (el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('[inert]'))
    return { ok: false, error: 'Elemento disabilitato.' };
  if (sensitive(el))
    return { ok: false, fatal: true, error: 'Compila manualmente questo campo riservato.' };
  if (operation === 'prepare')
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
  const p = point(el);
  if (!p)
    return {
      ok: false,
      error: 'Elemento coperto o fuori dalla viewport. Verifica popup e sovrapposizioni.'
    };
  if (operation === 'focus') {
    if (el.readOnly || (!['INPUT', 'TEXTAREA'].includes(el.tagName) && !el.isContentEditable))
      return { ok: false, fatal: true, error: 'Campo non modificabile.' };
    el.focus();
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    if (active !== el)
      return { ok: false, fatal: true, error: 'Focus non ottenuto: nessun testo inserito.' };
    if (el.isContentEditable) el.textContent = '';
    else
      Object.getOwnPropertyDescriptor(
        el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
        'value'
      ).set.call(el, '');
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  }
  if (operation === 'verifyText') {
    if ((el.isContentEditable ? el.textContent : el.value) !== value)
      return {
        ok: false,
        fatal: true,
        error: 'Il campo non contiene il testo atteso. Osserva la pagina prima di riprovare.'
      };
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }
  if (operation === 'focused') {
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    if (active !== el)
      return { ok: false, fatal: true, error: 'Il focus è cambiato: testo non inserito.' };
  }
  if (operation === 'select') {
    if (el.tagName !== 'SELECT')
      return { ok: false, fatal: true, error: 'Il campo non è un select.' };
    const options = [...el.options].filter(
      (o) => !o.disabled && (o.value === value || o.text === value)
    );
    if (options.length !== 1)
      return { ok: false, fatal: true, error: 'Opzione assente o ambigua.' };
    el.value = options[0].value;
    el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  }
  return { ok: true, ...p, fingerprint: fingerprint(el), description: name(el) };
}
