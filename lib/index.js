/**
 * Host half: one tool, three actions. The tool is the whole plugin surface —
 * no settings page, no client bundle, no background work.
 */
import { DEFAULTS, setup, status, remove } from './provision.js';

const PARAMETERS = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['status', 'setup', 'remove'],
      description:
        'status: report whether the isolated environment exists and is usable. setup: create or refresh it (idempotent). remove: delete it, which also deletes its sessions.',
    },
    suffix: {
      type: 'string',
      description: "Isolated home suffix; `relay` means a sibling directory `~/.dsh-relay`. Defaults to the plugin's configured value.",
    },
    apiKey: {
      type: 'string',
      description:
        'AgentRouter key to store in the isolated home. Omit to reuse AGENTROUTER_API_KEY already present in the current DSH_HOME.',
    },
    desktopLauncher: {
      type: 'boolean',
      description: 'On Windows, also write a double-click launcher onto the Desktop. Defaults to true.',
    },
    force: {
      type: 'boolean',
      description: 'Required for `remove`; deleting the environment also deletes the sessions stored in it.',
    },
  },
  required: ['action'],
  additionalProperties: false,
};

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
    action: { type: 'string' },
    message: { type: 'string' },
  },
  required: ['ok'],
  additionalProperties: true,
};

function summarize(value) {
  const rows = [
    `action: ${value.action ?? 'unknown'}`,
    `home: ${value.home ?? '(unknown)'}`,
  ];
  if (value.profile) rows.push(`profile: ${value.profile}`);
  if (value.credentials) rows.push(`credentials: ${value.credentials}`);
  if (typeof value.routeInstalled === 'boolean') rows.push(`relay route installed: ${value.routeInstalled}`);
  if (typeof value.installed === 'boolean') rows.push(`relay route installed: ${value.installed}`);
  if (value.launcher) rows.push(`launcher: ${value.launcher}`);
  if (value.desktopLauncher) rows.push(`desktop launcher: ${value.desktopLauncher}`);
  if (value.removed !== undefined) rows.push(`removed: ${value.removed}`);
  if (value.message) rows.push(`note: ${value.message}`);
  if (value.launchCommand) rows.push(`launch: ${value.launchCommand}`);
  if (value.next) rows.push(`next: ${value.next}`);
  return rows.join('\n');
}

export const inject = ['tools'];

export function apply(ctx, config = {}) {
  const defaults = { ...DEFAULTS, ...config };

  const definition = {
    name: 'relay_isolation',
    description:
      'Create, inspect, or remove an isolated DSH_HOME dedicated to a third-party model relay. The isolated environment is a sibling directory of the current DSH_HOME with its own profile, sessions, storages, and a launcher; it holds only the relay credential, never the other keys. Use it when the user wants relay traffic kept out of their main Harness profile.',
    parameters: PARAMETERS,
    output: {
      schema: OUTPUT_SCHEMA,
      render(_args, value) {
        return [{ type: 'text', text: summarize(value || {}) }];
      },
    },
    async execute(args) {
      const options = {
        ...defaults,
        ...(typeof args?.suffix === 'string' && args.suffix.trim() ? { suffix: args.suffix.trim() } : {}),
        ...(typeof args?.apiKey === 'string' && args.apiKey.trim() ? { apiKey: args.apiKey.trim() } : {}),
        ...(typeof args?.desktopLauncher === 'boolean' ? { desktopLauncher: args.desktopLauncher } : {}),
        ...(typeof args?.force === 'boolean' ? { force: args.force } : {}),
      };
      switch (args?.action) {
        case 'setup':
          return setup(options);
        case 'remove':
          return remove(options);
        case 'status':
        default:
          return status(options);
      }
    },
  };

  ctx.effect(() => ctx.tools.register(definition));
}
