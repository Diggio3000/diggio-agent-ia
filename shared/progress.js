const OBSERVATIONS = new Set(['plan', 'read_page', 'read_accessibility', 'read_editor', 'get_url',
  'get_links', 'screenshot', 'zoom', 'mark_page', 'read_console', 'read_network', 'list_tabs', 'dismiss_popups']);

export class ProgressGuard {
  constructor() { this.reset(); }
  reset() { this.recent = []; }
  record(action, params, result) {
    if (!OBSERVATIONS.has(action)) { this.reset(); return null; }
    // I token dell’editor cambiano a ogni lettura, senza indicare un cambiamento della pagina.
    const text = JSON.stringify([action, params, result.text, result.screenshot || ''])
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[target]');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    this.recent.push(hash);
    this.recent = this.recent.slice(-16);
    const count = this.recent.filter((value) => value === hash).length;
    return count >= 5 ? 'pause' : count === 3 ? 'warn' : null;
  }
}
