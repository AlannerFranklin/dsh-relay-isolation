import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setup, status, remove, isolatedHome, readKey, resolveCli, probeProvider } from '../lib/provision.js';

const PROVIDER = Object.freeze({
  id: 'testrelay',
  baseURL: 'https://relay.test/v1',
  apiKeyEnv: 'TEST_RELAY_KEY',
  api: 'openai-completions',
  models: ['m-one'],
  defaultModel: 'm-one',
});

function fixture({ key = 'sk-test-1234567890' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-relay-isolation-'));
  const baseHome = path.join(root, 'main-home');
  fs.mkdirSync(baseHome, { recursive: true });
  if (key) {
    fs.writeFileSync(
      path.join(baseHome, '.credentials.yaml'),
      `version: 1\nrefs:\n  OTHER_KEY: sk-other\n  TEST_RELAY_KEY: ${key}\n`,
      'utf8',
    );
  }
  const options = {
    baseHome,
    cli: 'dsh-test',
    desktopLauncher: false,
    network: false,
    provider: { ...PROVIDER },
  };
  return { root, baseHome, options };
}

test('the isolated home is a sibling, never a child, of the main home', () => {
  assert.equal(isolatedHome(path.join(os.tmpdir(), 'x', '.dsh'), 'relay'), path.join(os.tmpdir(), 'x', '.dsh-relay'));
  assert.notEqual(path.dirname(isolatedHome('/a/.dsh', 'relay')), '/a/.dsh');
});

test('setup writes a provider-agnostic profile and copies only the relay key', async () => {
  const { options } = fixture();
  const result = await setup(options);

  assert.equal(result.ok, true);
  assert.equal(result.provider, 'testrelay');
  assert.equal(result.api, 'openai-completions');
  assert.equal(result.credentials, 'written');
  assert.equal(result.home, isolatedHome(options.baseHome, 'relay'));

  const profileDir = path.join(result.home, 'profiles', 'relay');
  for (const name of ['package.json', 'pnpm-workspace.yaml', 'cordis.yml', 'cordis.patch.yml']) {
    assert.ok(fs.existsSync(path.join(profileDir, name)), `${name} exists`);
  }

  const manifest = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
  assert.deepEqual(manifest.dsh.profile.bundles, ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app']);

  const patch = fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /provider: testrelay/);
  assert.match(patch, /model: m-one/);
  assert.match(patch, /api: openai-completions/);
  assert.match(patch, /baseURL: https:\/\/relay\.test\/v1/);
  assert.doesNotMatch(patch, /llm-agentrouter/);

  const credentials = fs.readFileSync(path.join(result.home, '.credentials.yaml'), 'utf8');
  assert.match(credentials, /TEST_RELAY_KEY: sk-test-1234567890/);
  assert.doesNotMatch(credentials, /OTHER_KEY|sk-other/);
  assert.equal(readKey(options.baseHome, 'TEST_RELAY_KEY'), 'sk-test-1234567890');
});

test('the agentrouter preset adds the fence bundle and its row', async () => {
  const { options } = fixture();
  const result = await setup({
    ...options,
    provider: { preset: 'agentrouter', api: 'openai-responses', models: ['gpt-x'], defaultModel: 'gpt-x' },
  });
  const profileDir = path.join(result.home, 'profiles', 'relay');
  const manifest = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));
  assert.ok(manifest.dsh.profile.bundles.includes('dsh-llm-agentrouter'));
  const patch = fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /baseURL: https:\/\/relay\.agentrouter\.internal\/v1/);
  assert.match(patch, /api: openai-responses/);
  assert.match(patch, /- id: llm-agentrouter/);
  assert.match(patch, /silentRetryAttempts: 6/);
});

test('without a key the environment is still usable, and re-running keeps an existing key', async () => {
  const { options } = fixture({ key: null });
  const first = await setup(options);
  assert.equal(first.credentials, 'missing');
  assert.equal(fs.existsSync(path.join(first.home, '.credentials.yaml')), false);

  fs.writeFileSync(path.join(first.home, '.credentials.yaml'), 'refs:\n  TEST_RELAY_KEY: sk-kept\n', 'utf8');
  const second = await setup(options);
  assert.equal(second.credentials, 'kept');
  assert.match(fs.readFileSync(path.join(first.home, '.credentials.yaml'), 'utf8'), /sk-kept/);
});

test('status reports the created environment without touching it', async () => {
  const { options } = fixture();
  await setup(options);
  const before = fs.readFileSync(path.join(isolatedHome(options.baseHome, 'relay'), '.credentials.yaml'), 'utf8');
  const result = status(options);

  assert.equal(result.ok, true);
  assert.equal(result.exists, true);
  assert.equal(result.configured, true);
  assert.equal(result.credentials, 'present (18 chars)');
  assert.ok(result.launcher);
  assert.match(result.launchCommand, /dsh-test/);
  assert.equal(fs.readFileSync(path.join(isolatedHome(options.baseHome, 'relay'), '.credentials.yaml'), 'utf8'), before);
});

test('remove refuses without force and deletes with it', async () => {
  const { options } = fixture();
  const { home } = await setup(options);

  const refused = remove(options);
  assert.equal(refused.ok, false);
  assert.equal(fs.existsSync(home), true);

  const forced = remove({ ...options, force: true });
  assert.equal(forced.ok, true);
  assert.equal(forced.removed, true);
  assert.equal(fs.existsSync(home), false);
});

test('setup refuses to target the main home itself', async () => {
  const { baseHome, options } = fixture();
  await assert.rejects(() => setup({ ...options, home: baseHome }), /must differ/);
});

test('probe detects the Responses API and discovers models without a catalog', async () => {
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET' });
    if (String(url).endsWith('/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'alpha' }, { id: 'beta' }] }), { status: 200 });
    }
    if (String(url).endsWith('/responses')) {
      return new Response('{"id":"resp"}', { status: 200 });
    }
    return new Response('{"error":"no"}', { status: 400 });
  };
  try {
    const result = await probeProvider({
      api: 'auto',
      baseURL: 'https://relay.test/v1',
      probeBaseURL: 'https://relay.test/v1',
      models: [],
      defaultModel: '',
    }, { apiKey: 'sk-x' });
    assert.equal(result.api, 'openai-responses');
    assert.deepEqual(result.models, ['alpha', 'beta']);
    assert.equal(result.discovery, 'discovered');
    assert.ok(calls.some((call) => call.url.endsWith('/models')));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('resolveCli falls back to the default desktop installation outside the host', () => {
  const localAppData = 'C:\\Users\\X\\AppData\\Local';
  const expected = path.join(localAppData, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd');
  const resolved = resolveCli({
    env: { LOCALAPPDATA: localAppData },
    execPath: 'C:\\Program Files\\nodejs\\node.exe',
    platform: 'win32',
    exists: (candidate) => candidate === expected,
  });
  assert.equal(resolved, expected);
});
