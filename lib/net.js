/**
 * Controlled egress for a sandboxed agent.
 *
 * The Windows sandbox hands the shell a token without network capability, so a
 * command inside it cannot reach the internet. Host plugins, however, run in the
 * host process. This module performs the request there, on the agent's behalf,
 * against an explicit host allowlist — the sandbox keeps its write boundary and
 * the agent still gets the data it needs.
 */
export const DEFAULT_ALLOWED_HOSTS = Object.freeze([
  'registry.npmjs.org',
  'api.github.com',
  'github.com',
  'raw.githubusercontent.com',
  'codeload.github.com',
  'objects.githubusercontent.com',
  'awesome-dsh-plugin.com',
  'cdn.jsdelivr.net',
  'dshmarket.com',
]);

export function hostAllowed(url, allowed = DEFAULT_ALLOWED_HOSTS) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  return allowed.includes(parsed.hostname);
}

async function readCapped(response, maxBytes) {
  if (!response.body?.getReader) {
    const text = await response.text();
    return { text: text.slice(0, maxBytes), truncated: text.length > maxBytes };
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      const remaining = maxBytes - total;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      chunks.push(value.byteLength > remaining ? value.slice(0, remaining) : value);
      total += Math.min(value.byteLength, remaining);
      if (value.byteLength > remaining) {
        truncated = true;
        break;
      }
    }
  }
  try {
    await reader.cancel();
  } catch {
    /* already closed */
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(merged), truncated };
}

/** Fetch one allowlisted URL from the host process and return its text. */
export async function fetchText(url, options = {}) {
  const allowed = options.allowed ?? DEFAULT_ALLOWED_HOSTS;
  const maxBytes = options.maxBytes ?? 60000;
  const timeoutMs = options.timeoutMs ?? 20000;
  const impl = options.fetchImpl ?? fetch;

  if (!hostAllowed(url, allowed)) {
    const error = new Error(`host not allowed: ${url}`);
    error.code = 'HOST_NOT_ALLOWED';
    throw error;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await impl(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'dsh-relay-isolation', accept: '*/*' },
    });
    const { text, truncated } = await readCapped(response, maxBytes);
    return {
      ok: response.ok,
      status: response.status,
      contentType: response.headers?.get?.('content-type') ?? '',
      truncated,
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}
