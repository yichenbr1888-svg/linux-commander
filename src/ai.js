// Linux 指令器 — AI fallback adapter (host-side only).
// Talks to an OpenAI-compatible chat endpoint (xf-yun MaaS by default).
// The API key never leaves the host process. Includes timeout control,
// tolerant response parsing, an LRU result cache, and in-flight dedupe.

// The MaaS gateway answers chat on /v2/chat/completions; bare /v2 is 404.
const DEFAULT_ENDPOINT = 'https://maas-api.cn-huabei-1.xf-yun.com/v2/chat/completions';
const DEFAULT_MODEL = 'spark-x2.6';
const CACHE_TTL_MS = 30 * 60 * 1000;
const CACHE_MAX = 200;

const SYSTEM_PROMPT = [
  '你是一个 Linux 指令助手，只输出一行 JSON，不要输出任何其他文字、解释或 Markdown 代码块。',
  'JSON 格式：{"kind":"explain"或"generate","command":"...","explanation":"...","warning":"..."}',
  '规则：',
  '1. kind=explain 时，command 原样返回用户输入的指令，explanation 用通俗简体中文解释这条指令的作用（含参数与管道），不超过 60 字。',
  '2. kind=generate 时，把用户的操作需求转成一条最常用、兼容性好的 Linux 指令放入 command（单行，可直接复制）；explanation 是一句不超过 30 字的简短说明，可为空字符串。',
  '3. 缺少路径、用户名、端口等参数时，使用 <路径> <文件> <用户名> <端口> 这类清晰占位符。',
  '4. 指令有实际风险（删除、覆盖、强制、关机等）时，warning 给出不超过 30 字的简短中文提醒，否则 warning 为空字符串。',
  '5. 考虑发行版差异，优先 GNU/Linux 通用命令；不确定时如实说明，绝不编造指令或参数。',
  '6. 绝不执行任何命令，只输出文本。',
].join('\n');

function userPrompt(input, intent) {
  const task = intent === 'command'
    ? '请解释这条 Linux 指令（kind=explain）。'
    : intent === 'natural'
      ? '请把这句操作需求转成一条 Linux 指令（kind=generate）。'
      : '请先判断输入是 Linux 指令还是操作需求：指令则解释（kind=explain），需求则生成指令（kind=generate）。';
  return `${task}\n输入：${input}`;
}

/** Pull assistant text out of OpenAI / xf-yun response shapes. */
function extractContent(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.header && typeof data.header.code === 'number' && data.header.code !== 0) {
    const err = new Error(data.header.message || `AI 服务错误 ${data.header.code}`);
    err.aiCode = 'ai_service';
    throw err;
  }
  const candidates = [
    data.choices?.[0]?.message?.content,
    data.choices?.[0]?.text,
    data.payload?.choices?.text?.[0]?.content,
    data.output_text,
    data.response,
    data.result,
    data.answer,
    data.content,
    data.message?.content,
  ];
  for (const c of candidates) if (typeof c === 'string' && c.trim()) return c;
  return null;
}

/** Parse the model's JSON answer; fall back to tolerant plain-text reads. */
function parseAnswer(content, input, intent) {
  let text = content.trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const obj = JSON.parse(text.slice(start, end + 1));
      const kind = obj.kind === 'generate' ? 'generate' : obj.kind === 'explain' ? 'explain' : null;
      if (kind) {
        let command = typeof obj.command === 'string' ? obj.command.replace(/[\r\n]+/g, ' ').trim() : '';
        let explanation = typeof obj.explanation === 'string' ? obj.explanation.replace(/\s+/g, ' ').trim() : '';
        let warning = typeof obj.warning === 'string' ? obj.warning.replace(/\s+/g, ' ').trim() : '';
        if (kind === 'explain' && !command) command = input;
        if (kind === 'generate' && !command) return null;
        if (command.length > 400) return null;
        return {
          kind,
          command,
          explanation: explanation.slice(0, 160),
          ...(warning ? { warning: warning.slice(0, 120) } : {}),
        };
      }
    } catch { /* fall through to plain-text fallback */ }
  }
  // Plain-text fallback: a bare command line, or a short Chinese explanation.
  const oneLine = text.replace(/[\r\n]+/g, ' ').trim();
  const looksCommand = /^[A-Za-z_./~][A-Za-z0-9_./~+-]*(\s|$)/.test(oneLine) && !/[\u4e00-\u9fff]/.test(oneLine);
  if ((intent === 'natural' || intent === 'auto') && looksCommand && oneLine.length <= 400) {
    return { kind: 'generate', command: oneLine, explanation: '' };
  }
  if ((intent === 'command' || intent === 'auto') && /[\u4e00-\u9fff]/.test(oneLine) && oneLine.length <= 200) {
    return { kind: 'explain', command: input, explanation: oneLine };
  }
  return null;
}

