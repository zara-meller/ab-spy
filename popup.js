const LETTERS = 'ABCDEFGHIJKL';
const state = { tab: null, report: null };
const main = document.getElementById('main');

// ---------- turning tool jargon into plain words ----------

const COUNTRIES = {
  US: 'US', USA: 'US', UK: 'UK', GB: 'UK', IE: 'Ireland', DE: 'Germany', FR: 'France', IT: 'Italy',
  ES: 'Spain', NL: 'Netherlands', BE: 'Belgium', PL: 'Poland', SE: 'Sweden', DK: 'Denmark',
  NO: 'Norway', FI: 'Finland', AT: 'Austria', CH: 'Switzerland', PT: 'Portugal', AU: 'Australia',
  NZ: 'New Zealand', CA: 'Canada', JP: 'Japan', RU: 'Russia', BR: 'Brazil', MX: 'Mexico',
  IN: 'India', IL: 'Israel', AE: 'UAE', SA: 'Saudi Arabia', CN: 'China', KR: 'South Korea',
  SG: 'Singapore', HK: 'Hong Kong', ROE: 'Rest of Europe', ROW: 'Rest of world', EU: 'EU',
  EMEA: 'EMEA', APAC: 'APAC', LATAM: 'LATAM', COM: 'International (.com)',
};
const ALL_MARKETS = /^(GLOBAL|GBL|WW|ALL)$/;
const ABBR = {
  HP: 'Homepage', HMPG: 'Homepage', PDP: 'Product page', PLP: 'Product listing', SRP: 'Search results',
  ATC: 'Add to cart', ATB: 'Add to bag', GBL: 'global', NAV: 'navigation',
};
const KEEP_UPPER = new Set(['CTA', 'EU', 'AI', 'FAQ', 'SMS', 'UGC', 'USP', 'CRO', 'SEO', 'VIP', 'B2B', 'B2C', 'JP', 'QR']);
const SKIP_AUDIENCE = /exclu|everyone|all visitors|\bqa\b|internal|staff|employee|\bbots?\b|debug|allow ?list|block ?list|whitelist|blacklist|test(ing)? audience/i;

function brandName(r) {
  const parts = r.host.replace(/^www\./, '').split('.');
  const label = parts.length > 2 && parts[parts.length - 2].length <= 3 ? parts[parts.length - 3] : parts[parts.length - 2] || parts[0];
  // Prefer the site's own spelling from its title ("ASOS", "eBay")
  const squash = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const seg of String(r.title || '').split(/\s[|\-–—:·]\s/)) {
    if (squash(seg) === squash(label)) return seg.trim();
  }
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function cleanTestName(raw, brand) {
  const markets = [];
  if (!raw) return { name: null, markets };
  let n = String(raw).trim()
    .replace(/^\s*\[[^\]]*\]\s*/, '')                          // "[260811 Felix] "
    .replace(/^\s*[A-Z]{2,}-?\d{3,}\s*[-–—:|]?\s*/, '')       // ticket numbers: "EMF-1264915 - "
    .replace(/^\s*(web|app|mweb|dweb|desktop)\s*[-–—:|]\s*/i, '');

  const lead = n.match(/^\s*([A-Z]{2,6}(?:\s*[\/,&+]\s*[A-Z]{2,6})*)\s*[-–—:|]\s*/);
  if (lead) {
    const codes = lead[1].split(/\s*[\/,&+]\s*/);
    if (codes.every(c => COUNTRIES[c] || ALL_MARKETS.test(c))) {
      codes.forEach(c => markets.push(COUNTRIES[c] || 'All markets'));
      n = n.slice(lead[0].length);
    }
  }
  n = n.replace(/\s*[-–—|]\s*(GLOBAL|WW)\b(?=\s*[-–—|])/g, () => { markets.push('All markets'); return ''; });
  const only = n.match(/\s*[-–—]?\s*\b([A-Za-z]{2,4})\s+only\s*$/i);
  if (only && COUNTRIES[only[1].toUpperCase()]) {
    markets.push(COUNTRIES[only[1].toUpperCase()]);
    n = n.slice(0, only.index);
  }

  const letters = n.replace(/[^A-Za-z]/g, '');
  const shouting = letters.length > 6 && letters === letters.toUpperCase();
  const brandUpper = brand.toUpperCase();
  n = n.replace(/\b[A-Za-z][A-Za-z0-9]*\b/g, w => {
    if (ABBR[w]) return ABBR[w];
    if (!shouting) return w;
    return COUNTRIES[w] || KEEP_UPPER.has(w) || w === brandUpper ? w : w.toLowerCase();
  });
  n = n.replace(/\s+[-–—|]\s+/g, ' – ').replace(/\s{2,}/g, ' ').trim().replace(/^[-–—:|\s]+|[-–—:|\s]+$/g, '');
  return { name: n ? n.charAt(0).toUpperCase() + n.slice(1) : null, markets };
}

