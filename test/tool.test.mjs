import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../lib/index.js';

/** Minimal stand-in for the Cordis context: record what apply() registers. */
function fakeContext() {
  const state = { registered: [], disposed: 0 };
  const ctx = {
    tools: {
      register(definition) {
        state.registered.push(definition);
        return () => {
          state.disposed += 1;
        };
      },
    },
    effect(fn) {
      const cleanup = fn();
      return () => cleanup?.();
    },
  };
  return { ctx, state };
}

const PROVIDER = {
  id: 'testrelay',
  baseURL: 'https://relay.test/v1',
  apiKeyEnv: 'TEST_RELAY_KEY',
  api: 'openai-completions',
  models: ['m-one'],
  defaultModel: 'm-one',
};

test('apply registers relay_isolation with provider parameters', () => {
  const { ctx, state } = fakeContext();
  apply(ctx, {});

  assert.equal(state.registered.length, 1);
  const definition = state.registered[0];
  assert.equal(definition.name, 'relay_isolation');
  assert.deepEqual(definition.parameters.required, ['action']);
  assert.deepEqual(definition.parameters.properties.action.enum, ['status', 'setup', 'remove']);
  assert.ok(definition.parameters.properties.provider);
  assert.equal(typeof definition.execute, 'function');

  const blocks = definition.output.render({}, { action: 'status', home: '/tmp/.dsh-relay' });
  assert.equal(blocks[0].type, 'text');
  assert.match(blocks[0].text, /home: \/tmp\/\.dsh-relay/);
});

test('the tool provisions, reports, and removes an isolated home', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-relay-tool-'));
  const baseHome = path.join(root, '.dsh');
  fs.mkdirSync(baseHome, { recursive: true });
  fs.writeFileSync(path.join(baseHome, '.credentials.yaml'), 'refs:\n  TEST_RELAY_KEY: sk-tool-test\n', 'utf8');

  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = baseHome;
  try {
    const { ctx, state } = fakeContext();
    apply(ctx, { desktopLauncher: false, network: false, provider: PROVIDER });
    const tool = state.registered[0];

    const created = await tool.execute({ action: 'setup', suffix: 'probe' });
    assert.equal(created.ok, true);
    assert.equal(created.credentials, 'written');
    assert.equal(created.api, 'openai-completions');
    assert.equal(created.home, path.join(root, '.dsh-probe'));
    assert.ok(fs.existsSync(path.join(created.home, 'profiles', 'relay', 'cordis.patch.yml')));

    const reported = await tool.execute({ action: 'status', suffix: 'probe' });
    assert.equal(reported.exists, true);
    assert.equal(reported.configured, true);
    assert.equal(reported.credentials, 'present (12 chars)');

    const refused = await tool.execute({ action: 'remove', suffix: 'probe' });
    assert.equal(refused.ok, false);

    const removed = await tool.execute({ action: 'remove', suffix: 'probe', force: true });
    assert.equal(removed.removed, true);
    assert.equal(fs.existsSync(created.home), false);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
  }
});
