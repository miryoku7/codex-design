// Run: node tests/workbench-pdf.browser.mjs
// Open the printed URL in a real browser, then inspect window.pdfRegression.
// This server only reads checked-in assets. All state requests are intercepted in
// the dedicated page; it has no D1, workspace session, or write endpoint.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const assets = new URL('../skills/design-workbench/assets/workbench/', import.meta.url);
const server = createServer(async (request, response) => {
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  try {
    if (request.method !== 'GET') {
      response.writeHead(405).end('Read-only regression server');
      return;
    }
    let body, type;
    if (path === '/designs/pdf-regression') {
      body = (await readFile(new URL('index.html', assets), 'utf8'))
        .replace(/((?:src|href)=["'])(styles\.css|i18n\.js|preview\.js|app\.js)(["'])/g, '$1/workbench/$2$3')
        .replace('<head>', '<head><script src="/regression.js"></script>');
      type = 'text/html';
    } else if (path === '/regression.js') {
      body = await readFile(new URL('workbench-pdf.browser.js', import.meta.url));
      type = 'text/javascript';
    } else if (/^\/workbench\/(app\.js|i18n\.js|preview\.js|styles\.css|legacy-v1\.css)$/.test(path)) {
      body = await readFile(new URL(path.split('/').pop(), assets));
      type = path.endsWith('.css') ? 'text/css' : 'text/javascript';
    } else {
      response.writeHead(404).end('No endpoint here');
      return;
    }
    response.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store' }).end(body);
  } catch (error) {
    response.writeHead(500).end(String(error));
  }
});
server.listen(0, '127.0.0.1', () => {
  console.log(`PDF regression: http://127.0.0.1:${server.address().port}/designs/pdf-regression`);
});
