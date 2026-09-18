// Solo controlli visibili della pagina; nessuna API Google o stato interno dell’editor.
export function workspaceState() {
  if (location.hostname !== 'docs.google.com' || !location.pathname.startsWith('/spreadsheets/d/')) return null;
  const visible = (el) => {
    const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
  };
  const clean = (text) => String(text || '').replace(/[\u200b\ufeff]/g, '').slice(0, 3000);
  const fields = [...document.querySelectorAll('.cell-input')].filter(visible);
  return {
    application: 'Google Fogli',
    range: document.querySelector('#t-name-box')?.value || '',
    formulaBar: clean(fields.find((el) => !el.classList.contains('editable'))?.textContent),
    focusedEditor: fields.includes(document.activeElement) ? clean(document.activeElement.textContent) : null,
    saveStatus: [...document.querySelectorAll('[aria-label]')].map((el) => el.getAttribute('aria-label'))
      .find((label) => /^(Stato del documento|Document status):/.test(label)) || '',
    note: 'La barra formula riguarda la selezione, il testo a fuoco può essere una bozza. Dopo Enter rileggi la cella richiesta. Questa lettura non verifica tutte le celle né un grafico.'
  };
}
