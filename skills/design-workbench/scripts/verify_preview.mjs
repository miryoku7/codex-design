#!/usr/bin/env node
// One-command browser verification for a running Design Workbench preview.
//
// It replaces the hand-written, multi-step browser checks an agent otherwise improvises
// (each step costs a model round trip). One run does:
//   - load the page, capture console errors
//   - screenshot the compare view and every direction at the chosen viewport
//   - flag horizontal page overflow and design content larger than its preview frame
//   - exercise each direction's range controls (tweaks first, then the base colors/sizes) with the
//     KEYBOARD: value changes, focus stays, the design visibly changes, the save status returns to
//     "saved", then the value is restored
//   - reload and confirm a changed value survives (then restore it)
//   - for a library work: confirm it is listed in its project (and under the expected kind)
//
// Usage:
//   node verify_preview.mjs --url http://127.0.0.1:8787/designs/<id> [--out DIR]
//        [--viewport 1440x900] [--controls 4] [--no-mutate] [--lang ja|en]
//        [--expect-kind screen|component] [--no-library]
//
// --no-mutate: read-only (screenshots + errors + overflow). Without it the script changes and then
// restores control values, which bumps the saved revision but leaves the design as it was.
// Requires Node 22+ (global WebSocket) and Chrome/Chromium (CHROME_PATH to override).
// It does not judge visual quality. Look at the screenshots it writes, once.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const SAVED = /保存済み|saved/i;

export function expectedRangeControls(variant) {
  return ['spacing', 'fontSize', 'radius'].filter(key => Object.hasOwn(variant.tokens || {}, key)).length
    + (variant.tweaks || []).filter(control => control.type === 'range').length;
}

export function parseArgs(argv) {
  const out = { viewport: '1440x900', controls: 4, mutate: true, lang: null, out: null, url: null, expectKind: null, library: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--url') out.url = next();
    else if (a === '--out') out.out = next();
    else if (a === '--viewport') out.viewport = next();
    else if (a === '--controls') out.controls = Number(next());
    else if (a === '--lang') out.lang = next();
    else if (a === '--no-mutate') out.mutate = false;
    else if (a === '--no-library') out.library = false;
    else if (a === '--expect-kind') out.expectKind = next();
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!out.url) throw new Error('--url is required');
  const m = /^(\d{3,4})x(\d{3,4})$/.exec(out.viewport);
  if (!m) throw new Error('--viewport must look like 1440x900');
  out.width = Number(m[1]);
  out.height = Number(m[2]);
  if (!Number.isInteger(out.controls) || out.controls < 0 || out.controls > 12) throw new Error('--controls must be 0-12');
  if (out.lang && !['ja', 'en'].includes(out.lang)) throw new Error('--lang must be ja or en');
  if (out.expectKind && !['screen', 'component'].includes(out.expectKind)) throw new Error('--expect-kind must be screen or component');
  const u = new URL(out.url);
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname)) throw new Error('Only loopback URLs can be verified');
  return out;
}

export function findChrome(env = process.env, exists = existsSync) {
  const candidates = [
    env.CHROME_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  const found = candidates.find((p) => exists(p));
  if (!found) throw new Error('Chrome/Chromium not found. Set CHROME_PATH.');
  return found;
}

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && this.pending.has(m.id)) {
        const { ok, fail } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? fail(new Error(m.error.message)) : ok(m.result);
      } else if (m.method) this.listeners.forEach((fn) => fn(m.method, m.params));
    };
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((ok, fail) => this.pending.set(id, { ok, fail }));
  }
  on(fn) { this.listeners.push(fn); }
}

async function launch(width, height) {
  const chrome = findChrome();
  const dir = join(tmpdir(), `dw-verify-${process.pid}`);
  const args = [
    '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-sandbox', '--hide-scrollbars',
    '--no-first-run', '--no-default-browser-check', `--window-size=${width},${height}`, 'about:blank',
  ];
  if (!/headless-shell/.test(chrome)) args.unshift('--headless=new');
  const proc = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('Chrome did not start')), 15000);
    let buf = '';
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(buf);
      if (m) { clearTimeout(timer); ok(m[1]); }
    });
    proc.on('exit', () => fail(new Error('Chrome exited early')));
  });
  const port = new URL(wsUrl).port;
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = list.find((t) => t.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  return { proc, cdp: new Cdp(ws), dir };
}

