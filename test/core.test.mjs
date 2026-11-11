// Local core tests: node --test test/core.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectIntent, explainCommand, generateNL, createPipeline } from '../src/core.js';

const mockAi = {
  calls: [],
  async query(input, intent) {
    this.calls.push({ input, intent });
    return { ok: true, source: 'ai', kind: intent === 'natural' ? 'generate' : 'explain', command: input, explanation: 'AI 解释' };
  },
};
const failAi = { async query() { return { ok: false, code: 'network', message: 'AI 网络请求失败' }; } };

test('intent detection', () => {
  assert.equal(detectIntent('ls -la'), 'command');
  assert.equal(detectIntent('pwd'), 'command');
  assert.equal(detectIntent('sudo rm -rf test'), 'command');
  assert.equal(detectIntent('查看当前目录所有文件'), 'natural');
  assert.equal(detectIntent('查看 8080 端口占用'), 'natural');
  assert.equal(detectIntent('hello'), 'auto');
  assert.equal(detectIntent(''), null);
});

test('explain common commands locally', () => {
  const ls = explainCommand('ls -la');
  assert.equal(ls.handled, true);
  assert.equal(ls.kind, 'explain');
  assert.ok(ls.explanation.length > 0 && ls.explanation.length <= 240);
  const pwd = explainCommand('pwd');
  assert.equal(pwd.handled, true);
  const rm = explainCommand('rm -rf test');
  assert.equal(rm.handled, true);
  assert.ok(rm.warning, 'rm -rf should carry a risk warning');
});

test('explain pipes, sudo and redirects', () => {
  const pipe = explainCommand("ss -lntp | grep ':8080'");
  assert.equal(pipe.handled, true);
  const sudo = explainCommand('sudo systemctl restart nginx');
  assert.equal(sudo.handled, true);
  assert.ok(sudo.explanation.includes('管理员'));
  const redir = explainCommand('echo hello > out.txt');
  assert.equal(redir.handled, true);
  assert.ok(redir.explanation.includes('out.txt'));
});

test('unknown command is not declared invalid locally', () => {
  const r = explainCommand('someunknowntool --fancy');
  assert.equal(r.handled, false);
});

test('digit-leading command names explain locally', () => {
  const r = explainCommand('7z x archive.7z');
  assert.equal(r.handled, true);
  assert.equal(r.kind, 'explain');
});

test('natural language generation', () => {
  const a = generateNL('查看当前目录所有文件');
  assert.equal(a.handled, true);
  assert.match(a.command, /^ls/);
  const b = generateNL('查看 8080 端口占用');
  assert.equal(b.handled, true);
  assert.ok(b.command.includes('8080'));
  const c = generateNL('查找所有 log 文件');
  assert.equal(c.handled, true);
  assert.ok(c.command.includes('find'));
  assert.ok(c.command.includes('.log'));
});

test('pipeline: local first, no AI call', async () => {
  mockAi.calls.length = 0;
  const run = createPipeline({ ai: mockAi });
  const r = await run('ls -la');
  assert.equal(r.ok, true);
  assert.equal(r.source, 'local');
  assert.equal(mockAi.calls.length, 0);
  const g = await run('查看磁盘空间');
  assert.equal(g.ok, true);
  assert.equal(g.source, 'local');
  assert.equal(g.kind, 'generate');
  assert.equal(mockAi.calls.length, 0);
});

test('pipeline: AI fallback for unknown input', async () => {
  mockAi.calls.length = 0;
  const run = createPipeline({ ai: mockAi });
  const r = await run('someunknowntool --fancy');
  assert.equal(r.ok, true);
  assert.equal(r.source, 'ai');
  assert.equal(mockAi.calls.length, 1);
});

test('pipeline: empty input and AI failure', async () => {
  const run = createPipeline({ ai: failAi });
  const empty = await run('   ');
  assert.equal(empty.ok, false);
  assert.equal(empty.code, 'empty');
  const unknown = await run('someunknowntool --fancy');
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, 'network');
});

test('pipeline: partial local knowledge survives AI failure', async () => {
  const run = createPipeline({ ai: failAi });
  const r = await run('ls --definitely-unknown-flag');
  assert.equal(r.ok, true);
  assert.equal(r.source, 'local');
  assert.ok(r.explanation.includes('仅供参考'));
});