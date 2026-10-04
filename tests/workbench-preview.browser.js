/* Browser-only regression, served by workbench-preview.browser.mjs. */
(() => {
  'use strict';
  // These existing text assertions intentionally exercise the Japanese locale.
  localStorage.setItem('codex-design.locale', 'ja');
  const clone = value => structuredClone(value);
  const tokens = { accent: '#4051ac', background: '#f2eee5', text: '#252833', spacing: 24, fontSize: 16, radius: 8 };
  const variant = id => ({
    id, name: `案${id}`, rationale: `${id}の構成`, summary: `${id}の要約`,
    html: `<main><h1>${id} Preview fixture</h1><p>保存後も表示を保持する検証画面。</p></main>`,
    css: 'main{min-height:1400px;padding:var(--spacing);background:#f2eee5}h1{font-size:var(--heading-size)}',
    tokens: clone(tokens), baselineTokens: clone(tokens), notes: '',
    tweaks: [{ id: 'heading', type: 'range', label: '見出し', cssVar: '--heading-size', default: 32, min: 24, max: 48, step: 1, unit: 'px' }],
    tweakValues: { heading: 32 }, baselineTweakValues: { heading: 32 },
  });
  let stored = {
    id: 'preview-regression', version: 1, title: 'Preview lifecycle regression', sample: true,
    brief: { purpose: '保存応答と外部更新をまたいでプレビューを保持', audience: 'QA', platform: 'browser', mood: '', avoid: '' },
    selectedId: null, view: { mode: 'compare', activeId: 'A' },
    viewport: { preset: 'mobile', width: 390, height: 760 },
    variants: ['A', 'B', 'C'].map(variant),
  };
  let revision = 1, saves = 0, conflictNext = false;
  const result = window.previewRegression = { status: 'running', checks: [], requests: [], downloads: [], error: null };
  const nativeFetch = window.fetch.bind(window);
  const response = (status = 200) => new Response(JSON.stringify({ state: clone(stored), revision: String(revision) }), {
    status, headers: { 'Content-Type': 'application/json' },
  });
  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href);
    if (url.origin === location.origin && url.pathname === '/api/designs/preview-regression/state') {
      const method = options.method || 'GET';
      result.requests.push({ method, at: performance.now() });
      if (method === 'POST') {
        const outgoing = JSON.parse(options.body);
        if (conflictNext) { conflictNext = false; revision++; return response(409); }
        if (outgoing.revision !== String(revision)) return response(409);
        stored = clone(outgoing.state); revision++; saves++;
      }
      return response();
    }
    if (url.origin !== location.origin || !/^\/workbench\/(?:legacy-v1\.css)$/.test(url.pathname)) {
      throw new Error(`Unexpected fetch blocked by regression fixture: ${url.pathname}`);
    }
    return nativeFetch(input, options);
  };

  // Observe actual srcdoc writes and iframe loads, not merely attribute equality.
  const frameStats = new WeakMap();
  const srcdoc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc');
  Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
    ...srcdoc,
    set(value) {
      if (!frameStats.has(this)) {
        const stats = { writes: 0, loads: 0 };
        frameStats.set(this, stats);
        this.addEventListener('load', () => stats.loads++);
      }
      frameStats.get(this).writes++;
      srcdoc.set.call(this, value);
    },
  });
  const nativeCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = blob => {
    result.downloads.push(blob.text());
    return nativeCreateObjectURL(blob);
  };
  document.addEventListener('click', event => {
    if (event.target.closest('a[download]')) event.preventDefault();
  }, true);

  const $ = selector => document.querySelector(selector);
  const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  async function parameterStage(phase) {
    result.phase = phase;
    if (new URLSearchParams(location.search).has('parameter-screenshots')) {
      await new Promise(resolve => { window.resumeParameterRegression = resolve; });
    }
  }
  const check = (condition, label) => {
    if (!condition) throw new Error(label);
    result.checks.push(label);
  };
  async function until(predicate, label, timeout = 6500) {
    const start = performance.now();
    while (!predicate()) {
      if (performance.now() - start > timeout) throw new Error(`Timed out: ${label}`);
      await delay(20);
    }
  }
  const frame = id => $(`.variant-card[data-id="${id}"] iframe`);
  const visibleIds = () => [...document.querySelectorAll('.variant-card:not([hidden])')].map(card => card.dataset.id).join(',');
  const snapshot = () => [...document.querySelectorAll('.variant-card iframe')].map(element => ({
    id: element.closest('.variant-card').dataset.id, element, source: element.srcdoc, ...frameStats.get(element),
  }));
  function unchanged(before, label) {
    for (const old of before) {
      const current = frame(old.id), stats = frameStats.get(current);
      check(current === old.element && current.isConnected && current.srcdoc === old.source &&
        stats.writes === old.writes && stats.loads === old.loads, `${label}: ${old.id} retains node, source and load count`);
    }
  }
  async function saved(action) {
    const previous = saves;
    action();
    await until(() => saves > previous && $('#saveStatus').textContent === '保存済み', 'save acknowledgement');
    await delay(70);
  }
  async function external(change) {
    change(stored); revision++;
    await until(() => $('#saveStatus').textContent === '外部更新を読み込みました', 'external revision');
    await delay(70);
  }
  function input(selector, value) {
    const element = $(selector); element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function run() {
    await until(() => visibleIds() === 'A,B,C' && snapshot().every(item => item.loads === 1), 'initial previews');
    check(snapshot().every(item => item.writes === 1), 'each initial frame receives srcdoc once');
    let before = snapshot();
    await saved(() => $('.open-variant[data-focus="open-A"]').click());
    unchanged(before, 'open A and save acknowledgement');
    check(visibleIds() === 'A' && getComputedStyle(frame('B').closest('.variant-card')).display === 'none', 'focus hides other cards with existing CSS');
    check(document.activeElement.dataset.view === 'A', 'open action moves keyboard focus to A tab');
    await saved(() => $('[data-view="A"]').click());
    unchanged(before, 'repeated A tab');

    await saved(() => input('#notesInput', '保存するメモ'));
    unchanged(before, 'note save acknowledgement');
    check(stored.variants[0].notes === '保存するメモ', 'note persists in saved state');
    await saved(() => $('#adoptVariant').click());
    unchanged(before, 'adoption save acknowledgement');
    check(stored.selectedId === 'A' && !$('#exportHandoff').disabled, 'adoption persists and enables handoff');

    await external(state => { state.variants[0].notes = '外部メモ'; state.variants[0].summary = '更新した要約'; });
    unchanged(before, 'external note metadata');
    check($('#notesInput').value === '外部メモ', 'external note reaches inspector');
    // Change a local metadata value first so the next poll has an observable status transition.
    await saved(() => input('#notesInput', '外部メモ'));
    await external(() => {}); // A library favorite advances revision without changing snapshot.
    unchanged(before, 'favorite-only external revision');

    await saved(() => input('#tweak-heading', 40));
    check(frame('A') === before[0].element && frame('A').srcdoc !== before[0].source, 'actual tweak updates retained frame');
    check(frameStats.get(frame('A')).writes === before[0].writes + 1 && frameStats.get(frame('A')).loads === before[0].loads + 1, 'tweak loads once, save acknowledgement adds no load');
    before = snapshot();
    await saved(() => input('#tweak-heading', 40));
    unchanged(before, 'identical tweak refresh');
    await saved(() => $('#resetVariant').click());
    check(stored.variants[0].tweakValues.heading === 32 && stored.variants[0].notes === '外部メモ' && stored.selectedId === 'A', 'reset preserves baseline, notes and adoption');
    before = snapshot();
    await saved(() => $('#resetVariant').click());
    unchanged(before, 'already-reset preview');

    await external(state => { state.variants[0].html += '<p>Source revision</p>'; });
    check(frame('A') === before[0].element && frame('A').srcdoc.includes('Source revision'), 'external author source updates the existing frame');
    check(frameStats.get(frame('A')).writes === before[0].writes + 1, 'external source receives one srcdoc write');
    unchanged(before.slice(1), 'unmodified sibling source');
    before = snapshot();
    await saved(() => $('[data-view="compare"]').click());
    unchanged(before, 'return to comparison');
    check(visibleIds() === 'A,B,C' && [...document.querySelectorAll('.preview-viewport')].every(box => box.clientWidth > 0), 'comparison reveals and fits every retained preview');

    await external(state => { state.variants.unshift(variant('D')); });
    await until(() => frameStats.get(frame('D'))?.loads === 1, 'added frame loaded');
    unchanged(before, 'addition before retained variants');
    check(visibleIds() === 'D,A,B,C', 'added variant uses source order');
    before = snapshot();
    await saved(() => $('[data-view="A"]').click());
    await external(state => { state.variants = state.variants.filter(item => item.id !== 'B'); });
    unchanged(before.filter(item => item.id !== 'B'), 'remove another variant');
    check(!frame('B') && !before.find(item => item.id === 'B').element.isConnected, 'removed variant is released');

    $('#exportJson').click(); $('#exportHandoff').click();
    const downloads = await Promise.all(result.downloads);
    const exported = JSON.parse(downloads[0]);
    check(exported.variants.find(item => item.id === 'A').html.includes('Source revision') && exported.selectedId === 'A' && exported.variants.find(item => item.id === 'A').notes === '外部メモ', 'JSON export keeps current source, adoption and note');
    check(downloads[1].includes('Source revision') && downloads[1].includes('外部メモ'), 'handoff includes current source and note');
    result.downloads = downloads.map(contents => ({ length: contents.length }));

    before = snapshot();
    conflictNext = true;
    input('#notesInput', '競合で残す下書き');
    await until(() => !$('#conflictBanner').hidden, 'save conflict');
    unchanged(before, 'conflict preserves preview');
    check($('#notesInput').value === '競合で残す下書き', 'conflict preserves unsaved note');
    await saved(() => $('#keepDraft').click());
    unchanged(before, 'retry draft acknowledgement');
    check(stored.variants.find(item => item.id === 'A').notes === '競合で残す下書き', 'draft retry persists note');

    // Removing declarations models a design-only first pass. Add one requested
    // control later at the existing visual value, without enabling base tokens.
    await external(state => {
      const a = state.variants.find(item => item.id === 'A');
      a.tokens = {}; a.baselineTokens = {}; a.tweaks = [];
      a.tweakValues = {}; a.baselineTweakValues = {};
      a.css = 'main{min-height:1400px;padding:24px;background:#f2eee5}h1{font-size:32px}';
    });
    await until(() => frame('A').srcdoc.includes('font-size:32px'), 'design-only preview');
    check($('#baseControls').hidden && $('#resetVariant').hidden && !$('#tweakControls input') && !$('#tokenControls input'), 'parameter-free variant hides adjustment inputs and reset');
    await parameterStage('parameter-free');
    await saved(() => input('#notesInput', 'パラメータなしでも保存'));
    check(stored.selectedId === 'A' && stored.variants.find(item => item.id === 'A').notes === 'パラメータなしでも保存', 'design-only variant saves notes and preserves adoption');
    const siblings = snapshot().filter(item => item.id !== 'A');
    await external(state => {
      const a = state.variants.find(item => item.id === 'A');
      a.tweaks = variant('A').tweaks;
      a.tweakValues = { heading: 32 }; a.baselineTweakValues = { heading: 32 };
      a.css = a.css.replace('font-size:32px', 'font-size:var(--heading-size)');
    });
    await until(() => $('#tweak-heading') && frame('A').srcdoc.includes('--heading-size:32px'), 'later parameter keeps appearance');
    check($('#baseControls').hidden && !$('#resetVariant').hidden && $('#tweak-heading').value === '32', 'later custom parameter appears without base controls');
    await parameterStage('parameter-added');
    await saved(() => input('#tweak-heading', 40));
    check(frame('A').srcdoc.includes('--heading-size:40px'), 'later parameter updates its target binding');
    await parameterStage('parameter-adjusted');
    await saved(() => $('#resetVariant').click());
    check(stored.variants.find(item => item.id === 'A').tweakValues.heading === 32 && stored.selectedId === 'A' && $('#notesInput').value === 'パラメータなしでも保存', 'later parameter reset preserves note and adoption');
    await parameterStage('parameter-reset');
    unchanged(siblings, 'later parameters leave siblings intact');

    // An active variant removed by a source revision must normalize focus safely.
    await external(state => { state.variants = state.variants.filter(item => item.id !== 'A'); state.selectedId = null; });
    check(visibleIds() === 'D' && $('#inspectorTitle').textContent.startsWith('D'), 'removed active variant falls back to first direction');
    check(!frame('A') && !before.find(item => item.id === 'A').element.isConnected, 'removed active preview is released');
    result.status = 'passed';
  }
  document.addEventListener('DOMContentLoaded', () => {
    run().catch(error => { result.status = 'failed'; result.error = error.stack; });
  }, { once: true });
})();
