import { test } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createAppServer, termMatchers } from '../server';
import { emptySnapshot } from '../pipeline';

test('local server rejects cross-origin refreshes, wrong tokens and hostile hosts', async () => {
  let refreshes = 0;
  const port = 4398;
  const server = createAppServer(port, async () => { refreshes++; return emptySnapshot(); });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${port}`;
  try {
    const get = await fetch(`${origin}/api/meta`);
    assert.equal(get.status, 200);
    const { csrf } = await get.json() as { csrf: string };
    const list = await fetch(`${origin}/api/jobs`);
    assert.equal(list.status, 200);
    assert.ok(Array.isArray(((await list.json()) as { jobs: unknown[] }).jobs));
    assert.equal((await fetch(`${origin}/api/jobs/${encodeURIComponent('missing:job')}`)).status, 404);
    assert.equal((await fetch(`${origin}/api/search?q=engineer`)).status, 200);
    assert.equal((await fetch(`${origin}/api/refresh`, { method: 'POST' })).status, 403);
    assert.equal((await fetch(`${origin}/api/refresh`, { method: 'POST', headers: { Origin: 'https://evil.example', 'X-CSRF-Token': csrf } })).status, 403);
    assert.equal((await fetch(`${origin}/api/refresh`, { method: 'POST', headers: { Origin: origin, 'X-CSRF-Token': 'wrong' } })).status, 403);
    const hostileHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request({ hostname: '127.0.0.1', port, path: '/api/jobs', headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject); req.end();
    });
    assert.equal(hostileHostStatus, 403);
    assert.equal((await fetch(`${origin}/api/refresh`, { method: 'POST', headers: { Origin: origin, 'X-CSRF-Token': csrf } })).status, 202);
    assert.equal(refreshes, 1);
    assert.equal((await fetch(`${origin}/.env`)).status, 404);
    assert.equal((await fetch(`${origin}/api/unknown`)).status, 404);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('search terms match word starts, including symbols', () => {
  const [rust] = termMatchers('rust'), [cpp] = termMatchers('C++'), [kube] = termMatchers('kube');
  assert.equal(rust.test('we value trust'), false);
  assert.equal(rust.test('written in rust and go'), true);
  assert.equal(cpp.test('modern c++ experience'), true);
  assert.equal(kube.test('kubernetes clusters'), true);
});
