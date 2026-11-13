import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '../..');

createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  const relative = pathname === '/' ? 'tests/browser/fixture.html' : pathname.slice(1);
  const path = resolve(root, relative);

  if (
    !(
      path.startsWith(`${root}${sep}dist${sep}`) ||
      path === resolve(root, 'tests/browser/fixture.html') ||
      path === resolve(root, 'tests/browser/fixture.js')
    )
  ) {
    response.writeHead(404).end();

    return;
  }

  try {
    const data = await readFile(path);
    response
      .writeHead(200, {
        'Content-Type': path.endsWith('.html') ? 'text/html' : 'text/javascript',
        'Cache-Control': 'no-store',
      })
      .end(data);
  } catch {
    response.writeHead(404).end();
  }
}).listen(4177, '127.0.0.1');