function audienceInfo(list) {
  const markets = [];
  const audiences = [];
  for (const raw of list || []) {
    const n = String(raw).trim().replace(/^[A-Z]{2,}-?\d{3,}\s*[-–—:|]\s*/, '');
    if (!n || SKIP_AUDIENCE.test(n)) continue;
    const m = n.match(/^(?:store|country|market|locale|geo|site|region)\s*[:\-]?\s*([A-Za-z]{2,4})$/i)
      || n.match(/^([A-Z]{2,4})$/)
      || n.match(/^([A-Za-z]{2,4})\s+(?:store|users|visitors|only|traffic|site)$/i);
    const code = m && m[1].toUpperCase();
    if (code && COUNTRIES[code]) markets.push(COUNTRIES[code]);
    else audiences.push(n);
  }
  return { markets, audiences };
}

const uniq = list => [...new Set(list)];

function describeTest(t, brand) {
  const named = cleanTestName(t.name, brand);
  const aud = audienceInfo(t.audiences);
  const campaign = t.campaign ? cleanTestName(t.campaign, brand).name : null;
  return {
    ...t,
    variations: t.variations.map(v => ({ ...v, texts: v.texts.slice() })),
    label: named.name, campaignLabel: campaign,
    markets: uniq([...named.markets, ...aud.markets]), audienceLabels: aud.audiences.slice(0, 3),
  };
}

// Lines only one version has are the difference, so they go first;
// lines every version shares ("Register now") go last.
function rankTexts(versions) {
  const count = new Map();
  versions.forEach(v => new Set(v.texts).forEach(s => count.set(s, (count.get(s) || 0) + 1)));
  versions.forEach(v => {
    v.texts = [...v.texts.filter(s => count.get(s) === 1), ...v.texts.filter(s => count.get(s) > 1)];
  });
}

const EUROPE = new Set(['UK', 'Ireland', 'Germany', 'France', 'Italy', 'Spain', 'Netherlands', 'Belgium', 'Poland',
  'Sweden', 'Denmark', 'Norway', 'Finland', 'Austria', 'Switzerland', 'Portugal', 'Rest of Europe', 'EU']);

function marketsText(markets) {
  if (!markets.length) return '';
  if (markets.includes('All markets')) return 'All markets';
  if (markets.length >= 4 && markets.every(m => EUROPE.has(m))) return `${markets.length} European markets`;
  if (markets.length >= 6) return `${markets.length} markets`;
  if (markets.length <= 3) return markets.join(', ');
  return `${markets.slice(0, 2).join(', ')} +${markets.length - 2} more`;
}

