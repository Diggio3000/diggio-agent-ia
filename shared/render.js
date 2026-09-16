export function esc(value = '') {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
  );
}
function inline(text) {
  const tokens = [];
  const stash = (html) => `\u0000${tokens.push(html) - 1}\u0000`;
  let value = String(text).replace(/`([^`]+)`/g, (_, code) => stash(`<code>${esc(code)}</code>`));
  value = value.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>\u0000]+)/g,
    (_, label, url, bare) => {
      const href = url || bare;
      return stash(
        `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label || href)}</a>`
      );
    }
  );
  return esc(value)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\u0000(\d+)\u0000/g, (_, i) => tokens[Number(i)]);
}
export function renderText(raw = '') {
  if (raw == null || raw === '') return '';
  const parts = String(raw ?? '').split(/```[^\n]*\n([\s\S]*?)```/g);
  return parts
    .map((part, index) => {
      if (index % 2) return `<pre><code>${esc(part)}</code></pre>`;
      const lines = part.split('\n');
      const output = [];
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('|') && /^\s*\|?\s*:?-{3}/.test(lines[i + 1] || '')) {
          const cells = (s) =>
            s
              .trim()
              .replace(/^\||\|$/g, '')
              .split('|')
              .map((x) => x.trim());
          const head = cells(line);
          i += 2;
          const rows = [];
          while (i < lines.length && lines[i].includes('|')) rows.push(cells(lines[i++]));
          i--;
          output.push(
            '<div class="table-scroll"><table><thead><tr>' +
              head.map((x) => '<th>' + inline(x) + '</th>').join('') +
              '</tr></thead><tbody>' +
              rows
                .map(
                  (row) => '<tr>' + row.map((x) => '<td>' + inline(x) + '</td>').join('') + '</tr>'
                )
                .join('') +
              '</tbody></table></div>'
          );
        } else if (/^#{1,3} /.test(line))
          output.push('<h3>' + inline(line.replace(/^#{1,3} /, '')) + '</h3>');
        else if (/^[-•] /.test(line))
          output.push('<div class="list-line">• ' + inline(line.slice(2)) + '</div>');
        else output.push(line ? '<div>' + inline(line) + '</div>' : '<br>');
      }
      return output.join('');
    })
    .join('');
}
export function csvCell(value) {
  let text = String(value ?? '');
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
