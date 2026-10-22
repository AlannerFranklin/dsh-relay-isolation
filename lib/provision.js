/**
 * Provisioning core for dsh-relay-isolation.
 *
 * Provider-agnostic: the template holds only the isolation scaffolding. Which
 * endpoint, protocol and models go into the generated profile come from
 * `options.provider`, and `api: 'auto'` probes the endpoint instead of assuming.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const IS_WINDOWS = process.platform === 'win32';

/** Defaults for every generated environment. */
export const DEFAULTS = Object.freeze({
  suffix: 'relay',
  profile: 'relay',
  desktopLauncher: true,
  network: true,
  networkPackage: 'dsh-sandbox-net',
  networkRange: '^0.1.0',
  routePackage: 'dsh-llm-agentrouter',
  routeRange: '^2.5.0',
  provider: Object.freeze({
    preset: 'custom',
    id: 'relay',
    api: 'auto',
    baseURL: '',
    apiKeyEnv: '',
    models: [],
    defaultModel: '',
    reasoningEffort: 'high',
  }),
});

const PRESETS = Object.freeze({
  agentrouter: Object.freeze({
    id: 'agentrouter',
    baseURL: 'https://relay.agentrouter.internal/v1',
    probeBaseURL: 'https://ps.air-outer.com/v1',
    probeUserAgent: 'claude-cli/2.1.300 (external, cli)',
    apiKeyEnv: 'AGENTROUTER_API_KEY',
    fence: true,
  }),
});

/** The running host's DSH_HOME, or the conventional default. */
export function currentHome(env = process.env) {
  return env.DSH_HOME || path.join(os.homedir(), '.dsh');
}

/**
 * The isolated home is a sibling of the current one (`~/.dsh` -> `~/.dsh-relay`),
 * never a child: a profile inside the same home would still share sessions,
 * storages, and credentials.
 */
export function isolatedHome(baseHome, suffix) {
  return path.join(path.dirname(baseHome), `.dsh-${suffix}`);
}

