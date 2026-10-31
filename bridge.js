// Passes reports from detector.js (page world) to the extension, and rescan
// requests from the popup back to the page.
(() => {
  if (window.__abSpyBridge) return;
  window.__abSpyBridge = true;

  window.addEventListener('message', e => {
    if (e.source !== window || !e.data || e.data.__abSpy !== 'report') return;
    try {
      chrome.runtime.sendMessage({ type: 'report', report: e.data.report }).catch(() => {});
    } catch { /* extension was reloaded; this page has the old bridge */ }
  });

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg && msg.type === 'rescan') {
      window.postMessage({ __abSpy: 'rescan' }, '*');
      sendResponse({ ok: true });
    }
  });
})();
