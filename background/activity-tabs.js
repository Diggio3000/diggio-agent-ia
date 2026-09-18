// La proprietà delle schede vale solo nella sessione corrente del browser.
// Non ripristinare ID dallo storage locale: dopo un riavvio potrebbero essere riutilizzati.
const KEY = 'activityTabsByConversation';

export async function loadActivityTabs(conversationId, selectedTabId) {
  const registry = (await chrome.storage.session.get(KEY))[KEY] || {};
  const ids = new Set([...(registry[conversationId] || []), selectedTabId]);
  const existing = await Promise.all([...ids].map(async (id) => {
    if (!Number.isSafeInteger(id) || id < 1) return null;
    return chrome.tabs.get(id).then(() => id, () => null);
  }));
  return new Set(existing.filter((id) => id !== null));
}

export async function saveActivityTabs(conversationId, tabIds) {
  const registry = (await chrome.storage.session.get(KEY))[KEY] || {};
  delete registry[conversationId];
  registry[conversationId] = [...tabIds];
  await chrome.storage.session.set({ [KEY]: Object.fromEntries(Object.entries(registry).slice(-30)) });
}
