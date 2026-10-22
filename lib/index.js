/**
 * Host half: one tool, three actions. Provider details are parameters, not
 * hardcoded: the tool probes the endpoint when `api` is `auto`.
 */
import { DEFAULTS, setup, status, remove } from './provision.js';

const PARAMETERS = {
  type: 'object',
  properties: {
    action: {
      type: 'string',
      enum: ['status', 'setup', 'remove'],
      description:
        'status: report whether the isolated environment exists and is usable. setup: create or refresh it (idempotent, probes the endpoint). remove: delete it, which also deletes its sessions.',
    },
    suffix: {
      type: 'string',
      description: "Isolated home suffix; `relay` means a sibling directory `~/.dsh-relay`. Defaults to the plugin's configured value.",
    },
    apiKey: {
      type: 'string',
      description:
        'Credential to store in the isolated home. Omit to reuse the value already present under provider.apiKeyEnv in the current DSH_HOME.',
    },
    desktopLauncher: {
      type: 'boolean',
      description: 'On Windows, also write a double-click launcher onto the Desktop. Defaults to true.',
    },
    force: {
      type: 'boolean',
      description: 'Required for `remove`; deleting the environment also deletes the sessions stored in it.',
    },
    provider: {
      type: 'object',
      description:
        'Which endpoint to put into the generated profile. Omit fields to inherit the plugin config. `api: "auto"` probes /v1/responses then /v1/chat/completions.',
      properties: {
        preset: { type: 'string', description: 'agentrouter, or custom (default).' },
        id: { type: 'string', description: 'Provider id used in the model picker.' },
        api: { type: 'string', enum: ['auto', 'openai-completions', 'openai-responses', 'anthropic-messages'] },
        baseURL: { type: 'string', description: 'OpenAI-compatible base URL, for example https://host/v1.' },
        apiKeyEnv: { type: 'string', description: 'Credential reference name, for example MY_RELAY_KEY.' },
        models: {
          type: 'array',
          description: 'Model ids to declare. Empty means discover them from /v1/models.',
          items: { type: 'string' },
        },
        defaultModel: { type: 'string', description: 'Model preselected in the generated profile.' },
        reasoningEffort: { type: 'string' },
      },
      additionalProperties: false,
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
  if (value.provider) rows.push(`provider: ${value.provider}`);
  if (value.api) rows.push(`api: ${value.api}`);
  if (value.modelDiscovery) rows.push(`model discovery: ${value.modelDiscovery}`);
  if (Array.isArray(value.models) && value.models.length) rows.push(`models: ${value.models.join(', ')}`);
  if (value.defaultModel) rows.push(`default model: ${value.defaultModel}`);
  if (value.credentials) rows.push(`credentials: ${value.credentials}`);
  if (typeof value.routeInstalled === 'boolean') rows.push(`relay route installed: ${value.routeInstalled}`);
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
  const defaults = { ...DEFAULTS, ...config, provider: { ...DEFAULTS.provider, ...(config.provider ?? {}) } };

  const definition = {
    name: 'relay_isolation',
    description:
      'Create, inspect, or remove an isolated DSH_HOME dedicated to a third-party model relay or any OpenAI-compatible endpoint. The isolated environment is a sibling directory of the current DSH_HOME with its own profile, sessions, storages, and a launcher; it holds only the relay credential, never the other keys. Protocol and model catalog are probed at setup time.',
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
        provider: { ...defaults.provider, ...(args?.provider ?? {}) },
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
  console.log('[relay-isolation] tool ready: relay_isolation');
}
