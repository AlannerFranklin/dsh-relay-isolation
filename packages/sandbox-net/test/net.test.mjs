import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../lib/index.js';
import { hostAllowed, fetchText, DEFAULT_ALLOWED_HOSTS } from '../lib/net.js';

function fakeContext() {
  const state = { registered: [] };
  return {
    state,
    ctx: {
      tools: { register(definition) { state.registered.push(definition); return () => {}; } },
      effect(fn) { const cleanup = fn(); return () => cleanup?.(); },
    },
  };
}

test('apply registers fetch_url', () => {
  const { ctx, state } = fakeContext();
  apply(ctx, {});
  assert.equal(state.registered.length, 1);
  const tool = state.registered[0];
  assert.equal(tool.name, 'fetch_url');
  assert.deepEqual(tool.parameters.required, ['url']);
  assert.equal(tool.output.schema.type, 'object');
});

test('the allowlist is enforced and can be widened', () => {
  assert.equal(hostAllowed('https://registry.npmjs.org/x'), true);
  assert.equal(hostAllowed('https://evil.example.com/'), false);
  assert.equal(hostAllowed('http://registry.npmjs.org/x'), false);
  assert.equal(hostAllowed('https://evil.example.com/', ['*']), true);
  assert.ok(DEFAULT_ALLOWED_HOSTS.includes('api.github.com'));
});

test('fetchText returns the body for an allowed host', async () => {
  const fake = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => 'text/plain' },
    text: async () => 'hello',
  });
  const result = await fetchText('https://registry.npmjs.org/x', { fetchImpl: fake });
  assert.equal(result.status, 200);
  assert.equal(result.text, 'hello');
  assert.equal(result.truncated, false);
});

test('fetchText refuses a host outside the allowlist', async () => {
  let called = false;
  const fake = async () => {
    called = true;
    return { ok: true, status: 200, headers: { get: () => '' }, text: async () => '' };
  };
  await assert.rejects(() => fetchText('https://evil.example.com/', { fetchImpl: fake }), /host not allowed/);
  assert.equal(called, false);
});

test('the tool maps a rejected host to an error result', async () => {
  const { ctx, state } = fakeContext();
  apply(ctx, { allowedHosts: ['registry.npmjs.org'] });
  const result = await state.registered[0].execute({ url: 'https://evil.example.com/' });
  assert.equal(result.ok, false);
  assert.match(result.error, /host not allowed/);
});
