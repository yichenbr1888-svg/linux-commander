// 译令 — Host half.
// Registers one loopback HTTP route that the browser widget calls.
// All AI traffic (and the API key) stays in this host process; the client
// bundle contains no credentials. Local library answers never touch AI.
import { createPipeline } from './src/core.js';
import { createAiAdapter } from './src/ai.js';

const ROUTE = '/linux-commander/query';
const BODY_LIMIT = 16 * 1024;

export const inject = ['webServer'];

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        reject(Object.assign(new Error('body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export function apply(ctx, config = {}) {
  const ai = createAiAdapter(config, ctx.logger);
  const run = createPipeline({ ai });

  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'exact',
      path: ROUTE,
      handler: async (req, res) => {
        try {
          if (req.method === 'GET') {
            sendJson(res, 200, { ok: true, service: 'linux-commander', aiConfigured: ai.configured });
            return;
          }
          if (req.method !== 'POST') {
            sendJson(res, 405, { ok: false, code: 'method', message: '仅支持 POST' });
            return;
          }
          const type = String(req.headers['content-type'] || '');
          if (!type.includes('application/json')) {
            sendJson(res, 415, { ok: false, code: 'content_type', message: '需要 application/json' });
            return;
          }
          let payload;
          try {
            payload = JSON.parse(await readBody(req));
          } catch (err) {
            sendJson(res, err.statusCode || 400, { ok: false, code: 'bad_request', message: '请求体无效' });
            return;
          }
          const result = await run(payload?.input);
          sendJson(res, 200, result);
        } catch (err) {
          ctx.logger?.warn?.(err instanceof Error ? err : new Error(String(err)));
          if (!res.headersSent) sendJson(res, 500, { ok: false, code: 'internal', message: '服务内部错误' });
          else res.end();
        }
      },
    });
    return dispose;
  }, 'linux-commander.route');
}