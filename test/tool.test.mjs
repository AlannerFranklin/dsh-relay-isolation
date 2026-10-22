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

test('apply registers one tool with the documented parameters and renderer', () => {
  const { ctx, state } = fakeContext();
  apply(ctx, {});

  const names = state.registered.map((entry) => entry.name);
  assert.deepEqual(names, ['relay_isolation', 'relay_fetch']);

  const definition = state.registered.find((entry) => entry.name === 'relay_isolation');
  assert.ok(definition, 'the isolation tool was registered');
  assert.deepEqual(definition.parameters.required, ['action']);
  assert.deepEqual(definition.parameters.properties.action.enum, ['status', 'setup', 'remove']);
  assert.equal(definition.parameters.additionalProperties, false);
  assert.equal(typeof definition.execute, 'function');
  assert.equal(definition.output.schema.type, 'object');

  const blocks = definition.output.render({}, { action: 'status', home: '/tmp/.dsh-relay' });
  assert.equal(blocks[0].type, 'text');
  assert.match(blocks[0].text, /^action: status/);
  assert.match(blocks[0].text, /home: \/tmp\/\.dsh-relay/);
});

test('the tool provisions, reports, and removes an isolated home', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-relay-tool-'));
  const baseHome = path.join(root, '.dsh');
  fs.mkdirSync(baseHome, { recursive: true });
  fs.writeFileSync(path.join(baseHome, '.credentials.yaml'), 'refs:\n  AGENTROUTER_API_KEY: sk-tool-test\n', 'utf8');

  const previous = process.env.DSH_HOME;
  process.env.DSH_HOME = baseHome;
  try {
    const { ctx, state } = fakeContext();
    apply(ctx, { desktopLauncher: false });
    const isolation = state.registered.find((entry) => entry.name === 'relay_isolation');

    const created = await isolation.execute({ action: 'setup', suffix: 'probe' });
    assert.equal(created.ok, true);
    assert.equal(created.credentials, 'written');
    assert.equal(created.home, path.join(root, '.dsh-probe'));
    assert.ok(fs.existsSync(path.join(created.home, 'profiles', 'relay', 'cordis.patch.yml')));

    const reported = await isolation.execute({ action: 'status', suffix: 'probe' });
    assert.equal(reported.exists, true);
    assert.equal(reported.configured, true);
    assert.equal(reported.credentials, 'present (12 chars)');

    const refused = await isolation.execute({ action: 'remove', suffix: 'probe' });
    assert.equal(refused.ok, false);

    const removed = await isolation.execute({ action: 'remove', suffix: 'probe', force: true });
    assert.equal(removed.removed, true);
    assert.equal(fs.existsSync(created.home), false);
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = previous;
  }
});
