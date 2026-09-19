(() => {
  'use strict';
  const I = window.DesignI18n;

  // Portable kit previews only use frameDocument; they do not load UI chrome.
  // Empty labels keep that renderer independent of the optional locale runtime.
  const TOKEN_DEFS = [
    {id:'accent',label:I?.msg("accent") || '',type:'color',default:'#4051ac'},
    {id:'background',label:I?.msg("background") || '',type:'color',default:'#ffffff'},
    {id:'text',label:I?.msg("text") || '',type:'color',default:'#252833'},
    {id:'spacing',label:I?.msg("spacing") || '',type:'range',default:24,min:0,max:128,step:1,unit:'px'},
    {id:'fontSize',label:I?.msg("text.size") || '',type:'range',default:16,min:10,max:48,step:1,unit:'px'},
    {id:'radius',label:I?.msg("corner.radius") || '',type:'range',default:8,min:0,max:32,step:1,unit:'px'}
  ];
  const FRAME_RESET = '*{box-sizing:border-box}html,body{min-height:100%;margin:0}body{color:var(--text);background:var(--background);font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Yu Gothic",sans-serif;font-size:var(--font-size)}button,input,select,textarea{font:inherit}button,a{touch-action:manipulation}:focus-visible{outline:3px solid var(--accent);outline-offset:3px}@media(prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}}';

  function escapeAttr(value) {
    return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  }

  function sanitizeTree(root) {
    root.querySelectorAll('form').forEach(form => {
      while (form.firstChild) form.parentNode.insertBefore(form.firstChild, form);
      form.remove();
    });
    root.querySelectorAll('script,iframe,object,embed,link,meta,base').forEach(element => element.remove());
    [root, ...root.querySelectorAll('*')].filter(element => element.attributes).forEach(element => {
      Array.from(element.attributes).forEach(attribute => {
        const name = attribute.name.toLowerCase();
        const value = attribute.value.trim().toLowerCase();
        if (name.startsWith('on') || name === 'srcdoc' ||
            (['href','src','xlink:href','action'].includes(name) && /^(javascript|vbscript):/.test(value))) {
          element.removeAttribute(attribute.name);
        }
      });
    });
  }

  function authoredDocument(variant) {
    const source = String(variant.html || '');
    if (!/<(?:!doctype\s+html|html(?:\s|>)|head(?:\s|>)|body(?:\s|>))/i.test(source)) {
      const template = document.createElement('template');
      template.innerHTML = source;
      sanitizeTree(template.content);
      return {body:template.innerHTML,styles:'',htmlAttrs:{},bodyAttrs:{},title:variant.name};
    }
    const parsed = new DOMParser().parseFromString(source, 'text/html');
    sanitizeTree(parsed.documentElement);
    const attributes = element => Object.fromEntries(Array.from(element.attributes, attr => [attr.name,attr.value]));
    return {
      body: parsed.body.innerHTML,
      styles: Array.from(parsed.head.querySelectorAll('style'), element => element.textContent).join('\n'),
      htmlAttrs: attributes(parsed.documentElement),
      bodyAttrs: attributes(parsed.body),
      title: parsed.title || variant.name
    };
  }

  function tweakValue(variant, definition) {
    return variant.tweakValues && Object.hasOwn(variant.tweakValues, definition.id)
      ? variant.tweakValues[definition.id] : definition.default;
  }

  function frameVariables(variant, kitTokens = []) {
    const tokens = {};
    TOKEN_DEFS.forEach(definition => {
      const value = variant.tokens?.[definition.id];
      tokens[definition.id] = definition.type === 'color'
        ? (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : definition.default)
        : (typeof value === 'number' && Number.isFinite(value) && value >= definition.min && value <= definition.max ? value : definition.default);
    });
    const variables = [
      `--accent:${tokens.accent}`, `--background:${tokens.background}`, `--text:${tokens.text}`,
      `--spacing:${tokens.spacing}px`, `--font-size:${tokens.fontSize}px`, `--radius:${tokens.radius}px`
    ];
    (variant.tweaks || []).forEach(definition => {
      if (definition.cssVar) variables.push(`${definition.cssVar}:${String(tweakValue(variant,definition))}${definition.unit || ''}`);
    });
    // Kit previews overlay a saved snapshot; the original variant stays untouched.
    // Draft values are filtered here as well as validated by the saving API.
    kitTokens.forEach(token => {
      const value = String(token.value);
      if (/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(token.name) && !token.name.startsWith('--') &&
          value && !/[;{}<>\\\x00-\x1f]/.test(value) && !/url\s*\(|@|\/\*/i.test(value)) {
        variables.push(`--${token.name}:${value}`);
      }
    });
    return variables.join(';');
  }

  function frameAttributes(variant) {
    const attributes = {};
    (variant.tweaks || []).forEach(definition => {
      if (definition.attribute) attributes[definition.attribute] = String(tweakValue(variant, definition));
    });
    return attributes;
  }

  function frameStyles(variant, legacyCss = '', authored = authoredDocument(variant), kitTokens = []) {
    return `${FRAME_RESET}\n${authored.styles ? authored.styles + '\n' : ''}${typeof variant.css === 'string' ? variant.css : legacyCss}\n:root{${frameVariables(variant,kitTokens)}}\n`;
  }

  function frameDocument(variant, legacyCss = '', kitTokens = []) {
    const authored = authoredDocument(variant);
    const rootAttributes = {lang:'ja', ...authored.htmlAttrs, ...frameAttributes(variant)};
    if (rootAttributes.style) rootAttributes.style += `;${frameVariables(variant,kitTokens)}`;
    const attributes = values => Object.entries(values).map(([key,value]) => `${key}="${escapeAttr(value)}"`).join(' ');
    const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none';";
    return `<!doctype html><html ${attributes(rootAttributes)}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>${escapeAttr(authored.title)}</title><style>${frameStyles(variant,legacyCss,authored,kitTokens).replace(/<\/style/gi,'<\\/style')}</style></head><body${Object.keys(authored.bodyAttrs).length ? ' ' + attributes(authored.bodyAttrs) : ''}>${authored.body}</body></html>`;
  }

  let printWindow = null;
  function openPrintView(snapshot) {
    // Open synchronously from the user's click so popup blockers can make a
    // clear decision. Only this task's previous print window is replaced.
    const popup = window.open('about:blank', '_blank');
    if (!popup) return false;
    if (printWindow && !printWindow.closed) printWindow.close();
    printWindow = popup;
    const doc = popup.document;
    doc.open();
    doc.write('<!doctype html><html lang="ja"><head><meta charset="utf-8"><title></title></head><body></body></html>');
    doc.close();
    doc.documentElement.lang = I.getLocale();
    popup.opener = null;
    I.attr(doc, 'title', `${snapshot.title} · ${snapshot.variants.map(v => v.id).join('・')} · PDF`);
    const add = (tag, text, parent = doc.body) => {
      const element = doc.createElement(tag);
      if (text !== undefined) I.text(element, text);
      parent.append(element);
      return element;
    };
    const width = Math.max(240, Math.min(2560, Number(snapshot.viewport.width) || 390));
    const height = Math.max(320, Math.min(2160, Number(snapshot.viewport.height) || 760));
    const style = add('style', undefined, doc.head);
    I.text(style, `
      *{box-sizing:border-box}body{margin:0;background:#eee;color:#252833;font:14px -apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif}
      .toolbar{padding:24px;max-width:900px;margin:auto}.toolbar h1{font-size:20px}.toolbar p{line-height:1.7}
      button{font:inherit;padding:10px 18px;margin-right:10px;border:1px solid #bbb;border-radius:6px;background:white;color:inherit;cursor:pointer}button:disabled{cursor:wait;opacity:.5}
      article{width:${width}px;margin:24px auto;background:white}h2{font-size:18px;margin:0;padding:16px 0;overflow-wrap:anywhere}
      iframe{display:block;width:${width}px;border:0;pointer-events:none}article{break-after:page}article:last-child{break-after:auto}
      @media print{html,body{margin:0;padding:0;width:${width}px;background:white;-webkit-print-color-adjust:exact;print-color-adjust:exact}.toolbar{display:none}article{margin:0}h2{break-after:avoid}}
    `);
    const toolbar = add('header'); toolbar.className = 'toolbar';
    add('h1', snapshot.title, toolbar);
    add('p', I.msg("choose.save.as.pdf.as.the.destination"), toolbar);
    add('p', I.msg("long.screens.create.tall.pdf.pages.fixed"), toolbar);
    const status = add('p', I.msg("preparing.images.and.fonts"), toolbar); status.setAttribute('role', 'status');
    const print = add('button', I.msg("save.as.pdf.print"), toolbar); print.disabled = true;
    const close = add('button', I.msg("close"), toolbar);
    close.addEventListener('click', () => popup.close());
    print.addEventListener('click', () => { popup.focus(); popup.print(); });
    // Cancel leaves this isolated snapshot open for another print attempt.
    popup.addEventListener('afterprint', () => { I.text(status, I.msg("print.dialog.closed.print.again.or.close")); });
    const bounded = promise => new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(I.error(I.msg("images.or.fonts.did.not.finish.loading"))), 15000);
      Promise.resolve(promise).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
    });
    const ready = snapshot.variants.map(variant => new Promise((resolve, reject) => {
      const section = add('article'); section.dataset.variant = variant.id;
      add('h2', `${variant.id} · ${variant.name}`, section);
      const frame = doc.createElement('iframe');
      I.attr(frame, 'title', I.msg("print.view", {p0: variant.id, p1: variant.name}));
      // Read access is needed only on these disposable print frames. Scripts
      // remain forbidden by BOTH sandbox and the original deny-network CSP.
      // Never add allow-scripts: same-origin plus scripts would defeat isolation.
      frame.setAttribute('sandbox', 'allow-same-origin');
      frame.setAttribute('referrerpolicy', 'no-referrer');
      frame.style.height = `${height}px`;
      frame.addEventListener('load', async () => {
        try {
          const inner = frame.contentDocument;
          if (!inner) throw I.error(I.msg("could.not.load.the.print.view"));
          const printStyle = inner.createElement('style');
          I.text(printStyle, `html,body{height:auto!important;max-height:none!important;overflow:visible!important;min-height:${height}px!important}*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}`);
          inner.head.append(printStyle);
          // Prevent print preparation from waiting for below-fold lazy images.
          const images = [...inner.images];
          images.forEach(image => { image.loading = 'eager'; });
          await bounded(Promise.all([inner.fonts.ready, ...images.map(image => image.decode())]));
          await new Promise(done => popup.requestAnimationFrame(() => popup.requestAnimationFrame(done)));
          frame.style.height = `${Math.max(height, inner.documentElement.scrollHeight, inner.body.scrollHeight)}px`;
          resolve();
        } catch (error) { reject(error); }
      }, { once: true });
      frame.srcdoc = frameDocument(variant, snapshot.legacyCss);
      section.append(frame);
    }));
    bounded(Promise.all(ready)).then(() => {
      if (popup.closed) return;
      // Chromium paginates and scales nested frames inconsistently on A4:
      // overflow text can disappear and labels can occupy empty pages. Keep
      // the authored width unscaled and fit each complete frame on one page.
      const pageHeight = Math.ceil(Math.max(...Array.from(doc.querySelectorAll('article'), article => article.getBoundingClientRect().height))) + 2;
      const pageStyle = add('style', undefined, doc.head);
      I.text(pageStyle, `@page{size:${width + 48}px ${pageHeight + 48}px;margin:24px}`);
      I.text(status, I.msg("directions.ready.use.the.button.to.open", {p0: snapshot.variants.length}));
      print.disabled = false;
      doc.body.dataset.printReady = 'true';
    }).catch(error => {
      if (!popup.closed) I.text(status, I.msg("close.this.view.and.export.again", {p0: I.errorMessage(error)}));
    });
    return true;
  }

  window.DesignPreview = Object.freeze({TOKEN_DEFS,tweakValue,authoredDocument,frameAttributes,frameStyles,frameDocument,openPrintView});
})();
