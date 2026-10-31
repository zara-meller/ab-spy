// Keeps the latest report per tab and shows the test count on the icon.
const BADGE = '#7A1F2B';
const key = tabId => 'tab_' + tabId;

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'report' || !sender.tab || sender.frameId !== 0) return;
  const tabId = sender.tab.id;
  const r = msg.report;
  chrome.storage.session.set({ [key(tabId)]: r });

  // The number counts real A/B tests only; rollouts and personalization show as a dot.
  const n = r.tests.filter(t => t.kind === 'test').length;
  const text = n ? String(n > 99 ? '99+' : n) : r.tests.length || r.tools.length ? '•' : '';
  chrome.action.setBadgeBackgroundColor({ tabId, color: BADGE });
  chrome.action.setBadgeText({ tabId, text });
  chrome.action.setTitle({
    tabId,
    title: n ? `A/B Spy: ${n} A/B test${n === 1 ? '' : 's'} running on this site`
      : r.tools.length ? `A/B Spy: uses ${r.tools.map(t => t.name).join(', ')}` : 'A/B Spy',
  });
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading' && info.url) chrome.storage.session.remove(key(tabId));
});

chrome.tabs.onRemoved.addListener(tabId => chrome.storage.session.remove(key(tabId)));