/** Read one credential reference out of `<home>/.credentials.yaml`. */
export function readKey(baseHome, name) {
  const file = path.join(baseHome, '.credentials.yaml');
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf8');
  const match = text.match(new RegExp(`^\\s+${name}:\\s*(.+?)\\s*$`, 'm'));
  if (!match) return null;
  return match[1].trim().replace(/^["']/, '').replace(/["']$/, '');
}

/** Backwards-compatible shorthand. */
export function readRelayKey(baseHome, name = 'AGENTROUTER_API_KEY') {
  return readKey(baseHome, name);
}

/**
 * Locate the dsh CLI that can install bundles and boot a profile.
 */
export function resolveCli({
  env = process.env,
  execPath = process.execPath,
  platform = process.platform,
  exists = fs.existsSync,
} = {}) {
  if (env.DSH_CLI && exists(env.DSH_CLI)) return env.DSH_CLI;
  const bin = platform === 'win32' ? 'dsh.cmd' : 'dsh';
  const exeDir = path.dirname(execPath);
  const candidates = [
    path.join(exeDir, 'resources', 'runtime', 'cli', 'bin', bin),
    path.join(exeDir, '..', 'Resources', 'runtime', 'cli', 'bin', bin),
    path.join(exeDir, '..', '..', 'Resources', 'runtime', 'cli', 'bin', bin),
  ];
  if (env.LOCALAPPDATA) {
    candidates.push(path.join(env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', bin));
  }
  if (env.ProgramFiles) {
    candidates.push(path.join(env.ProgramFiles, 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', bin));
  }
  for (const candidate of candidates) {
    if (exists(candidate)) return path.normalize(candidate);
  }
  return bin;
}

function normalizeProvider(raw = {}) {
  const presetName = raw.preset ?? 'custom';
  const preset = PRESETS[presetName] ?? {};
  const provider = {
    preset: presetName,
    id: raw.id || preset.id || 'relay',
    api: raw.api ?? 'auto',
    baseURL: raw.baseURL || preset.baseURL || '',
    probeBaseURL: raw.probeBaseURL || preset.probeBaseURL || raw.baseURL || preset.baseURL || '',
    probeUserAgent: raw.probeUserAgent || preset.probeUserAgent || '',
    apiKeyEnv: raw.apiKeyEnv || preset.apiKeyEnv || '',
    models: Array.isArray(raw.models) ? [...raw.models] : [],
    defaultModel: raw.defaultModel ?? '',
    reasoningEffort: raw.reasoningEffort ?? 'high',
    fence: raw.fence ?? preset.fence ?? false,
  };
  if (!provider.baseURL) throw new Error('provider.baseURL is required (or use preset: "agentrouter")');
  if (!provider.apiKeyEnv) throw new Error('provider.apiKeyEnv is required');
  if (!['auto', 'openai-completions', 'openai-responses', 'anthropic-messages'].includes(provider.api)) {
    throw new Error(`unsupported provider.api: ${provider.api}`);
  }
  return provider;
}

async function postJson(url, body, headers, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return { status: response.status, text: (await response.text()).slice(0, 300) };
  } catch (error) {
    return { status: 0, text: String(error?.message ?? error) };
  } finally {
    clearTimeout(timer);
  }
}

/** Discover the model list and, when asked, which protocol the endpoint speaks. */
export async function probeProvider(provider, { apiKey = '', timeoutMs = 20000 } = {}) {
  const headers = { accept: 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  if (provider.probeUserAgent) headers['user-agent'] = provider.probeUserAgent;

  let models = [...provider.models];
  let discovery = 'given';
  if (models.length === 0 && provider.probeBaseURL) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${provider.probeBaseURL}/models`, { headers, signal: controller.signal });
      if (response.ok) {
        const payload = await response.json();
        models = (payload?.data ?? []).map((entry) => entry?.id).filter((id) => typeof id === 'string');
        discovery = models.length ? 'discovered' : 'empty';
      } else {
        discovery = `http ${response.status}`;
      }
    } catch (error) {
      discovery = `error: ${String(error?.message ?? error)}`;
    } finally {
      clearTimeout(timer);
    }
  }

  let api = provider.api;
  if (api === 'auto') {
    const model = models[0] ?? provider.defaultModel;
    api = 'openai-completions';
    if (provider.probeBaseURL) {
      const responses = await postJson(
        `${provider.probeBaseURL}/responses`,
        { model, input: 'hi', max_output_tokens: 8 },
        headers,
        timeoutMs,
      );
      if (responses.status === 200 || responses.status === 201) {
        api = 'openai-responses';
      } else {
        const completions = await postJson(
          `${provider.probeBaseURL}/chat/completions`,
          { model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 8 },
          headers,
          timeoutMs,
        );
        if (completions.status === 200) api = 'openai-completions';
      }
    }
  }

  return { api, models, discovery };
}

function manifest(opts) {
  const bundles = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'];
  const dependencies = {};
  if (opts.provider.fence) {
    bundles.push(opts.routePackage);
    dependencies[opts.routePackage] = opts.routeRange;
  }
  if (opts.network) {
    bundles.push(opts.networkPackage);
    dependencies[opts.networkPackage] = opts.networkRange;
  }
  return `${JSON.stringify(
    {
      name: `dsh-profile-${opts.profile}`,
      private: true,
      ...(Object.keys(dependencies).length ? { dependencies } : {}),
      dsh: { profile: { bundles } },
    },
    null,
    2,
  )}\n`;
}

const PNPM_WORKSPACE = 'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n';

const CORDIS_YML = [
  '# dsh profile root — an empty entry list. The tree is composed as patches:',
  "# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml.",
  '# Edit cordis.patch.yml, not this file.',
  '[]',
  '',
].join('\n');

function normalizeModels(models) {
  return models
    .map((model) => (typeof model === 'string' ? { id: model } : model))
    .filter((model) => model && typeof model.id === 'string' && model.id.length > 0);
}

function yamlModels(models) {
  return normalizeModels(models)
    .map((model) =>
      [
        `          - id: ${model.id}`,
        `            name: ${model.name ?? model.id}`,
        `            contextWindow: ${model.contextWindow ?? 200000}`,
        `            maxTokens: ${model.maxTokens ?? 32000}`,
      ].join('\n'),
    )
    .join('\n');
}

function profilePatch(opts, probe) {
  const models = normalizeModels(
    probe.models.length ? probe.models : [opts.provider.defaultModel || 'default'],
  );
  const safeModels = models.length ? models : [{ id: 'default', name: 'default' }];
  const defaultModel = opts.provider.defaultModel || safeModels[0].id;
  const lines = [
    '# Generated by dsh-relay-isolation.',
    '# Default model for this isolated environment.',
    '- id: agent-default-model',
    '  name: "@deepseek-ai/dsh-agent-default-model"',
    '  config:',
    `    provider: ${opts.provider.id}`,
    `    model: ${defaultModel}`,
    `    reasoningEffort: ${opts.provider.reasoningEffort}`,
    '# Provider route: protocol and catalog were resolved at setup time, not assumed.',
    '- id: llm-pi-ai',
    '  name: "@deepseek-ai/dsh-llm-pi-ai"',
    '  config:',
    '    providers:',
    `      ${opts.provider.id}:`,
    `        displayName: ${opts.provider.id}`,
    `        apiKeyEnv: ${opts.provider.apiKeyEnv}`,
    `        api: ${probe.api}`,
    `        baseURL: ${opts.provider.baseURL}`,
    '        defaultInput:',
    '          - text',
    '        models:',
    yamlModels(safeModels),
  ];
  if (opts.provider.fence) {
    lines.push(
      '# Endpoint switch, client User-Agent and retry of transient upstream rejections.',
      '- id: llm-agentrouter',
      `  name: ${opts.routePackage}`,
      '  config:',
      '    endpoint: cn',
      '    silentRetry: true',
      '    silentRetryAttempts: 6',
    );
  }
  return `${lines.join('\n')}\n`;
}

function windowsLauncher(opts, paths) {
  const lines = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    `title DSH ${opts.profile} (isolated)`,
    '',
    `rem Generated by dsh-relay-isolation. Isolated home: ${paths.home}`,
    `set "DSH_HOME=${paths.home}"`,
    '',
    'rem The sandbox pins workspaceRoot to the process working directory, so the',
    'rem launcher starts inside the dedicated workspace and nothing else is writable.',
    `if not exist "${paths.workspace}" mkdir "${paths.workspace}"`,
    `cd /d "${paths.workspace}"`,
    '',
  ];
  const missing = [...(opts.provider.fence ? [opts.routePackage] : []), ...(opts.network ? [opts.networkPackage] : [])];
  for (const pkg of missing) {
    lines.push(
      `if not exist "${path.join(paths.profileDir, 'node_modules', pkg)}" (`,
      `  echo [setup] installing ${pkg} into the isolated profile...`,
      `  call "${paths.cli}" plugin --profile ${opts.profile} add ${pkg}`,
      '  if errorlevel 1 (',
      '    echo [error] install failed; install it by hand and rerun.',
      `    echo   set "DSH_HOME=${paths.home}"`,
      `    echo   "${paths.cli}" plugin --profile ${opts.profile} add ${pkg}`,
      '    pause',
      '    exit /b 1',
      '  )',
      ')',
    );
  }
  lines.push('', `call "${paths.cli}" --profile ${opts.profile} --port 0`, 'pause', '');
  return lines.join('\r\n');
}

function posixLauncher(opts, paths) {
  const lines = [
    '#!/usr/bin/env sh',
    '# Generated by dsh-relay-isolation.',
    'set -eu',
    `export DSH_HOME="${paths.home}"`,
    '# The sandbox pins workspaceRoot to the process working directory.',
    `mkdir -p "${paths.workspace}"`,
    `cd "${paths.workspace}"`,
  ];
  const missing = [...(opts.provider.fence ? [opts.routePackage] : []), ...(opts.network ? [opts.networkPackage] : [])];
  for (const pkg of missing) {
    lines.push(
      `if [ ! -d "${path.join(paths.profileDir, 'node_modules', pkg)}" ]; then`,
      `  echo "[setup] installing ${pkg} into the isolated profile..."`,
      `  "${paths.cli}" plugin --profile ${opts.profile} add ${pkg}`,
      'fi',
    );
  }
  lines.push(`exec "${paths.cli}" --profile ${opts.profile} --port 0`, '');
  return lines.join('\n');
}

function writeFile(file, content, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
  if (mode) fs.chmodSync(file, mode);
}

function context(options = {}) {
  const opts = {
    ...DEFAULTS,
    ...options,
    provider: normalizeProvider({ ...DEFAULTS.provider, ...(options.provider ?? {}) }),
  };
  const baseHome = options.baseHome || currentHome(options.env);
  const home = options.home || isolatedHome(baseHome, opts.suffix);
  if (path.resolve(home) === path.resolve(baseHome)) {
    throw new Error('the isolated home must differ from DSH_HOME');
  }
  const profileDir = path.join(home, 'profiles', opts.profile);
  const cli = options.cli || resolveCli(options);
  const launcher = path.join(home, IS_WINDOWS ? 'launch.cmd' : 'launch.sh');
  const credentials = path.join(home, '.credentials.yaml');
  const workspace = path.join(home, opts.workspace ?? 'workspace');
  return { opts, baseHome, home, profileDir, cli, launcher, credentials, workspace };
}

/** Create or refresh the isolated environment. Idempotent; probes the endpoint. */
export async function setup(options = {}) {
  const ctx = context(options);
  const { opts, home, profileDir, cli, launcher, credentials } = ctx;

  const apiKey = options.apiKey || readKey(ctx.baseHome, opts.provider.apiKeyEnv);
  const probe = await probeProvider(opts.provider, { apiKey });

  writeFile(path.join(profileDir, 'package.json'), manifest(opts));
  writeFile(path.join(profileDir, 'pnpm-workspace.yaml'), PNPM_WORKSPACE);
  writeFile(path.join(profileDir, 'cordis.yml'), CORDIS_YML);
  writeFile(path.join(profileDir, 'cordis.patch.yml'), profilePatch(opts, probe));

  let credentialsState = 'missing';
  if (apiKey) {
    writeFile(credentials, `version: 1\nrefs:\n  ${opts.provider.apiKeyEnv}: ${apiKey}\n`);
    credentialsState = 'written';
  } else if (fs.existsSync(credentials)) {
    credentialsState = 'kept';
  }

  const paths = { home, profileDir, cli, workspace: ctx.workspace };
  fs.mkdirSync(ctx.workspace, { recursive: true });
  writeFile(launcher, IS_WINDOWS ? windowsLauncher(opts, paths) : posixLauncher(opts, paths), IS_WINDOWS ? undefined : 0o755);

  let desktopLauncher = null;
  if (opts.desktopLauncher && options.desktopLauncher !== false && IS_WINDOWS) {
    const desktop = path.join(os.homedir(), 'Desktop');
    if (fs.existsSync(desktop)) {
      desktopLauncher = path.join(desktop, 'AgentRouter-DSH.cmd');
      writeFile(desktopLauncher, windowsLauncher(opts, paths));
    }
  }

  return {
    ok: true,
    action: 'setup',
    home,
    profile: opts.profile,
    profileDir,
    workspace: ctx.workspace,
    launcher,
    desktopLauncher,
    credentials: credentialsState,
    provider: opts.provider.id,
    api: probe.api,
    modelDiscovery: probe.discovery,
    models: probe.models,
    defaultModel: opts.provider.defaultModel || probe.models[0]?.id || '',
    launchCommand: IS_WINDOWS
      ? `set "DSH_HOME=${home}" && "${cli}" --profile ${opts.profile}`
      : `DSH_HOME="${home}" "${cli}" --profile ${opts.profile}`,
    next: 'Run the launcher. It installs the bundles on first start, then opens a separate Harness UI.',
  };
}

/** Inspect an existing isolated environment without changing it. */
export function status(options = {}) {
  const ctx = context(options);
  const { opts, home, profileDir, cli, launcher } = ctx;
  const key = readKey(home, opts.provider.apiKeyEnv);
  return {
    ok: true,
    action: 'status',
    home,
    exists: fs.existsSync(home),
    configured: fs.existsSync(path.join(profileDir, 'cordis.patch.yml')),
    profile: opts.profile,
    profileDir,
    workspace: ctx.workspace,
    provider: opts.provider.id,
    credentials: key ? `present (${key.length} chars)` : 'missing',
    routeInstalled: opts.provider.fence
      ? fs.existsSync(path.join(profileDir, 'node_modules', opts.routePackage))
      : null,
    launcher: fs.existsSync(launcher) ? launcher : null,
    launchCommand: IS_WINDOWS
      ? `set "DSH_HOME=${home}" && "${cli}" --profile ${opts.profile}`
      : `DSH_HOME="${home}" "${cli}" --profile ${opts.profile}`,
  };
}

/** Delete the isolated environment. Requires `force: true`. */
export function remove(options = {}) {
  const ctx = context(options);
  if (options.force !== true) {
    return { ok: false, action: 'remove', home: ctx.home, message: 'removing an environment deletes its sessions; pass force: true to confirm' };
  }
  if (!fs.existsSync(ctx.home)) {
    return { ok: true, action: 'remove', home: ctx.home, removed: false, message: 'nothing to remove' };
  }
  if (path.resolve(ctx.home) === path.resolve(ctx.baseHome)) {
    throw new Error('refusing to delete DSH_HOME');
  }
  fs.rmSync(ctx.home, { recursive: true, force: true });
  return { ok: true, action: 'remove', home: ctx.home, removed: true };
}
