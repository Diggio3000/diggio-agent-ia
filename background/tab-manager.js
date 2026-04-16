// background/tab-manager.js
// Gestione schede multiple

export class TabManager {

  static async getAllTabs() {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    return tabs.map(t => ({
      id:      t.id,
      title:   t.title?.substring(0, 60) ?? 'Senza titolo',
      url:     t.url ?? '',
      favicon: t.favIconUrl ?? '',
      active:  t.active,
      index:   t.index
    }));
  }

  static async openTab(url = 'https://www.google.com') {
    const tab = await chrome.tabs.create({ url, active: true });
    return tab.id;
  }

  static async focusTab(tabId) {
    await chrome.tabs.update(tabId, { active: true });
    const tab = await chrome.tabs.get(tabId);
    await chrome.windows.update(tab.windowId, { focused: true });
  }

  static async closeTab(tabId) {
    await chrome.tabs.remove(tabId);
  }

  static async duplicateTab(tabId) {
    const tab = await chrome.tabs.duplicate(tabId);
    return tab.id;
  }

  static async getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ?? null;
  }
}