const GENERIC_VERSION = /^(v[\s-]*\d+|var(iation|iant)?[\s#-]*\d*|experience[\s#-]*\d+|version[\s#-]*\d+|test[\s#-]*\d*|[a-z])$/i;

function versionLabel(v, j) {
  const n = v.name || '';
  if (/\b(original|control|baseline|default)\b/i.test(n)) return 'Original';
  if (!n || GENERIC_VERSION.test(n)) return j === 0 && v.hasChanges === false ? 'Original' : 'Version ' + LETTERS[j];
  return n;
}

function emptyNote(v) {
  if (v.lazy) return 'Its changes load only for visitors who get this version.';
  if (v.hasChanges === false) return 'Shows the page as it is now.';
  if (v.hasChanges) return 'Changes the code behind the page; nothing readable to show.';
  return "Its changes aren't visible from the browser.";
}

const hasContent = v => v.notes.length || v.texts.length || v.images.length || v.links.length || v.colors.length;

// Generic notes add nothing once the specific text or link is on screen.
function visibleNotes(v) {
  return v.notes.filter(s => !(v.texts.length && s === 'Changes text')
    && !(v.links.length && /^(Sends visitors to a different page|Redirects visitors)$/.test(s)));
}

// ---------- rendering ----------

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const chip = (text, kind) => el('span', 'chip' + (kind ? ' ' + kind : ''), text);
const shortUrl = u => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

function message(title, text) {
  main.replaceChildren();
  const box = el('div', 'empty');
  box.append(el('h2', null, title));
  if (text) box.append(el('p', null, text));
  main.append(box);
  document.getElementById('copy').disabled = true;
}

function versionBody(v) {
  const body = el('div', 'var-body');
  // The copy itself comes first; "Changes text" adds nothing once the text is shown.
  const shown = v.texts.slice(0, 3);
  shown.forEach(s => body.append(el('q', 'text', s)));
  if (v.texts.length > shown.length) {
    const more = el('button', 'more', `+${v.texts.length - shown.length} more lines`);
    more.type = 'button';
    more.addEventListener('click', () => {
      v.texts.slice(3).forEach(s => more.before(el('q', 'text', s)));
      more.remove();
    });
    body.append(more);
  }
  const notes = visibleNotes(v);
  if (notes.length) {
    const ul = el('ul', 'notes');
    notes.forEach(s => ul.append(el('li', null, s)));
    body.append(ul);
  }
  if (v.colors.length) {
    const row = el('div', 'swatches');
    v.colors.forEach(c => {
      const s = el('span', 'swatch');
      s.style.background = c;
      s.title = c;
      row.append(s);
    });
    row.append(el('span', 'swatch-label', v.colors.join('  ')));
    body.append(row);
  }
  if (v.images.length) {
    const thumbs = el('div', 'thumbs');
    v.images.forEach(src => {
      const a = el('a');
      a.href = src; a.target = '_blank'; a.rel = 'noopener noreferrer'; a.title = src;
      const img = el('img');
      img.src = src; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; img.alt = 'New image in this version';
      img.onerror = () => a.remove();
      a.append(img);
      thumbs.append(a);
    });
    body.append(thumbs);
  }
  const linkRow = u => {
    const p = el('p', 'link', 'Sends visitors to ');
    const a = el('a', null, shortUrl(u));
    a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer';
    p.append(a);
    return p;
  };
  if (v.links.length) body.append(linkRow(v.links[0]));
  if (v.links.length > 1) {
    const more = el('button', 'more', `+${v.links.length - 1} more links`);
    more.type = 'button';
    more.addEventListener('click', () => {
      v.links.slice(1).forEach(u => more.before(linkRow(u)));
      more.remove();
    });
    body.append(more);
  }
  if (!hasContent(v)) body.append(el('p', 'muted', emptyNote(v)));
  return body;
}

function versionRow(label, letter, v, mine) {
  const li = el('li', 'var' + (mine ? ' mine' : ''));
  const top = el('div', 'var-top');
  top.append(el('span', 'letter', letter), el('span', 'var-name', label));
  if (v.weight != null) top.append(el('span', 'weight', Math.round(v.weight) + '%'));
  if (mine) top.append(el('span', 'you', 'You see this'));
  li.append(top, versionBody(v));
  return li;
}

function cardHead(card, title, t) {
  card.append(el('h3', title ? null : 'unnamed', title || 'Name hidden by the site'));
  const chips = el('div', 'chips');
  if (t.markets.length) {
    const c = chip('Runs in ' + marketsText(t.markets), 'market');
    c.title = t.markets.join(', ');
    chips.append(c);
  }
  t.audienceLabels.forEach(a => chips.append(chip(a, 'quiet')));
  if (t.onPage) chips.append(chip('On this page', 'live'));
  if (t.status) chips.append(chip(t.status, 'quiet'));
  chips.append(chip(t.tool, 'quiet'));
  card.append(chips);
  if (t.where.length) card.append(el('p', 'where', 'Pages: ' + t.where.join(', ')));
}

function testCard(t) {
  const card = el('article', 'card' + (t.onPage ? ' live' : ''));
  cardHead(card, t.label, t);
  const list = el('ol', 'vars');
  t.variations.forEach((v, j) => {
    const mine = t.yourVariation != null && v.id === t.yourVariation;
    list.append(versionRow(versionLabel(v, j), LETTERS[j] || '?', v, mine));
  });
  card.append(list);
  return card;
}

// Optimizely splits one personalization campaign into an experience per audience: regroup them.
function personalizationCards(items) {
  const groups = new Map();
  items.forEach(t => {
    const key = t.campaign ? t.tool + ':' + t.campaign : t.tool + ':' + t.id;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });
  return [...groups.values()].map(group => {
    const first = group[0];
    if (group.length === 1) return testCard(first);
    const card = el('article', 'card');
    const merged = { ...first, markets: uniq(group.flatMap(t => t.markets)), audienceLabels: [], onPage: group.some(t => t.onPage), where: [] };
    cardHead(card, first.campaignLabel || first.label, merged);
    const list = el('ol', 'vars');
    group.forEach((t, j) => {
      const v = t.variations[0] || { notes: [], texts: [], images: [], links: [], colors: [], hasChanges: null };
      const who = t.label || versionLabel(v, j);
      list.append(versionRow(who, LETTERS[j] || '?', v, t.yourVariation != null && v.id === t.yourVariation));
    });
    card.append(list);
    return card;
  });
}

function rolloutRow(t) {
  const li = el('li', 'rollout');
  const top = el('div', 'rollout-top');
  top.append(el('span', 'rollout-name', t.label || 'Name hidden by the site'));
  if (t.markets.length) top.append(chip(marketsText(t.markets), 'market'));
  li.append(top);
  const v = t.variations[0];
  if (v) {
    const notes = visibleNotes(v).slice(0, 2);
    const bits = [...v.texts.slice(0, 1).map(s => `“${s}”`), ...notes, ...v.links.slice(0, 1).map(u => 'Sends visitors to ' + shortUrl(u))];
    li.append(el('p', 'muted', bits.length ? bits.join(' · ') : emptyNote(v)));
  }
  return li;
}

function section(title, intro, count, open) {
  const d = el('details', 'section');
  d.open = open;
  const s = el('summary');
  s.append(el('span', 'section-title', title), el('span', 'section-count', String(count)));
  d.append(s);
  if (intro) d.append(el('p', 'section-intro', intro));
  return d;
}

function split(r) {
  const brand = brandName(r);
  const all = r.tests.map(t => describeTest(t, brand));
  const campaigns = new Map();
  all.forEach(t => {
    if (t.kind !== 'personalization' || !t.campaign) return rankTexts(t.variations);
    const key = t.tool + ':' + t.campaign;
    campaigns.set(key, [...(campaigns.get(key) || []), ...t.variations]);
  });
  campaigns.forEach(rankTexts);
  return {
    brand,
    tests: all.filter(t => t.kind === 'test'),
    personal: all.filter(t => t.kind === 'personalization'),
    rollouts: all.filter(t => t.kind === 'rollout'),
  };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function render(r) {
  state.report = r;
  main.replaceChildren();
  const readable = r.tools.filter(t => t.readable);
  const hidden = r.tools.filter(t => !t.readable);

  if (!r.tests.length) {
    if (!r.tools.length) {
      return message('No testing tools on this page', 'Try a big brand’s homepage, pricing or checkout page. Tools load late, so give a fresh page a few seconds.');
    }
    if (readable.length) message(`${readable.map(t => t.name).join(', ')} is installed`, 'But nothing is running right now.');
    else message(`This site tests with ${hidden.map(t => t.name).join(', ')}`, 'That tool picks versions on its servers, so they can’t be read from the browser.');
    document.getElementById('copy').disabled = false;
    return;
  }

  const { brand, tests, personal, rollouts } = split(r);

  // Summary: the answer to "what is this brand testing?"
  const sum = el('section', 'summary');
  sum.append(el('h2', null, tests.length
    ? `${brand} is testing ${plural(tests.length, 'thing', 'things')} right now`
    : `${brand} isn’t running any A/B tests right now`));
  if (tests.length) {
    const ul = el('ul', 'summary-list');
    tests.slice(0, 5).forEach(t => {
      const li = el('li');
      li.append(el('span', null, t.label || 'Unnamed test'));
      if (t.markets.length) li.append(el('span', 'summary-market', ' · ' + marketsText(t.markets)));
      ul.append(li);
    });
    if (tests.length > 5) ul.append(el('li', 'muted', `and ${tests.length - 5} more`));
    sum.append(ul);
  }
  const also = [];
  if (personal.length) also.push(plural(personal.length, 'personalized experience', 'personalized experiences'));
  if (rollouts.length) also.push(plural(rollouts.length, 'change shipped without a test', 'changes shipped without a test'));
  if (also.length) sum.append(el('p', 'summary-also', (tests.length ? 'Also: ' : 'It has ') + also.join(' · ')));
  const tools = el('p', 'summary-tools', 'Found in ' + readable.map(t => t.name).join(', ')
    + (hidden.length ? `. Also uses ${hidden.map(t => t.name).join(', ')}, which can’t be read.` : ''));
  sum.append(tools);
  main.append(sum);

  if (tests.length) {
    const s = section('A/B tests', 'Visitors are split between these versions to see which one performs better.', tests.length, true);
    tests.forEach(t => s.append(testCard(t)));
    main.append(s);
  }
  if (personal.length) {
    const s = section('Personalized content', 'Different content for different visitors. Not a test: everyone in an audience sees the same thing.', personal.length, !tests.length);
    personalizationCards(personal).forEach(c => s.append(c));
    main.append(s);
  }
  if (rollouts.length) {
    const s = section('Shipped without a test', 'One version for everyone, released through the testing tool. Usually fixes, launches, or tests that already won.', rollouts.length, !tests.length && !personal.length);
    const ul = el('ul', 'rollouts');
    rollouts.forEach(t => ul.append(rolloutRow(t)));
    s.append(ul);
    main.append(s);
  }
  main.append(el('p', 'note', 'Read from the code this site sends to every visitor. Nothing leaves your browser.'));
  document.getElementById('copy').disabled = false;
}

function versionLine(label, v, mine) {
  const bits = [
    ...v.texts.map(s => `"${s}"`),
    ...visibleNotes(v),
    ...v.colors.map(c => `colour ${c}`),
    ...v.images.map(u => `image: ${u}`),
    ...v.links.map(u => `sends visitors to ${u}`),
  ];
  const weight = v.weight != null ? ` ${Math.round(v.weight)}%` : '';
  return `${label}${weight}${mine ? ' [you see this]' : ''}: ${bits.length ? bits.join(' · ') : emptyNote(v)}`;
}

function reportText(r) {
  const { brand, tests, personal, rollouts } = split(r);
  const date = new Date(r.scannedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const where = t => (t.markets.length ? ` [${marketsText(t.markets)}]` : '');
  const lines = [`What ${brand} is testing (${date})`, r.url, ''];
  if (tests.length) {
    lines.push(`A/B TESTS (${tests.length})`);
    tests.forEach((t, i) => {
      lines.push(`${i + 1}. ${t.label || 'Name hidden'}${where(t)}`);
      t.variations.forEach((v, j) => lines.push(`   ${LETTERS[j]}. ${versionLine(versionLabel(v, j), v, t.yourVariation != null && v.id === t.yourVariation)}`));
    });
    lines.push('');
  }
  if (personal.length) {
    lines.push(`PERSONALIZED CONTENT (${personal.length})`);
    personal.forEach(t => {
      const head = t.campaignLabel ? `${t.campaignLabel}: ${t.label}` : t.label || 'Name hidden';
      lines.push(`- ${head}${where(t)}`);
      t.variations.forEach(v => lines.push(`   ${versionLine('Shows', v, false)}`));
    });
    lines.push('');
  }
  if (rollouts.length) {
    lines.push(`SHIPPED WITHOUT A TEST (${rollouts.length})`);
    rollouts.forEach(t => {
      const v = t.variations[0];
      lines.push(`- ${t.label || 'Name hidden'}${where(t)}${v ? ': ' + versionLine('', v, false).replace(/^: /, '') : ''}`);
    });
    lines.push('');
  }
  const hidden = r.tools.filter(t => !t.readable).map(t => t.name);
  if (hidden.length) lines.push(`Also uses: ${hidden.join(', ')} (decides on its servers, not readable)`);
  return lines.join('\n').trim();
}

// ---------- wiring ----------

async function rescan() {
  const id = state.tab.id;
  try {
    await chrome.tabs.sendMessage(id, { type: 'rescan' });
  } catch {
    // Page was open before the extension was installed: inject now.
    try {
      await chrome.scripting.executeScript({ target: { tabId: id }, files: ['bridge.js'] });
      await chrome.scripting.executeScript({ target: { tabId: id }, files: ['detector.js'], world: 'MAIN' });
      await chrome.tabs.sendMessage(id, { type: 'rescan' }).catch(() => {});
    } catch {
      message('Can’t read this page', 'Chrome doesn’t let extensions look inside this page.');
    }
  }
}

document.getElementById('rescan').addEventListener('click', () => {
  if (state.tab) rescan();
});

document.getElementById('copy').addEventListener('click', async e => {
  if (!state.report) return;
  await navigator.clipboard.writeText(reportText(state.report));
  e.target.textContent = 'Copied';
  setTimeout(() => { e.target.textContent = 'Copy report'; }, 1400);
});

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  state.tab = tab;
  if (!tab || !/^https?:/.test(tab.url || '')) {
    document.getElementById('rescan').disabled = true;
    return message('Open a website', 'A/B Spy looks for live tests on regular web pages.');
  }
  document.getElementById('host').textContent = new URL(tab.url).hostname.replace(/^www\./, '');

  const key = 'tab_' + tab.id;
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes[key] && changes[key].newValue) render(changes[key].newValue);
  });
  const stored = (await chrome.storage.session.get(key))[key];
  if (stored) render(stored);
  else {
    message('Looking for tests…', '');
    rescan();
  }
})();
