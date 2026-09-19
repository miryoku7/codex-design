// Run with the isolated fixture from i18n.browser.mjs through managed-browser.
async (page, config) => {
  const checks = [];
  const check = (condition, name) => { if (!condition) throw new Error(name); checks.push(name); };
  const paths = [
    ['library', config.url + '/'],
    ['kits', config.url + '/kits'],
    ['workbench', `${config.url}/designs/${config.component}`],
    ['standalone', config.standalone],
  ];
  const pattern = '**/i18n.js';
  for (const [name, url] of paths) {
    for (const locale of ['ja', 'en']) {
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      await page.route(pattern, async route => { await gate; await route.continue(); });
      try {
        await page.goto(url, { waitUntil: 'commit' });
        await page.locator('body').waitFor({ state: 'attached' });
        const pending = await page.evaluate(locale => {
          localStorage.setItem('codex-design.locale', locale);
          const root = document.documentElement, body = document.body;
          window.__i18nFirstVisible = null;
          const observer = new MutationObserver(() => {
            if (root.hasAttribute('data-i18n-pending')) return;
            const I = window.DesignI18n;
            window.__i18nFirstVisible = {
              language: root.lang,
              inert: body.inert,
              visibility: getComputedStyle(body).visibility,
              mismatches: [...document.querySelectorAll('[data-i18n]')]
                .filter(el => el.textContent !== I.t(el.dataset.i18n)).map(el => el.dataset.i18n),
              attributesMatch: ['title', 'placeholder', 'aria-label', 'content'].every(attr =>
                [...document.querySelectorAll(`[data-i18n-${attr}]`)].every(el => el.getAttribute(attr) === I.t(el.getAttribute(`data-i18n-${attr}`)))),
            };
            observer.disconnect();
          });
          observer.observe(root, { attributes: true });
          return {
            pending: root.hasAttribute('data-i18n-pending'), inert: body.inert,
            visibility: getComputedStyle(body).visibility,
            copiedText: [...document.querySelectorAll('[data-i18n]')].some(el => el.textContent.trim()),
          };
        }, locale);
        check(pending.pending && pending.inert && pending.visibility === 'hidden', `${name} ${locale}: untranslated controls hidden and inert while runtime is delayed`);
        check(!pending.copiedText, `${name} ${locale}: no duplicated HTML copy before runtime`);
        release();
        await page.waitForFunction(() => window.__i18nFirstVisible !== null);
        const first = await page.evaluate(() => window.__i18nFirstVisible);
        check(first.language === locale && first.mismatches.length === 0 && first.attributesMatch, `${name} ${locale}: first reveal has selected locale and translated accessible attributes`);
        check(!first.inert && first.visibility === 'visible', `${name} ${locale}: initialized interface becomes usable`);
        await page.waitForLoadState('domcontentloaded');
      } finally {
        release();
        await page.unroute(pattern);
      }
    }
  }
  for (const [name, url] of paths) {
    await page.route(pattern, route => route.abort('failed'));
    try {
      await page.goto(url);
      const failed = await page.evaluate(() => ({
        pending: document.documentElement.hasAttribute('data-i18n-pending'),
        inert: document.body.inert,
        visibility: getComputedStyle(document.body).visibility,
      }));
      check(failed.pending && failed.inert && failed.visibility === 'hidden', `${name}: failed locale runtime does not expose unlabeled controls`);
    } finally { await page.unroute(pattern); }
  }
  await page.goto(config.url);
  await page.locator('#createProject').waitFor();
  return { count: checks.length, checks };
}
