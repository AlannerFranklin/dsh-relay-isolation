import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setup, status, remove, isolatedHome, readRelayKey, resolveCli } from '../lib/provision.js';

function fixture({ key = 'sk-test-1234567890' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-relay-isolation-'));
  const baseHome = path.join(root, 'main-home');
  fs.mkdirSync(baseHome, { recursive: true });
  if (key) {
    fs.writeFileSync(
      path.join(baseHome, '.credentials.yaml'),
      `version: 1\nrefs:\n  DEEPSEEK_API_KEY: sk-other\n  AGENTROUTER_API_KEY: ${key}\n`,
      'utf8',
    );
  }
  const options = { baseHome, cli: 'dsh-test', desktopLauncher: false };
  return { root, baseHome, options };
}

test('the isolated home is a sibling, never a child, of the main home', () => {
  assert.equal(isolatedHome(path.join(os.tmpdir(), 'x', '.dsh'), 'relay'), path.join(os.tmpdir(), 'x', '.dsh-relay'));
  assert.notEqual(path.dirname(isolatedHome('/a/.dsh', 'relay')), '/a/.dsh');
});

test('setup writes a working profile and copies only the relay key', () => {
  const { options } = fixture();
  const result = setup(options);

  assert.equal(result.ok, true);
  assert.equal(result.action, 'setup');
  assert.equal(result.credentials, 'written');
  assert.equal(result.home, isolatedHome(options.baseHome, 'relay'));

  const profileDir = path.join(result.home, 'profiles', 'relay');
  for (const name of ['package.json', 'pnpm-workspace.yaml', 'cordis.yml', 'cordis.patch.yml']) {
    assert.ok(fs.existsSync(path.join(profileDir, name)), `${name} exists`);
  }

  assert.ok(fs.existsSync(result.workspace), 'the dedicated workspace exists');
  assert.equal(result.workspace, path.join(result.home, 'workspace'));
  const launcherText = fs.readFileSync(result.launcher, 'utf8');
  assert.match(launcherText, /workspace/);
  assert.match(launcherText, /cd /, 'the launcher starts inside the workspace');

  const manifest = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'));  assert.deepEqual(manifest.dsh.profile.bundles, [
    '@deepseek-ai/dsh-base',
    '@deepseek-ai/dsh-web-app',
    'dsh-llm-agentrouter',
  ]);
  assert.equal(manifest.dependencies['dsh-llm-agentrouter'].startsWith('^'), true);

  const patch = fs.readFileSync(path.join(profileDir, 'cordis.patch.yml'), 'utf8');
  assert.match(patch, /provider: agentrouter/);
  assert.match(patch, /silentRetry: true/);
  assert.match(patch, /endpoint: cn/);

  const credentials = fs.readFileSync(path.join(result.home, '.credentials.yaml'), 'utf8');
  assert.match(credentials, /AGENTROUTER_API_KEY: sk-test-1234567890/);
  assert.doesNotMatch(credentials, /DEEPSEEK_API_KEY|sk-other/);
});

test('without a relay key the environment is still usable, and re-running keeps an existing key', () => {
  const { baseHome, options } = fixture({ key: null });
  const first = setup(options);
  assert.equal(first.credentials, 'missing');
  assert.equal(fs.existsSync(path.join(first.home, '.credentials.yaml')), false);

  fs.writeFileSync(path.join(first.home, '.credentials.yaml'), 'refs:\n  AGENTROUTER_API_KEY: sk-kept\n', 'utf8');
  const second = setup(options);
  assert.equal(second.credentials, 'kept');
  assert.match(fs.readFileSync(path.join(first.home, '.credentials.yaml'), 'utf8'), /sk-kept/);
  assert.equal(readRelayKey(baseHome), null);
});

test('status reports the created environment without touching it', () => {
  const { options } = fixture();
  setup(options);
  const before = fs.readFileSync(path.join(isolatedHome(options.baseHome, 'relay'), '.credentials.yaml'), 'utf8');
  const result = status(options);

  assert.equal(result.ok, true);
  assert.equal(result.exists, true);
  assert.equal(result.configured, true);
  assert.equal(result.credentials, 'present (18 chars)');
  assert.equal(result.routeInstalled, false);
  assert.match(result.launchCommand, /dsh-test/);
  assert.equal(fs.readFileSync(path.join(isolatedHome(options.baseHome, 'relay'), '.credentials.yaml'), 'utf8'), before);
});

test('remove refuses without force and deletes with it', () => {
  const { options } = fixture();
  const { home } = setup(options);

  const refused = remove(options);
  assert.equal(refused.ok, false);
  assert.equal(fs.existsSync(home), true);

  const forced = remove({ ...options, force: true });
  assert.equal(forced.ok, true);
  assert.equal(forced.removed, true);
  assert.equal(fs.existsSync(home), false);
});

test('setup refuses to target the main home itself', () => {
  const { baseHome, options } = fixture();
  assert.throws(() => setup({ ...options, home: baseHome }), /must differ/);
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
