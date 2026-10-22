import test from 'node:test';
import assert from 'node:assert/strict';
import { hostAllowed, fetchText, DEFAULT_ALLOWED_HOSTS } from '../lib/net.js';

test('only https URLs on the allowlist pass', () => {
  assert.equal(hostAllowed('https://registry.npmjs.org/dsh-relay-isolation'), true);
  assert.equal(hostAllowed('https://api.github.com/search/repositories?q=dsh'), true);
  assert.equal(hostAllowed('http://registry.npmjs.org/x'), false);
  assert.equal(hostAllowed('https://evil.example.com/'), false);
  assert.equal(hostAllowed('https://registry.npmjs.org.evil.example.com/'), false);
  assert.equal(hostAllowed('not a url'), false);
  assert.ok(DEFAULT_ALLOWED_HOSTS.includes('raw.githubusercontent.com'));
});

test('fetchText returns the body for an allowed host', async () => {
  const calls = [];
  const fake = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => '{"name":"dsh-relay-isolation"}',
    };
  };
  const result = await fetchText('https://registry.npmjs.org/dsh-relay-isolation', { fetchImpl: fake });
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.equal(result.contentType, 'application/json');
  assert.equal(result.truncated, false);
  assert.match(result.text, /dsh-relay-isolation/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.headers['user-agent'], 'dsh-relay-isolation');
});

test('fetchText truncates long bodies', async () => {
  const fake = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'text/plain' },
    text: async () => 'x'.repeat(5000),
  });
  const result = await fetchText('https://registry.npmjs.org/x', { fetchImpl: fake, maxBytes: 1000 });
  assert.equal(result.text.length, 1000);
  assert.equal(result.truncated, true);
});

test('fetchText refuses a host outside the allowlist without calling fetch', async () => {
  let called = false;
  const fake = async () => {
    called = true;
    return { ok: true, status: 200, headers: { get: () => '' }, text: async () => '' };
  };
  await assert.rejects(
    () => fetchText('https://evil.example.com/', { fetchImpl: fake }),
    /host not allowed/,
  );
  assert.equal(called, false);
});
