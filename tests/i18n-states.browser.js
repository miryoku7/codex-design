// Use only the isolated fixture from i18n.browser.mjs, through managed-browser.
async (page, config) => {
  const checks = [];
  const check = (condition, name) => { if (!condition) throw new Error(name); checks.push(name); };
  const switchTo = locale => page.locator('[data-locale-switch]:visible').first().selectOption(locale);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${config.url}/projects/${config.emptyProject}`);
  await page.locator('#emptyTitle').waitFor();
  for (const locale of ['ja', 'en']) {
    await switchTo(locale);
    check(await page.locator('#emptyTitle').innerText() === (locale === 'en' ? 'No designs yet' : '作品はまだありません'), `empty state ${locale}`);
  }
  await page.route('**/api/projects', route => route.request().method() === 'GET' ? route.fulfill({ status: 503, contentType: 'application/json', body: '{"message":"raw English technical error"}' }) : route.continue());
  await page.goto(config.url);
  await page.locator('#libraryNotice').waitFor();
  for (const locale of ['ja', 'en']) {
    await switchTo(locale);
    const message = await page.locator('#noticeMessage').innerText();
    check(message.includes(locale === 'en' ? 'Could not load' : '読み込めません'), `load error ${locale}`);
    check(!message.includes('raw English technical error'), `technical API error not leaked ${locale}`);
  }
  await page.unroute('**/api/projects');
  await page.goto(`${config.url}/designs/${config.component}`);
  await page.locator('#notesInput').waitFor();
  const current = await (await page.request.get(`${config.url}/api/designs/${config.component}/state`)).json();
  await page.route(`**/api/designs/${config.component}/state`, route => route.request().method() === 'POST' ? route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ ...current, error: 'revision_conflict' }) }) : route.continue());
  await page.locator('#notesInput').fill('Conflict draft / 競合時の下書き');
  await page.locator('#conflictBanner').waitFor();
  for (const locale of ['ja', 'en']) {
    await switchTo(locale);
    check(await page.locator('#notesInput').inputValue() === 'Conflict draft / 競合時の下書き', `conflict draft preserved ${locale}`);
    const message = await page.locator('#conflictMessage').innerText();
    check(locale === 'en' ? /draft.*preserved/i.test(message) && !/[\u3040-\u30ff]/.test(message) : /[\u3040-\u30ff]/.test(message), `conflict message ${locale}`);
  }
  await page.unroute(`**/api/designs/${config.component}/state`);
  await page.locator('#useServer').click();
  check(await page.locator('#notesInput').inputValue() === current.state.variants[0].notes, 'conflict recovery restores saved note');
  await page.goto(`${config.url}/kits/${config.kit}`);
  await page.locator('#compareVersions').click();
  await page.locator('#kitCompare').waitFor();
  for (const locale of ['ja', 'en']) { await switchTo(locale); check(await page.locator('html').getAttribute('lang') === locale, `kit version comparison ${locale}`); }
  return { count: checks.length, checks };
}
