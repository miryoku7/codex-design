// Invoke through managed-browser run-code, wrapping this function with the
// fixture JSON printed by i18n.browser.mjs and an absolute artifact directory.
async (page, config) => {
  const checks = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const check = (condition, name) => { if (!condition) throw new Error(name); checks.push(name); };
  const goto = path => page.goto(config.url + path);
  const state = id => page.request.get(`${config.url}/api/designs/${id}/state`).then(response => response.json());
  async function switchTo(locale) {
    const modal = page.locator('dialog[open] [data-locale-switch]');
    await (await modal.count() ? modal : page.locator('[data-locale-switch]:visible').first()).selectOption(locale);
    check(await page.locator('html').getAttribute('lang') === locale, `document language ${locale}`);
    const mismatches = await page.evaluate(() => {
      const I = window.DesignI18n;
      return [...document.querySelectorAll('[data-i18n]')].filter(el => el.textContent !== I.t(el.dataset.i18n)).map(el => el.dataset.i18n);
    });
    check(!mismatches.length, `static translations ${locale}: ${mismatches.join(', ')}`);
  }
  async function screenshot(name, fullPage = true) {
    // Cross-process iframe rasterization can lag DOM readiness during resizing.
    await page.waitForTimeout(350);
    await page.screenshot({ path: `${config.artifacts}/${name}.png`, fullPage });
  }
  async function noOverflow(name) { check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: no page overflow`); }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await goto('/');
  await page.locator('.project-link').first().waitFor();
  for (const locale of ['ja', 'en']) { await switchTo(locale); await noOverflow(`library ${locale}`); await screenshot(`${locale}-library-desktop`); }
  await page.locator('#createProject').click();
  await page.locator('#projectName').fill('未保存 / Draft project');
  await switchTo('ja'); await switchTo('en');
  check(await page.locator('#projectName').inputValue() === '未保存 / Draft project', 'project draft survives locale changes');
  await page.locator('#projectDialog [data-close]').first().click();
  await goto(`/projects/${config.project}?kind=component`);
  await page.locator('.design-card').first().waitFor();
  check(await page.locator('html').getAttribute('lang') === 'en', 'preference survives navigation');
  await page.locator('#designSearch').fill('読書');
  await switchTo('ja'); await switchTo('en');
  check(await page.locator('#designSearch').inputValue() === '読書', 'search survives locale changes');
  check(await page.evaluate(() => new URL(location.href).searchParams.get('kind')) === 'component', 'kind filter survives locale changes');
  await page.reload(); await page.locator('.design-card').first().waitFor();
  check(await page.locator('html').getAttribute('lang') === 'en', 'preference survives reload');
  const before = await state(config.component);
  await switchTo('ja'); await switchTo('en');
  check(JSON.stringify(await state(config.component)) === JSON.stringify(before), 'library locale switch does not write design');
  await goto(`/designs/${config.component}`);
  await page.locator('.open-variant').first().click();
  await page.locator('#notesInput').waitFor();
  await page.waitForFunction(() => document.querySelector('#saveCluster')?.dataset.state === 'saved' || document.querySelector('#saveStatus')?.textContent === window.DesignI18n.t('saved.2'));
  const initial = await state(config.component);
  const frameSources = await page.locator('iframe.preview-frame').evaluateAll(elements => elements.map(el => el.srcdoc));
  await page.evaluate(() => { window.i18nFrame = document.querySelector('iframe.preview-frame'); });
  for (const locale of ['ja', 'en']) { await switchTo(locale); await noOverflow(`workbench ${locale}`); await screenshot(`${locale}-workbench-desktop`); }
  check(await page.evaluate(() => window.i18nFrame === document.querySelector('iframe.preview-frame')), 'locale preserves preview iframe identity');
  check(JSON.stringify(await page.locator('iframe.preview-frame').evaluateAll(elements => elements.map(el => el.srcdoc))) === JSON.stringify(frameSources), 'locale preserves authored preview source');
  check(JSON.stringify(await state(config.component)) === JSON.stringify(initial), 'workbench locale switch does not write state');
  await page.locator('#notesInput').fill('Keep this draft / このメモを保持');
  await switchTo('ja'); await switchTo('en');
  check(await page.locator('#notesInput').inputValue() === 'Keep this draft / このメモを保持', 'notes survive locale changes');
  await page.waitForFunction(() => document.querySelector('#saveStatus').textContent === window.DesignI18n.t('saved.2'));
  await page.reload(); await page.locator('#notesInput').waitFor();
  check(await page.locator('#notesInput').inputValue() === 'Keep this draft / このメモを保持', 'notes save and reload in English');
  await page.locator('#adoptVariant').click();
  await page.waitForFunction(() => document.querySelector('#saveStatus').textContent === window.DesignI18n.t('saved.2'));
  const adopted = await state(config.component);
  check(adopted.state.selectedId === 'A', 'adoption saves in English');
  await page.locator('#exportPdf').click(); await switchTo('ja'); await switchTo('en');
  check(await page.locator('#pdfTitle').innerText() === 'Export as PDF', 'PDF dialog follows locale');
  await page.locator('#closePdf').click();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const locale of ['ja', 'en']) { await switchTo(locale); await noOverflow(`mobile workbench ${locale}`); await screenshot(`${locale}-workbench-mobile`); }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await goto('/kits'); await page.locator('#kitsOverview').waitFor();
  await switchTo('ja'); await switchTo('en');
  await goto(`/kits/${config.kit}`); await page.locator('#editKit').waitFor();
  await page.locator('#kitExamples').scrollIntoViewIfNeeded();
  await page.frameLocator('#kitExamples iframe').first().locator('main').waitFor();
  await page.waitForTimeout(350);
  await page.evaluate(() => scrollTo(0, 0));
  for (const locale of ['ja', 'en']) {
    await switchTo(locale); await noOverflow(`kit ${locale}`);
    await page.evaluate(() => scrollTo(0, 0));
    await screenshot(`${locale}-kit-desktop`, false);
    // Offscreen sandboxed frames may not rasterize in full-page captures.
    await page.locator('#kitExamples iframe').scrollIntoViewIfNeeded();
    await screenshot(`${locale}-kit-preview-desktop`, false);
  }
  await page.locator('#editKit').click();
  await page.locator('#kitName').fill('Unsaved kit / 未保存キット');
  await page.locator('#kitRules').fill('Keep rules / ルールを保持');
  await switchTo('ja'); await switchTo('en');
  check(await page.locator('#kitName').inputValue() === 'Unsaved kit / 未保存キット', 'kit name draft survives locale');
  check(await page.locator('#kitRules').inputValue() === 'Keep rules / ルールを保持', 'kit rules draft survives locale');
  await page.locator('#cancelEditor').click();
  await page.setViewportSize({ width: 390, height: 844 });
  await goto('/'); await page.locator('.project-link').first().waitFor();
  for (const locale of ['ja', 'en']) { await switchTo(locale); await noOverflow(`mobile library ${locale}`); await screenshot(`${locale}-library-mobile`); }
  await page.goto(config.standalone); await page.locator('.open-variant').first().waitFor();
  for (const locale of ['ja', 'en']) await switchTo(locale);
  await page.reload(); await page.locator('.open-variant').first().waitFor();
  check(await page.locator('html').getAttribute('lang') === 'en', 'standalone preference survives reload');
  check(errors.length === 0, `no page errors: ${errors.join('; ')}`);
  return { checks, count: checks.length, errors };
}
