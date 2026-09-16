import { usageIdentity, mergeUsage } from '../shared/usage.js';
let queue = Promise.resolve();
export function recordUsage(config, report) {
  const write = queue
    .catch(() => {})
    .then(async () => {
      const identity = await usageIdentity(config);
      const { providerUsage = [] } = await chrome.storage.local.get('providerUsage');
      await chrome.storage.local.set({
        providerUsage: mergeUsage(providerUsage, identity, report)
      });
    });
  queue = write;
  return write;
}
