// A/B Spy detector. Runs in the page's own JS world so it can read the
// globals that testing tools (Optimizely, VWO, Convert...) put on the page,
// turns their test configs into readable versions, and posts a report to
// bridge.js. Nothing is sent anywhere else.
(() => {
  if (window.__abSpyDetector) return;
  window.__abSpyDetector = true;

  const LIMITS = { tests: 60, variations: 12, texts: 12, images: 4, links: 4, notes: 4, colors: 4, nodes: 4000 };
  const NOISE = new Set(['original', 'control', 'variation', 'default', 'revert', 'true', 'false',
    'none', 'null', 'undefined', 'website', 'reference']);

  // ---------- pulling readable copy out of test configs ----------

  const newAcc = () => ({
    texts: [], images: [], links: [], notes: [], colors: [],
    seen: new WeakSet(), budget: LIMITS.nodes, lazy: false,
  });

  function pushUnique(list, v, max) {
    if (list.length < max && !list.includes(v)) list.push(v);
  }

  const note = (acc, s) => pushUnique(acc.notes, s, LIMITS.notes);

  function humanText(s) {
    if (typeof s !== 'string') return null;
    s = s.replace(/\s+/g, ' ').trim();
    if (s.length < 3 || s.length > 280) return null;
    if (NOISE.has(s.toLowerCase())) return null;
    if (/^(https?:)?\/\//i.test(s) || /^data:/i.test(s)) return null;
    if (/[{};<>=`$\\|]|=>|&&/.test(s)) return null;
    if (/\b(function|var|let|const|return|document|window|undefined|px|rem|rgba?|important|nth-child|querySelector)\b/.test(s)) return null;
    if (/^[.#\[:@]/.test(s) || / > |::?(before|after|hover|focus)\b/.test(s)) return null;
    if (/^[a-z-]+\s*:\s*\S/.test(s)) return null; // css declaration
    const words = s.split(' ');
    if (words.some(w => /--|__/.test(w))) return null; // BEM class names
    if (words.every(w => /^[a-z0-9]+(-[a-z0-9]+)+-?$/.test(w))) return null; // class lists
    if (words.some(w => (w.match(/[a-z][A-Z]/g) || []).length > 1)) return null; // camelCaseIdentifiers
    if (!/\s/.test(s)) {
      // one word only counts if it reads like a word, not a class name or key
      if (s.length > 24) return null;
      if (!/^\p{Lu}\p{Ll}+[!?.]?$/u.test(s) && !/[^\x00-\x7F]/.test(s)) return null;
    }
    const letters = (s.match(/\p{L}/gu) || []).length;
    if (letters < 3 || letters / s.length < 0.55) return null;
    return s;
  }

  function addText(acc, s, fromCode) {
    const t = humanText(s);
    if (!t) return;
    // Strings inside code are often labels or log text; real copy is usually
    // capitalised, punctuated or in another script.
    if (fromCode && !/\p{Lu}|[.!?…]$|[^\x00-\x7F]/u.test(t)) return;
    pushUnique(acc.texts, t, LIMITS.texts);
  }

  function addUrl(acc, u, hint) {
    if (typeof u !== 'string') return;
    u = u.trim();
    try { u = new URL(u, location.href).href; } catch { return; }
    if (!/^https?:\/\//i.test(u) || u.length > 600) return;
    if (/^https?:\/\/(www\.)?w3\.org\//i.test(u)) return; // SVG/XML namespaces
    if (/\.(js|mjs|css|woff2?|ttf|otf|json|map)(\?|#|$)/i.test(u)) return;
    if (hint === 'image' || /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i.test(u)) pushUnique(acc.images, u, LIMITS.images);
    else pushUnique(acc.links, u, LIMITS.links);
  }

  // ---------- describing changes in plain words ----------

  const COLOR = /(?:^|[\s;{"'])(background(?:-color)?|color|border-color|fill)\s*:\s*(#[0-9a-f]{3,8}\b|rgba?\([^)]*\))/gi;

  function describeCss(css, acc) {
    if (typeof css !== 'string' || !css) return;
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(css)) note(acc, 'Hides part of the page');
    if (/background(-color)?\s*:\s*(#|rgb)/i.test(css)) note(acc, 'Changes a background colour');
    else if (/(^|[\s;{])color\s*:\s*(#|rgb)/i.test(css)) note(acc, 'Changes a text colour');
    if (/font-(size|weight|family)\s*:/i.test(css)) note(acc, 'Changes the typography');
    if (/(^|[\s;{-])(margin|padding|gap|height|width)\s*:/i.test(css)) note(acc, 'Changes spacing or layout');
    for (const m of css.matchAll(COLOR)) pushUnique(acc.colors, m[2].toLowerCase(), LIMITS.colors);
  }

  // VWO's visual editor leaves the operation name in a debug comment.
  const VWO_OPS = {
    changeSRC: 'Swaps an image', changeImage: 'Swaps an image',
    editElement: 'Edits part of the page', addElement: 'Adds new content', content: 'Adds new content',
    deleteElement: 'Removes something', removeElement: 'Removes something', hideElement: 'Hides something',
    moveElement: 'Moves something', rearrange: 'Moves something',
    editHTML: 'Changes text', changeText: 'Changes text', editText: 'Changes text',
    changeURL: 'Changes a link', changeHref: 'Changes a link', editLink: 'Changes a link',
  };

  function describeCode(code, acc) {
    for (const m of code.matchAll(/vwo_debug\s+log\(\s*["'](\w+)["']/g)) if (VWO_OPS[m[1]]) note(acc, VWO_OPS[m[1]]);
    if (/location\.(href\s*=|replace\(|assign\()|window\.location\s*=/.test(code)) note(acc, 'Redirects visitors');
    if (/\.remove\(\)|\.hide\(\)|\.removeChild\(|display\s*=\s*['"]none/.test(code)) note(acc, 'Hides or removes something');
    if (/\.(innerHTML|textContent|innerText)\s*=|\.text\(\s*['"`]|\.html\(\s*['"`]/.test(code)) note(acc, 'Changes text');
    if (/insertAdjacentHTML|\.append(Child)?\(|\.prepend\(|insertBefore|createElement\(\s*['"](div|p|span|a|section|button|img)/.test(code)) note(acc, 'Adds new content');
    if (/\.src\s*=|setAttribute\(\s*['"]src/.test(code)) note(acc, 'Swaps an image');
    if (/classList\.(add|remove|toggle)|addClass\(|removeClass\(|addedClasses/.test(code)) note(acc, 'Restyles part of the page');
    if (/createElement\(\s*['"]script/.test(code)) note(acc, 'Loads an outside script');
    describeCss(code, acc);
  }

  const cssFromObject = o => Object.entries(o || {}).map(([k, v]) => `${k}: ${v};`).join(' ');

  // Structured changes from Optimizely, Convert and AB Tasty carry a type.
  function describeChange(o, acc) {
    const type = String(o.type || '');
    const a = o.attributes && typeof o.attributes === 'object' ? o.attributes : {};
    if (/^attribute$/i.test(type)) {
      if (a.remove || a.hide) note(acc, 'Hides or removes something');
      if (a.html != null || a.text != null) note(acc, 'Changes text');
      if (a.src) note(acc, 'Swaps an image');
      if (a.href) note(acc, 'Changes a link');
      if (a.class) note(acc, 'Restyles part of the page');
      if (typeof a.style === 'string') describeCss(a.style, acc);
      if (o.css && typeof o.css === 'object') describeCss(cssFromObject(o.css), acc);
      if (o.rearrange) note(acc, 'Moves something');
    } else if (/redirect/i.test(type)) {
      note(acc, 'Sends visitors to a different page');
    } else if (/^(append|insert_html|insert_image|addElement)$/i.test(type)) {
      const v = typeof o.value === 'string' ? o.value : '';
      if (/^\s*<style[\s>]/i.test(v) && !/<\/style>\s*\S/i.test(v)) describeCss(v, acc);
      else note(acc, 'Adds new content');
    } else if (/^widget$/i.test(type)) {
      const name = String(o.name || '');
      const cfg = o.config && typeof o.config === 'object' ? o.config : {};
      if (/analytics|tracking|integration|tag/i.test(name)) return;
      if (/hide|move/i.test(name) && cfg.hideOrMove) {
        const what = typeof cfg.select_component === 'string' ? cfg.select_component : 'a section';
        const target = String(cfg.targetLink || '').split('|').pop();
        // Sites often build both versions into the page and hide one of them.
        if (cfg.hideOrMove === 'hide' && /control/i.test(target)) note(acc, `Shows the new ${what} instead of the current one`);
        else if (cfg.hideOrMove === 'hide' && /variant/i.test(target)) note(acc, `Keeps the current ${what}, hides the new one`);
        else {
          const which = /^[a-z0-9-]{3,24}$/i.test(target) ? ` (${target})` : '';
          note(acc, `${cfg.hideOrMove === 'hide' ? 'Hides' : 'Moves'} the ${what}${which}`);
        }
      } else if (name) {
        note(acc, `Uses the “${name}” template`);
      }
    } else if (/^(editText|editHTML)$/i.test(type)) {
      note(acc, 'Changes text');
    } else if (/^(hide|hideElement|remove)$/i.test(type)) {
      note(acc, 'Hides or removes something');
    } else if (/^(editStyle|addCSS)$/i.test(type)) {
      note(acc, 'Restyles part of the page');
    }
    if (typeof o.css === 'string') describeCss(o.css, acc);
    if (o.data && typeof o.data === 'object' && typeof o.data.css === 'string') describeCss(o.data.css, acc);
  }

  let parser = null;
  function harvestHtml(html, acc) {
    let doc;
    try {
      parser = parser || new DOMParser();
      doc = parser.parseFromString(html, 'text/html'); // inert: no scripts run, nothing loads
    } catch { return; }
    doc.querySelectorAll('style').forEach(s => describeCss(s.textContent, acc));
    doc.querySelectorAll('[style]').forEach(e => describeCss(e.getAttribute('style'), acc));
    doc.querySelectorAll('script,style,noscript,template').forEach(n => n.remove());
    const walker = doc.createTreeWalker(doc.body || doc, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode()) && acc.budget-- > 0) addText(acc, n.nodeValue);
    doc.querySelectorAll('[alt],[title],[placeholder],[aria-label]').forEach(e => {
      for (const a of ['alt', 'title', 'placeholder', 'aria-label']) if (e.hasAttribute(a)) addText(acc, e.getAttribute(a));
    });
    doc.querySelectorAll('img[src]').forEach(e => addUrl(acc, e.getAttribute('src'), 'image'));
    doc.querySelectorAll('a[href]').forEach(e => addUrl(acc, e.getAttribute('href')));
  }

  function unescapeJs(s) {
    return s
      .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\[ntr]/g, ' ')
      .replace(/\\(.)/g, '$1');
  }

  // {0,} so empty strings ("") are consumed too; otherwise the quotes pair up wrongly
  const LITERAL = /"((?:[^"\\\n]|\\.){0,3000})"|'((?:[^'\\\n]|\\.){0,3000})'|`((?:[^`\\]|\\.){0,6000})`/g;

  // Code changes (custom JS) hide their copy inside string literals.
  function harvestCode(code, acc) {
    if (typeof code !== 'string' || !code) return;
    code = code.slice(0, 200000);
    describeCode(code, acc);
    code = code
      .replace(/\/\*[\s\S]*?\*\//g, ' ')            // block comments (VWO debug logs live here)
      .replace(/(^|[^:\\'"])\/\/[^\n]*/g, '$1')     // line comments, but not https://
      .replace(/console\.\w+\([^;\n]*\)/g, '');     // developer log messages
    const re = new RegExp(LITERAL.source, 'g');
    let m;
    while ((m = re.exec(code)) && acc.budget-- > 0) {
      harvestValue(unescapeJs(m[1] ?? m[2] ?? m[3]), acc, '', true);
    }
  }

  const URL_KEYS = /^(dest|url|href|redirect|redirect_?url|variation_pattern|link|src|image|image_?url)$/i;
  const IMAGE_KEYS = /^(src|image|image_?url)$/i;
  const SKIP_KEYS = /^(id|ids|selector|selectors|cpath|xpath|rtag|tag|viewId|pageId|dependencies|css|style|class|classes|name|status|type|traffic_allocation|weight|original_pattern|case_sensitive|commitId|audienceIds|metrics|goals|integrations|integrationSettings|audiences|segment|segments|triggers|urlRegex|exclude_url|config|widget_id)$/i;

  function harvestValue(s, acc, key, fromCode) {
    const t = s.trim();
    if (!t) return;
    if (URL_KEYS.test(key) || /^(https?:)?\/\/\S+$/i.test(t)) return addUrl(acc, t, IMAGE_KEYS.test(key) ? 'image' : undefined);
    if (/^https?:\/\/\S+ \d+[wx]\b/i.test(t)) return addUrl(acc, t.split(' ')[0], 'image'); // srcset
    if (!fromCode && (t[0] === '{' || t[0] === '[')) {
      try { return harvest(JSON.parse(t), acc, 0, key); } catch { /* not JSON */ }
    }
    if (/<[a-z!\/][^>]*>/i.test(t)) return harvestHtml(t, acc);
    if (!fromCode && /[;{}]|=>|\bfunction\b|\)\s*[;.]/.test(t)) return harvestCode(t, acc);
    addText(acc, t, fromCode);
  }

  function harvest(node, acc, depth = 0, key = '') {
    if (node == null || depth > 9 || acc.budget-- <= 0) return;
    const type = typeof node;
    if (type === 'string') return harvestValue(node, acc, key, false);
    if (type === 'function') {
      let src = '';
      try { src = Function.prototype.toString.call(node); } catch { /* proxy */ }
      return harvestCode(src, acc);
    }
    if (type !== 'object' || acc.seen.has(node)) return;
    acc.seen.add(node);
    if (node === window || (typeof Node !== 'undefined' && node instanceof Node)) return;
    if (!Array.isArray(node) && typeof node.type === 'string') describeChange(node, acc);
    let keys;
    try { keys = Object.keys(node); } catch { return; }
    for (const k of keys) {
      if (SKIP_KEYS.test(k)) continue;
      let v;
      try { v = node[k]; } catch { continue; }
      harvest(v, acc, depth + 1, Array.isArray(node) ? key : k);
    }
  }

  const cleanName = n => {
    if (n == null) return null;
    n = String(n).trim();
    return n && !/^\d{5,}$/.test(n) ? n : null; // masked names come through as bare ids
  };

  // hasChanges: true = the version changes something, false = original page, null = unknown
  function variation(id, name, acc, extra = {}) {
    // English-looking copy first, so translations don't crowd it out
    const texts = acc.texts.slice().sort((a, b) => /[^\x00-\x7F]/.test(a) - /[^\x00-\x7F]/.test(b));
    return {
      id: id == null ? null : String(id),
      name: cleanName(name),
      notes: acc.notes,
      texts,
      images: acc.images,
      links: acc.links,
      colors: acc.colors,
      lazy: acc.lazy,
      hasChanges: null,
      weight: null,
      ...extra,
    };
  }

  // kind: 'test' (versions split between visitors), 'personalization' (different
  // content for different audiences), 'rollout' (one version for everyone)
  const kindFor = (variations, personal) => personal ? 'personalization' : variations.length >= 2 ? 'test' : 'rollout';

  // ---------- one reader per testing tool ----------
  // Each returns null when the tool isn't on the page, or an array of tests.

  function readOptimizely() {
    const o = window.optimizely;
    if (!o || typeof o !== 'object') return null;

    if (typeof o.get === 'function') {
      const d = o.get('data');
      if (!d || !d.experiments) return [];
      let states = {};
      try { states = o.get('state').getExperimentStates() || {}; } catch { /* older snippet */ }
      const campaignOf = {};
      for (const c of Object.values(d.campaigns || {})) {
        for (const e of c.experiments || []) campaignOf[typeof e === 'object' ? e.id : e] = c;
      }
      const pages = d.pages || {};
      const audienceNames = ex => {
        if (typeof ex.audienceName === 'string' && ex.audienceName) return ex.audienceName.split(',');
        const ids = [];
        const walk = x => Array.isArray(x) ? x.forEach(walk) : (typeof x === 'string' || typeof x === 'number') && ids.push(String(x));
        walk(ex.audienceIds);
        return ids.map(id => d.audiences && d.audiences[id] && d.audiences[id].name).filter(Boolean);
      };
      return Object.values(d.experiments).map(ex => {
        const c = campaignOf[ex.id] || {};
        const st = states[ex.id] || {};
        const where = new Set();
        const addPage = p => {
          // Optimizely auto-names pages "URL Targeting for <test name>", which adds nothing
          const n = p && p.name && String(p.name).replace(/^URL Targeting for\s+/i, '').trim();
          if (n && n !== ex.name && n !== c.name) where.add(n);
        };
        const variations = (ex.variations || []).slice(0, LIMITS.variations).map(v => {
          const vv = typeof v === 'object' ? v : (d.variations || {})[v] || { id: v };
          const actions = vv.actions || [];
          const acc = newAcc();
          harvest(actions, acc);
          actions.forEach(a => addPage(pages[a.pageId || a.viewId]));
          return variation(vv.id, vv.name, acc, { hasChanges: actions.some(a => (a.changes || []).length > 0) });
        });
        const personal = !!(c.policy && c.policy !== 'single_experiment');
        return {
          tool: 'Optimizely',
          id: String(ex.id),
          name: cleanName(ex.name) || cleanName(c.name),
          campaign: personal ? cleanName(c.name) : null,
          kind: kindFor(variations, personal),
          status: c.concluded ? 'Concluded' : null,
          audiences: audienceNames(ex),
          onPage: st.isActive === true ? true : null,
          yourVariation: st.variation && st.variation.id != null ? String(st.variation.id) : null,
          where: [...where].slice(0, 4),
          variations,
        };
      });
    }

    if (o.data && o.data.experiments) { // Optimizely Classic
      const d = o.data;
      const st = d.state || {};
      const active = new Set((st.activeExperiments || []).map(String));
      const varMap = st.variationIdsMap || {};
      return Object.entries(d.experiments).filter(([, ex]) => ex && ex.enabled !== false).map(([id, ex]) => {
        const variations = (ex.variation_ids || []).slice(0, LIMITS.variations).map(vid => {
          const v = (d.variations || {})[vid] || {};
          const acc = newAcc();
          harvestCode(v.code || '', acc);
          return variation(vid, v.name, acc, { hasChanges: !!(v.code && v.code.trim()) });
        });
        const mine = (varMap[id] || [])[0];
        return {
          tool: 'Optimizely', id, name: cleanName(ex.name), campaign: null,
          kind: kindFor(variations, false), status: null, audiences: [],
          onPage: active.has(id) || null,
          yourVariation: mine != null ? String(mine) : null,
          where: [], variations,
        };
      });
    }
    return null;
  }

  const VWO_SKIP = /ANALY|INSIGHT|TRACK|SURVEY|RECORD|HEATMAP|FORM|FUNNEL|FEEDBACK|PUSH|CONVERSION/;

  function vwoWhere(c) {
    const r = typeof c.urlRegex === 'string' ? c.urlRegex : '';
    if (!r || r === '.*') return [];
    const clean = r.replace(/\(\?:[^)]*\)\??/g, '').replace(/\\(.)/g, '$1')
      .replace(/[\^$]|\.\*|\?$/g, '').replace(/^https?:\/\/(www\.)?/, '');
    return clean ? [clean.slice(0, 80)] : [];
  }

  function readVWO() {
    let exp = window._vwo_exp;
    if (!exp || typeof exp !== 'object' || !Object.keys(exp).length) {
      try { exp = window.VWO._.allSettings.dataStore.campaigns; } catch { exp = null; }
    }
    if (!exp || typeof exp !== 'object') return window._vwo_code ? [] : null;
    let tags = {};
    try { tags = window.VWO._.allSettings.tags || {}; } catch { /* older smartcode */ }

    const out = [];
    for (const [id, c] of Object.entries(exp)) {
      if (!c || typeof c !== 'object') continue;
      const type = String(c.type || '');
      if (!type || VWO_SKIP.test(type)) continue;
      if (c.status && !/RUNNING/i.test(c.status)) continue;
      const names = c.comb_n && typeof c.comb_n === 'object' ? c.comb_n : {};
      const sections = c.sections && typeof c.sections === 'object' ? Object.values(c.sections) : [];
      const ids = new Set(Object.keys(names));
      sections.forEach(s => s && s.variations && Object.keys(s.variations).forEach(k => ids.add(k)));

      const variations = [...ids].slice(0, LIMITS.variations).map(vid => {
        const acc = newAcc();
        let hasChanges = false;
        for (const s of sections) {
          const raw = s && s.variations ? s.variations[vid] : null;
          if (raw == null || raw === '' || raw === '[]' || raw === 'none' || (Array.isArray(raw) && !raw.length)) continue;
          hasChanges = true;
          if (type === 'SPLIT_URL') { addUrl(acc, String(raw)); note(acc, 'Sends visitors to a different page'); continue; }
          let ops = raw;
          if (typeof raw === 'string') {
            try { ops = JSON.parse(raw); } catch { harvestValue(raw, acc, '', false); continue; }
          }
          // Each op points at a tag whose function holds the actual change code.
          for (const op of [].concat(ops)) {
            if (!op || typeof op !== 'object') continue;
            if (op.tag && /_async$/.test(op.tag)) acc.lazy = true;
            else if (op.tag && tags[op.tag] && typeof tags[op.tag].fn === 'function') harvest(tags[op.tag].fn, acc);
            else harvest(op, acc);
          }
        }
        return variation(vid, names[vid], acc, { hasChanges });
      });
      if (!variations.length) continue;

      const chosen = c.combination_chosen;
      out.push({
        tool: 'VWO',
        id: String(c.id || id),
        name: cleanName(c.name),
        campaign: null,
        kind: kindFor(variations, type === 'DEPLOY'),
        status: null,
        audiences: [],
        onPage: chosen != null ? true : null,
        yourVariation: chosen != null ? String(chosen) : null,
        where: vwoWhere(c),
        variations,
      });
    }
    return out;
  }

  function readABTasty() {
    const A = window.ABTasty;
    if (!A || typeof A !== 'object') return null;
    const tests = (A.accountData && A.accountData.tests) || {};
    const results = A.results || {};
    let onPage = {};
    try { onPage = (typeof A.getTestsOnPage === 'function' && A.getTestsOnPage()) || {}; } catch { /* not ready */ }

    const out = [];
    for (const [id, t] of Object.entries(tests)) {
      if (!t || typeof t !== 'object') continue;
      const type = String(t.type || '');
      if (/patch|mastersegment/i.test(type)) continue;
      const vs = t.variations
        ? (Array.isArray(t.variations) ? t.variations.map(v => [v && v.id, v]) : Object.entries(t.variations))
        : [];
      const variations = vs.slice(0, LIMITS.variations).map(([vid, v]) => {
        const mods = v && (v.modifications || v.modifs || v.actions);
        const acc = newAcc();
        harvest(mods || v, acc);
        return variation(vid, v && v.name, acc, { hasChanges: Array.isArray(mods) ? mods.length > 0 : null });
      });
      const r = results[id] || {};
      out.push({
        tool: 'AB Tasty',
        id,
        name: cleanName(t.name || r.name),
        campaign: null,
        kind: kindFor(variations, /perso|subsegment/i.test(type)),
        status: null,
        audiences: [],
        onPage: id in onPage || r.status === 'accepted' ? true : null,
        yourVariation: r.variationID != null ? String(r.variationID) : null,
        where: [],
        variations,
      });
    }
    return out;
  }

  function readConvert() {
    const c = window.convert;
    if (!c || typeof c !== 'object' || !c.data) return null;
    const raw = c.data.experiences || c.data.experiments || [];
    const list = Array.isArray(raw) ? raw : Object.entries(raw).map(([id, x]) => ({ id, ...x }));
    const cur = (c.currentData && (c.currentData.experiences || c.currentData.experiments)) || {};

    const out = [];
    for (const x of list) {
      if (!x || typeof x !== 'object') continue;
      if (/complet|archiv|stop|pause|draft/i.test(String(x.status || ''))) continue;
      const vraw = x.variations || x.vars || [];
      const vs = Array.isArray(vraw) ? vraw : Object.entries(vraw).map(([id, v]) => ({ id, ...v }));
      const variations = vs.slice(0, LIMITS.variations).map(v => {
        const changes = v.changes || [];
        const acc = newAcc();
        harvest(changes, acc);
        return variation(v.id, v.name || v.n, acc, {
          hasChanges: changes.length > 0,
          weight: typeof v.traffic_allocation === 'number' ? v.traffic_allocation : null,
        });
      });
      const mineObj = cur[x.id];
      const mine = mineObj && (mineObj.variation ? mineObj.variation.id : mineObj.variation_id);
      const type = String(x.type || x.tp || '');
      out.push({
        tool: 'Convert',
        id: String(x.id),
        name: cleanName(x.name || x.n),
        campaign: null,
        kind: /deploy/i.test(type) ? 'rollout' : kindFor(variations, false),
        status: null,
        audiences: [],
        onPage: mine != null ? true : null,
        yourVariation: mine != null ? String(mine) : null,
        where: [],
        variations,
      });
    }
    return out;
  }

  function readKameleoon() {
    const K = window.Kameleoon && window.Kameleoon.API;
    if (!K || !K.Experiments) return null;
    let all = [], active = [];
    try { all = K.Experiments.getAll() || []; } catch { /* not ready */ }
    try { active = K.Experiments.getActive() || []; } catch { /* not ready */ }
    const activeIds = new Set(active.map(e => String(e.id)));
    return all.map(e => {
      const variations = (e.variations || []).slice(0, LIMITS.variations).map(v => {
        const acc = newAcc();
        harvest(v, acc);
        return variation(v.id, v.name, acc);
      });
      const mine = e.associatedVariation;
      return {
        tool: 'Kameleoon', id: String(e.id), name: cleanName(e.name), campaign: null,
        kind: kindFor(variations, false), status: null, audiences: [],
        onPage: activeIds.has(String(e.id)) || null,
        yourVariation: mine && mine.id != null ? String(mine.id) : null,
        where: [], variations,
      };
    });
  }

  function readGrowthBook() {
    const gb = window._growthbook;
    if (!gb || typeof gb.getAllResults !== 'function') return null;
    const out = [];
    for (const [key, r] of gb.getAllResults()) {
      const ex = (r && r.experiment) || {};
      const res = (r && r.result) || {};
      const meta = ex.meta || [];
      const variations = (ex.variations || []).slice(0, LIMITS.variations).map((val, i) => {
        const acc = newAcc();
        harvest(val, acc);
        const m = meta[i] || {};
        return variation(m.key != null ? m.key : i, m.name || (i === 0 ? 'Control' : 'Variant ' + i), acc,
          { hasChanges: i === 0 ? false : null });
      });
      const mine = res.inExperiment ? (meta[res.variationId] && meta[res.variationId].key != null ? meta[res.variationId].key : res.variationId) : null;
      out.push({
        tool: 'GrowthBook', id: String(key), name: cleanName(ex.name || key), campaign: null,
        kind: 'test', status: null, audiences: [],
        onPage: res.inExperiment ? true : null,
        yourVariation: mine != null ? String(mine) : null,
        where: [], variations,
      });
    }
    return out;
  }

  function readPostHog() {
    const ff = window.posthog && window.posthog.featureFlags;
    if (!ff || typeof ff.getFlagVariants !== 'function') return null;
    let fv = {};
    try { fv = ff.getFlagVariants() || {}; } catch { return null; }
    const out = Object.entries(fv).filter(([, v]) => typeof v === 'string').map(([k, v]) => ({
      tool: 'PostHog', id: k, name: k, campaign: null, kind: 'test', status: null, audiences: [],
      onPage: true, yourVariation: v, where: [],
      variations: [{ id: v, name: v, notes: [], texts: [], images: [], links: [], colors: [], lazy: false, hasChanges: null, weight: null }],
    }));
    return out.length ? out : null; // PostHog alone is usually just analytics
  }

  const READERS = [
    ['Optimizely', readOptimizely, /cdn\.optimizely\.com/i],
    ['VWO', readVWO, /visualwebsiteoptimizer\.com|dev\.vwo\.com/i],
    ['AB Tasty', readABTasty, /abtasty\.com/i],
    ['Convert', readConvert, /convertexperiments\.com/i],
    ['Kameleoon', readKameleoon, /kameleoon\.(eu|io|com)/i],
    ['GrowthBook', readGrowthBook, /growthbook/i],
    ['PostHog', readPostHog, null],
  ];

  // Tools that decide on their servers: we can say they're here, not what they test.
  const SERVER_SIDE_TOOLS = [
    ['Adobe Target', () => window.adobe && window.adobe.target, /tt\.omtrdc\.net|\/at\.js/i],
    ['Dynamic Yield', () => window.DY && window.DY.API, /dynamicyield\.com/i],
    ['Monetate', () => window.monetateT || window.monetateQ, /monetate\.net/i],
    ['LaunchDarkly', () => window.LDClient, /launchdarkly\.com/i],
    ['Statsig', () => window.Statsig || window.__STATSIG__, /statsig/i],
    ['Split', () => window.splitio, /split\.io/i],
    ['Mutiny', () => window.mutiny, /mutinycdn|mutinyhq/i],
    ['Intelligems', () => window.igData, /intelligems/i],
    ['Shoplift', () => window.shoplift, /shoplift/i],
    ['Evolv', () => window.evolv, /evolv\.ai/i],
    ['SiteSpect', () => null, /sitespect/i],
    ['Amplitude Experiment', () => null, /cdn\.amplitude\.com\/.*experiment/i],
  ];

  const KIND_ORDER = { test: 0, personalization: 1, rollout: 2 };
  const richness = t => t.variations.reduce((n, v) => n + v.notes.length + v.texts.length + v.images.length + v.links.length, 0);

  function scan() {
    const srcs = Array.from(document.scripts, s => s.src).filter(Boolean).join('\n');
    const tools = [];
    let tests = [];
    for (const [name, read, re] of READERS) {
      let found = null;
      try { found = read(); } catch { found = null; }
      if (found) {
        tools.push({ name, readable: true, count: found.length });
        tests = tests.concat(found);
      } else if (re && re.test(srcs)) {
        tools.push({ name, readable: false });
      }
    }
    for (const [name, probe, re] of SERVER_SIDE_TOOLS) {
      let hit = false;
      try { hit = !!probe(); } catch { /* ignore */ }
      if (hit || (re && re.test(srcs))) tools.push({ name, readable: false });
    }
    tests.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
      || (b.onPage === true) - (a.onPage === true) || richness(b) - richness(a));
    return {
      url: location.href, host: location.hostname, title: document.title, scannedAt: Date.now(),
      tools, tests: tests.slice(0, LIMITS.tests),
    };
  }

  // ---------- reporting ----------

  let last = '';
  function post(force) {
    let report;
    try { report = scan(); } catch (e) {
      report = { url: location.href, host: location.hostname, scannedAt: Date.now(), tools: [], tests: [], error: String(e) };
    }
    const sig = JSON.stringify([report.tools, report.tests]);
    if (!force && sig === last) return;
    last = sig;
    window.postMessage({ __abSpy: 'report', report }, '*');
  }

  // Testing tools load late and some keep adding tests, so look a few times.
  [300, 1500, 4000, 8000, 15000].forEach(ms => setTimeout(post, ms));

  // Single-page apps change URL without reloading.
  let href = location.href;
  setInterval(() => {
    if (location.href === href) return;
    href = location.href;
    last = '';
    [500, 2500, 6000].forEach(ms => setTimeout(post, ms));
  }, 1000);

  window.addEventListener('message', e => {
    if (e.source === window && e.data && e.data.__abSpy === 'rescan') post(true);
  });

  window.__abSpyScan = scan; // handy for debugging in the console
})();