export async function verify(opts) {
  const started = Date.now();
  const out = resolve(opts.out || join('.design-workbench', 'evidence', `verify-${new Date().toISOString().replace(/[:.]/g, '-')}`));
  await mkdir(out, { recursive: true });
  const { proc, cdp, dir: profileDir } = await launch(opts.width, opts.height);
  const checks = [];
  const shots = [];
  const consoleErrors = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok, detail });
  try {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: opts.width, height: opts.height, deviceScaleFactor: 1, mobile: false });
    cdp.on((method, p) => {
      if (method === 'Runtime.exceptionThrown') consoleErrors.push(p.exceptionDetails.exception?.description || p.exceptionDetails.text);
      if (method === 'Runtime.consoleAPICalled' && p.type === 'error') consoleErrors.push(p.args.map((a) => a.value ?? a.description).join(' '));
    });
    if (opts.lang) await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `try{localStorage.setItem('codex-design.locale',${JSON.stringify(opts.lang)})}catch(_){}` });
    const ev = async (expression) => {
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    const waitFor = async (expr, timeout = 6000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        if (await ev(expr).catch(() => false)) return true;
        await sleep(100);
      }
      return false;
    };
    const shot = async (name) => {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
      const file = join(out, `${name}.png`);
      await writeFile(file, Buffer.from(r.data, 'base64'));
      shots.push(file);
      return file;
    };
    const key = async (k) => {
      const c = { ArrowRight: 39, ArrowLeft: 37 }[k];
      for (const type of ['rawKeyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key: k, code: k, windowsVirtualKeyCode: c, nativeVirtualKeyCode: c });
    };
    // Put a control back to `target` with real key presses (as many as needed, capped), then wait for "saved".
    const restore = async (id, target, { wait = true } = {}) => {
      const q = JSON.stringify(id);
      for (let n = 0; n < 12; n++) {
        const cur = Number(await ev(`document.getElementById(${q})?.value`));
        if (cur === target) break;
        await ev(`document.getElementById(${q})?.focus()`);
        await key(cur > target ? 'ArrowLeft' : 'ArrowRight');
      }
      if (wait) await waitFor(statusSaved, 6000);
      return Number(await ev(`document.getElementById(${q})?.value`));
    };
    // Pixels of the visible design frame: the only reliable way to tell a control really changed the design.
    const frameSnapshot = async () => {
      const r = await ev(`(() => { const f = [...document.querySelectorAll('#variantGrid iframe')].find((x) => x.getBoundingClientRect().width > 0); if (!f) return null; const b = f.getBoundingClientRect(); return { x: b.left + scrollX, y: b.top + scrollY, width: b.width, height: b.height }; })()`);
      if (!r) return null;
      return (await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...r, scale: 1 } })).data;
    };
    // Range controls of the open direction: its own tweaks first, then the base colors/sizes (opened on demand).
    const listRanges = async () => ev(`(() => { const d = document.getElementById('baseControls'); if (d) d.open = true; return [...document.querySelectorAll('#tweakControls input[type=range], #tokenControls input[type=range]')].map((i) => i.id); })()`);
    const statusSaved = `(() => { const s = document.getElementById('saveStatus'); return !!s && ${SAVED}.test(s.innerText); })()`;
    const openView = async (id) => {
      await ev(`document.querySelector('#viewNav [data-view="${id}"]').click()`);
      await sleep(350);
    };

    await cdp.send('Page.navigate', { url: opts.url });
    const loaded = await waitFor(`document.querySelectorAll('#variantTabs .view-button').length > 0`, 15000);
    if (!loaded) {
      add('load', false, 'No direction tabs appeared. Is the preview server running and the URL a design page?');
      return { out, checks, shots, consoleErrors, ms: Date.now() - started };
    }
    await waitFor(statusSaved, 8000);
    const statePath = new URL(opts.url).pathname.match(/^\/designs\/([^/]+)\/?$/);
    const stateUrl = statePath ? `/api/designs/${statePath[1]}/state` : '/api/state';
    const stateResponse = await fetch(new URL(stateUrl, opts.url));
    if (!stateResponse.ok) throw new Error(`Cannot read declared controls: ${stateResponse.status}`);
    const declared = (await stateResponse.json()).state.variants;
    const views = await ev(`[...document.querySelectorAll('#variantTabs .view-button')].map(b => ({ id: b.dataset.view, name: b.innerText.trim().replace(/\\s+/g, ' ') }))`);
    add('load', true, `${views.length} directions: ${views.map((v) => v.name).join(' / ')}`);

    // Compare view
    await openView('compare');
    await sleep(500);
    await shot('compare');
    const overflow = await ev(`(() => { const e = document.scrollingElement; return { x: e.scrollWidth - innerWidth }; })()`);
    add('compare: no horizontal page overflow', overflow.x <= 1, overflow.x > 1 ? `page is ${overflow.x}px wider than the viewport` : '');
    const frames = await ev(`[...document.querySelectorAll('#variantGrid iframe')].map((f, i) => { try { const d = f.contentDocument.documentElement; return { i, w: f.clientWidth, h: f.clientHeight, sw: d.scrollWidth, sh: d.scrollHeight }; } catch (e) { return { i, unreadable: true }; } })`);
    const clipped = frames.filter((f) => !f.unreadable && (f.sw > f.w + 2 || f.sh > f.h + 2));
    add('compare: design content fits its frame', clipped.length === 0, clipped.map((f) => `frame ${f.i}: content ${f.sw}x${f.sh} in ${f.w}x${f.h}`).join('; '));

    // Each direction
    for (const v of views) {
      await openView(v.id);
      await sleep(500);
      await shot(`direction-${v.id}`);
      const ranges = await listRanges();
      const definition = declared.find(item => item.id === v.id);
      const expectedRanges = definition ? expectedRangeControls(definition) : -1;
      add(`${v.id}: declared range controls rendered`, ranges.length === expectedRanges, `${ranges.length} of ${expectedRanges} range control(s); zero is valid for a design without range parameters`);
      const inspectorVisible = await ev(`(() => { const i = document.getElementById('inspector'); return !!i && !i.hidden && i.getBoundingClientRect().width > 0; })()`);
      add(`${v.id}: inspector visible next to the design`, inspectorVisible);
      if (!opts.mutate) continue;
      const picked = ranges.slice(0, opts.controls);
      for (const id of picked) {
        const label = `${v.id}: ${id}`;
        const before = Number(await ev(`document.getElementById(${JSON.stringify(id)}).value`));
        const max = Number(await ev(`document.getElementById(${JSON.stringify(id)}).max`));
        const min = Number(await ev(`document.getElementById(${JSON.stringify(id)}).min`));
        const up = before + 1 <= max || before <= min;
        const pixelsBefore = await frameSnapshot();
        await ev(`document.getElementById(${JSON.stringify(id)}).focus()`);
        for (let n = 0; n < 2; n++) await key(up ? 'ArrowRight' : 'ArrowLeft');
        await sleep(350);
        const pixelsAfter = await frameSnapshot();
        const focusKept = await ev(`document.activeElement && document.activeElement.id === ${JSON.stringify(id)}`);
        const changed = Number(await ev(`document.getElementById(${JSON.stringify(id)})?.value`));
        const saved = await waitFor(statusSaved, 6000);
        add(`${label}: keyboard change applies`, changed !== before, `${before} -> ${changed}`);
        if (pixelsBefore && pixelsAfter) add(`${label}: visibly changes the design`, pixelsBefore !== pixelsAfter, pixelsBefore === pixelsAfter ? 'the preview is pixel-identical after the change; the control may not be wired to the design' : '');
        add(`${label}: keyboard focus stays on the control`, !!focusKept, focusKept ? '' : 'focus was lost after the value changed');
        add(`${label}: save status returns to saved`, saved);
        const restored = await restore(id, before, { wait: id === picked[picked.length - 1] });
        add(`${label}: value restored`, restored === before, restored === before ? '' : `expected ${before}, got ${restored}`);
      }
    }

    // Reload persistence
    if (opts.mutate && views.length) {
      const v = views[0];
      await openView(v.id);
      const id = await ev(`document.querySelector('#tweakControls input[type=range]')?.id || null`);
      if (id) {
        const before = Number(await ev(`document.getElementById(${JSON.stringify(id)}).value`));
        const max = Number(await ev(`document.getElementById(${JSON.stringify(id)}).max`));
        const up = before < max;
        await ev(`document.getElementById(${JSON.stringify(id)}).focus()`);
        for (let n = 0; n < 2; n++) await key(up ? 'ArrowRight' : 'ArrowLeft');
        await waitFor(statusSaved, 6000);
        const changed = Number(await ev(`document.getElementById(${JSON.stringify(id)}).value`));
        await cdp.send('Page.reload');
        await waitFor(`document.querySelectorAll('#variantTabs .view-button').length > 0`, 15000);
        await waitFor(statusSaved, 8000);
        await openView(v.id);
        const after = Number(await ev(`document.getElementById(${JSON.stringify(id)})?.value`));
        add(`reload: ${v.id} ${id} survives a reload`, after === changed, `${changed} -> ${after}`);
        const restored = await restore(id, before);
        add(`reload: ${v.id} ${id} restored`, restored === before, restored === before ? '' : `expected ${before}, got ${restored}`);
      }
    }
    // Library work: is it listed in its project (and under the expected kind)?
    if (opts.library) {
      const pathParts = new URL(opts.url).pathname.split('/').filter(Boolean);
      const back = await ev(`(() => { const a = document.getElementById('libraryBack'); return a && !a.hidden ? a.getAttribute('href') : null; })()`).catch(() => null);
      if (pathParts[0] === 'designs' && pathParts[1] && back) {
        const id = pathParts[1];
        const has = `[...document.querySelectorAll('a[href^="/designs/${id}"]')].length > 0`;
        await cdp.send('Page.navigate', { url: new URL(back, opts.url).href });
        const listed = await waitFor(has, 10000);
        add('library: work is listed in its project', listed, listed ? '' : `no link to ${id} on ${back}`);
        if (listed && opts.expectKind) {
          const idx = opts.expectKind === 'screen' ? 1 : 2; // filters: all, screens, components, favorites
          await ev(`document.querySelectorAll('button[aria-pressed]')[${idx}]?.click()`);
          await sleep(500);
          add(`library: work is listed under ${opts.expectKind}s`, await ev(has), 'not visible under that filter; it may have been saved with the wrong kind');
        }
        await shot('library-list');
      }
    }
    add('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  } finally {
    try { cdp.ws.close(); } catch { /* already closed */ }
    proc.stderr.destroy();
    proc.kill('SIGKILL');
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
  }
  return { out, checks, shots, consoleErrors, ms: Date.now() - started };
}

export function summarize(result, opts) {
  const failed = result.checks.filter((c) => !c.ok);
  const lines = result.checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  lines.push('', `${failed.length ? 'FAIL' : 'PASS'}: ${result.checks.length - failed.length}/${result.checks.length} checks in ${(result.ms / 1000).toFixed(1)}s at ${opts.width}x${opts.height}${opts.mutate ? '' : ' (read-only)'}`);
  lines.push(`Screenshots (${result.shots.length}) in ${result.out}`);
  lines.push('Automated checks do not judge visual quality: open the screenshots and review composition, wrapping and legibility.');
  return { text: lines.join('\n'), failed: failed.length };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const result = await verify(opts);
  const { text, failed } = summarize(result, opts);
  await writeFile(join(result.out, 'verify-report.json'), JSON.stringify({ url: opts.url, viewport: { width: opts.width, height: opts.height }, mutate: opts.mutate, ...result }, null, 2));
  console.log(text);
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`verify_preview: ${e.message}`); process.exit(2); });
}
