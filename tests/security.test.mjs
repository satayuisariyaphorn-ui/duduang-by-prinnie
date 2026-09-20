import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { validLineSignature, authorizedLineEvent } from '../scripts/security.mjs';

const secret = 'synthetic-line-secret';
const apiToken = 'synthetic-api-token-for-security-tests-only';
const sign = body => createHmac('sha256', secret).update(body).digest('base64');

test('LINE signatures cover original bytes and fail closed', () => {
  const body = Buffer.from('{"events":[],"text":"สวัสดี"}');
  assert.equal(validLineSignature(body, sign(body), secret), true);
  for (const signature of [undefined, '', 'invalid', [sign(body)], sign(Buffer.from('{}'))]) {
    assert.equal(validLineSignature(body, signature, secret), false);
  }
  assert.equal(validLineSignature(body, sign(body), ''), false);
  assert.equal(validLineSignature(Buffer.concat([body, Buffer.from(' ')]), sign(body), secret), false);
});

test('Owner restrictions cover text, audio, and empty configuration', () => {
  for (const type of ['text', 'audio', 'file']) {
    const event = { type: 'message', source: { userId: 'owner' }, message: { type } };
    assert.equal(authorizedLineEvent(event, ['owner']), true);
    assert.equal(authorizedLineEvent(event, []), false);
    assert.equal(authorizedLineEvent(event, ['someone-else']), false);
  }
  assert.equal(authorizedLineEvent({ type: 'message' }, ['owner']), false);
});

async function startServer(t, overrides = {}) {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  // Deliberately do not inherit any provider or owner credentials from the shell.
  const child = spawn(process.execPath, ['--import', './tests/no-network.mjs', 'server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: { PATH: process.env.PATH, PORT: String(port), LINE_CHANNEL_SECRET: secret,
      LINE_CHANNEL_ACCESS_TOKEN: 'synthetic-token', LINE_ADMIN_USERS: 'owner',
      ADMIN_API_TOKEN: apiToken, ...overrides },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', value => { logs += value; });
  child.stderr.on('data', value => { logs += value; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
    }
    assert.ok(!logs.includes('UNEXPECTED_TEST_NETWORK'), 'Rejected requests reached an outbound provider');
  });
  const origin = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 80; i++) {
    if (child.exitCode !== null) throw new Error(`Test server exited: ${logs}`);
    try { if ((await fetch(origin)).ok) return origin; } catch {}
    await delay(50);
  }
  throw new Error('Test server failed to start');
}

test('Actual HTTP server enforces boundaries before side effects', async t => {
  const origin = await startServer(t);
  const postWebhook = (body, signature) => fetch(`${origin}/webhook`, {
    method: 'POST', headers: { 'content-type': 'application/json',
      ...(signature ? { 'x-line-signature': signature } : {}) }, body,
  });
  await t.test('unsigned, forged, and oversized webhook bodies are rejected', async () => {
    assert.equal((await postWebhook('{"events":[]}')).status, 401);
    assert.equal((await postWebhook('{"events":[]}', 'forged')).status, 401);
    assert.equal((await postWebhook('x'.repeat(102401), sign('x'.repeat(102401)))).status, 413);
  });
  await t.test('LINE verification succeeds and unauthorized text/audio are ignored', async () => {
    const empty = '{"events":[]}';
    assert.equal((await postWebhook(empty, sign(empty))).status, 200);
    for (const type of ['text', 'audio']) {
      const body = JSON.stringify({ events: [{ type: 'message', source: { userId: 'outsider' },
        replyToken: 'synthetic', message: { type, id: 'synthetic', text: 'Long synthetic script without real data' } }] });
      assert.equal((await postWebhook(body, sign(body))).status, 200);
    }
  });
  await t.test('debug endpoints cannot send messages, query AI, or expose configuration', async () => {
    for (const path of ['/debug/env', '/debug/test-reply?uid=synthetic', '/debug/test-anthropic']) {
      assert.equal((await fetch(origin + path)).status, 404);
    }
  });
  await t.test('generation requires a valid owner token before parsing or work', async () => {
    const send = (authorization, body) => fetch(`${origin}/api/generate`, { method: 'POST',
      headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body });
    assert.equal((await send(undefined, '{broken')).status, 401);
    assert.equal((await send('Bearer wrong', '{}')).status, 401);
    assert.equal((await send(`Bearer ${apiToken}`, '{"text":"short"}')).status, 400);
    assert.equal((await send(`Bearer ${apiToken}`, '{"text":"a sufficiently long script","zodiac":"../outside"}')).status, 400);
  });
  await t.test('public media access excludes scripts and intermediate private files', async () => {
    const job = 'security_test_' + randomUUID().replaceAll('-', '');
    const dir = new URL(`../scripts/pipeline-output/${job}/`, import.meta.url);
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(new URL(`${job}_final.mp4`, dir), 'synthetic-video');
      writeFileSync(new URL('script.json', dir), '{"private":"synthetic"}');
      assert.equal((await fetch(`${origin}/clips/${job}/${job}_final.mp4`)).status, 200);
      assert.equal((await fetch(`${origin}/download/${job}`)).status, 200);
      assert.equal((await fetch(`${origin}/clips/${job}/script.json`)).status, 404);
      assert.equal((await fetch(`${origin}/clips/${job}/..%2fserver.mjs`)).status, 404);
      assert.equal((await fetch(`${origin}/download/..%2foutside`)).status, 404);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

test('Missing secrets disable entry points', async t => {
  const origin = await startServer(t, { ADMIN_API_TOKEN: '', LINE_CHANNEL_SECRET: '' });
  assert.equal((await fetch(`${origin}/api/generate`, { method: 'POST' })).status, 503);
  assert.equal((await fetch(`${origin}/webhook`, { method: 'POST' })).status, 503);
});