export function createAiAdapter(config = {}, logger) {
  const endpoint = typeof config.endpoint === 'string' && config.endpoint.trim() ? config.endpoint.trim() : DEFAULT_ENDPOINT;
  const model = typeof config.model === 'string' && config.model.trim() ? config.model.trim() : DEFAULT_MODEL;
  const apiKey = process.env.DSH_LINUX_COMMANDER_API_KEY || (typeof config.apiKey === 'string' ? config.apiKey.trim() : '');
  // spark-x2.6 reasons before answering (~20s observed); allow a generous budget.
  const timeoutMs = Math.min(120000, Math.max(3000, Number(config.timeoutMs) || 45000));
  const cache = new Map();
  const inflight = new Map();

  const cacheGet = (key) => {
    const hit = cache.get(key);
    if (!hit) return undefined;
    if (Date.now() - hit.t > CACHE_TTL_MS) { cache.delete(key); return undefined; }
    return hit.value;
  };
  const cacheSet = (key, value) => {
    cache.set(key, { t: Date.now(), value });
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  };

  async function request(input, intent) {
    let res;
    try {
      res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: userPrompt(input, intent) },
          ],
          stream: false,
          temperature: 0.2,
          max_tokens: 3000,
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
        return { ok: false, code: 'timeout', message: 'AI 响应超时，请稍后重试' };
      }
      return { ok: false, code: 'network', message: 'AI 网络请求失败' };
    }
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON body */ }
    if (!res.ok) {
      const detail = data?.error?.message || data?.message || data?.header?.message || '';
      if (res.status === 401 || res.status === 403) return { ok: false, code: 'auth', message: 'AI 接口鉴权失败，请检查 API Key' };
      if (res.status === 429) return { ok: false, code: 'rate', message: 'AI 请求过于频繁，请稍后重试' };
      return { ok: false, code: 'ai_http', message: `AI 接口错误（${res.status}）${detail ? '：' + String(detail).slice(0, 60) : ''}` };
    }
    let content;
    try { content = extractContent(data); } catch (err) {
      return { ok: false, code: err.aiCode || 'ai_error', message: String(err.message || 'AI 服务错误').slice(0, 80) };
    }
    if (!content) {
      if (data?.choices?.[0]?.finish_reason === 'length') {
        return { ok: false, code: 'truncated', message: 'AI 响应被截断，请重试' };
      }
      return { ok: false, code: 'bad_response', message: 'AI 返回格式无法解析' };
    }
    const parsed = parseAnswer(content, input, intent);
    if (!parsed) return { ok: false, code: 'bad_response', message: 'AI 返回内容无法解析' };
    return { ok: true, source: 'ai', ...parsed };
  }

  return {
    configured: Boolean(apiKey),
    async query(input, intent) {
      if (!apiKey) return { ok: false, code: 'not_configured', message: 'AI 接口未配置，仅支持本地查询' };
      const key = `${intent}\u0000${input}`;
      const cached = cacheGet(key);
      if (cached) return { ...cached, source: 'cache' };
      if (inflight.has(key)) return inflight.get(key);
      const task = request(input, intent)
        .then((result) => {
          if (result.ok) cacheSet(key, result);
          return result;
        })
        .catch((err) => {
          logger?.warn?.(err instanceof Error ? err : new Error(String(err)));
          return { ok: false, code: 'ai_error', message: 'AI 服务异常' };
        })
        .finally(() => inflight.delete(key));
      inflight.set(key, task);
      return task;
    },
  };
}