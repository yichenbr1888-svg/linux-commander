// AI adapter tests with stubbed fetch: node --test test/ai.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAiAdapter } from '../src/ai.js';

const CFG = { apiKey: 'test-key', endpoint: 'https://example.test/v2/chat/completions', model: 'm', timeoutMs: 3000 };
const jsonRes = (status, data) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const openai = (content, extra = {}) => jsonRes(200, { choices: [{ message: { content }, finish_reason: 'stop', ...extra }] });

function withFetch(stub, fn) {
  const prev = globalThis.fetch;
  globalThis.fetch = stub;
  return Promise.resolve(fn()).finally(() => { globalThis.fetch = prev; });
}

test('OpenAI response shape', () => withFetch(async () => openai('{"kind":"explain","command":"ls -la","explanation":"列出文件","warning":""}'), async () => {
  const ai = createAiAdapter(CFG);
  const r = await ai.query('ls -la', 'command');
  assert.equal(r.ok, true);
  assert.equal(r.source, 'ai');
  assert.equal(r.kind, 'explain');
  assert.equal(r.explanation, '列出文件');
}));

test('xf-yun payload shape and fenced JSON', () => withFetch(async () => jsonRes(200, { payload: { choices: { text: [{ content: '```json\n{"kind":"generate","command":"df -h","explanation":"查看磁盘"}\n```' }] } } }), async () => {
  const ai = createAiAdapter(CFG);
  const r = await ai.query('查看磁盘空间', 'natural');
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'generate');
  assert.equal(r.command, 'df -h');
}));

test('service header error', () => withFetch(async () => jsonRes(200, { header: { code: 10013, message: '授权不足' } }), async () => {
  const ai = createAiAdapter(CFG);
  const r = await ai.query('x', 'auto');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ai_service');
}));

test('HTTP errors map to short codes', () => withFetch(async (url, opts) => {
  return jsonRes(opts.headers.Authorization.includes('odd') ? 401 : 429, { error: { message: 'no' } });
}, async () => {
  const a = createAiAdapter({ ...CFG, apiKey: 'odd' });
  assert.equal((await a.query('x', 'auto')).code, 'auth');
  const b = createAiAdapter({ ...CFG, apiKey: 'even' });
  assert.equal((await b.query('x', 'auto')).code, 'rate');
}));

test('truncated reasoning response', () => withFetch(async () => jsonRes(200, { choices: [{ message: { content: '', reasoning_content: 'thinking…' }, finish_reason: 'length' }] }), async () => {
  const ai = createAiAdapter(CFG);
  const r = await ai.query('x', 'command');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'truncated');
}));

test('plain-text fallbacks', () => withFetch(async () => openai('df -h'), async () => {
  const ai = createAiAdapter(CFG);
  const r = await ai.query('查看磁盘', 'natural');
  assert.equal(r.ok, true);
  assert.equal(r.kind, 'generate');
  assert.equal(r.command, 'df -h');
}));

test('garbage response', () => withFetch(async () => openai('!!! ???'), async () => {
  const ai = createAiAdapter(CFG);
  const r = await ai.query('x', 'natural');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'bad_response');
}));

test('cache hit avoids second request', () => {
  let calls = 0;
  return withFetch(async () => { calls++; return openai('{"kind":"explain","command":"pwd","explanation":"显示路径"}'); }, async () => {
    const ai = createAiAdapter(CFG);
    const a = await ai.query('pwd', 'command');
    const b = await ai.query('pwd', 'command');
    assert.equal(a.source, 'ai');
    assert.equal(b.source, 'cache');
    assert.equal(calls, 1);
  });
});

test('in-flight dedupe', () => {
  let calls = 0;
  return withFetch(async () => { calls++; await new Promise((r) => setTimeout(r, 30)); return openai('{"kind":"explain","command":"w","explanation":"登录用户"}'); }, async () => {
    const ai = createAiAdapter(CFG);
    const [a, b] = await Promise.all([ai.query('w', 'command'), ai.query('w', 'command')]);
    assert.equal(calls, 1);
    assert.equal(a.ok, true);
    assert.equal(b.ok, true);
  });
});

test('not configured and timeout', async () => {
  const prev = process.env.DSH_LINUX_COMMANDER_API_KEY;
  delete process.env.DSH_LINUX_COMMANDER_API_KEY;
  try {
    const ai = createAiAdapter({ endpoint: CFG.endpoint });
    assert.equal(ai.configured, false);
    assert.equal((await ai.query('x', 'auto')).code, 'not_configured');
  } finally {
    if (prev !== undefined) process.env.DSH_LINUX_COMMANDER_API_KEY = prev;
  }
  await withFetch(async () => { throw Object.assign(new Error('t'), { name: 'TimeoutError' }); }, async () => {
    const ai = createAiAdapter(CFG);
    const r = await ai.query('timeout-test', 'auto');
    assert.equal(r.ok, false);
    assert.equal(r.code, 'timeout');
  });
});

test('request carries key, model and single-line JSON instruction', () => {
  let seen = null;
  return withFetch(async (url, opts) => { seen = { url, opts }; return openai('{"kind":"explain","command":"id","explanation":"用户身份"}'); }, async () => {
    const ai = createAiAdapter(CFG);
    await ai.query('id', 'command');
    assert.equal(seen.url, CFG.endpoint);
    assert.equal(seen.opts.headers.Authorization, 'Bearer test-key');
    const body = JSON.parse(seen.opts.body);
    assert.equal(body.model, 'm');
    assert.equal(body.stream, false);
    assert.ok(body.max_tokens >= 1000);
    assert.equal(body.messages[0].role, 'system');
    assert.ok(body.messages[1].content.includes('id'));
  });
});