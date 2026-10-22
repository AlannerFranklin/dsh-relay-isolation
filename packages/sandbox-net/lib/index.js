import { DEFAULT_ALLOWED_HOSTS, fetchText } from './net.js';

/** The whole plugin surface: one tool, no settings page, no background work. */
export const inject = ['tools'];

export function apply(ctx, config = {}) {
  const allowed = Array.isArray(config.allowedHosts) && config.allowedHosts.length
    ? config.allowedHosts
    : DEFAULT_ALLOWED_HOSTS;
  const allowAll = config.allowAll === true;

  const definition = {
    name: 'fetch_url',
    description:
      'Fetch one HTTPS URL from the host process on behalf of a sandboxed agent. The Windows sandbox gives shell commands no network capability, so use this tool instead of curl or web_fetch when the URL is on the allowlist. GET only; the response is truncated.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Absolute https URL on an allowlisted host.' },
        maxBytes: {
          type: 'integer',
          description: 'Response cap in bytes, 1000 to 400000. Defaults to 60000.',
          minimum: 1000,
          maximum: 400000,
        },
      },
      required: ['url'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          status: { type: 'integer' },
          contentType: { type: 'string' },
          truncated: { type: 'boolean' },
          text: { type: 'string' },
          error: { type: 'string' },
        },
        required: ['ok'],
        additionalProperties: false,
      },
      render(_args, value) {
        const v = value || {};
        if (v.error) return [{ type: 'text', text: `fetch failed: ${v.error}` }];
        const head = `HTTP ${v.status}${v.truncated ? ' (truncated)' : ''} ${v.contentType ?? ''}`.trim();
        return [{ type: 'text', text: `${head}\n\n${v.text ?? ''}` }];
      },
    },
    async execute(args) {
      const url = String(args?.url ?? '');
      const maxBytes = Number.isFinite(args?.maxBytes) ? Math.min(Math.max(args.maxBytes, 1000), 400000) : undefined;
      try {
        return await fetchText(url, { maxBytes, allowed: allowAll ? ['*'] : allowed });
      } catch (error) {
        return { ok: false, status: 0, contentType: '', truncated: false, text: '', error: String(error?.message ?? error) };
      }
    },
  };

  ctx.effect(() => ctx.tools.register(definition));
}
