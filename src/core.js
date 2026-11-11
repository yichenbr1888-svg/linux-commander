// Linux 指令器 — local recognition and query core.
// Pure logic: intent detection, command explanation, natural-language
// generation, and the local-first pipeline. No I/O here; the AI adapter
// is injected by the caller.
import { COMMANDS, DANGER_RULES } from './commands.js';
import { NL_RULES } from './nl.js';

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff]/;
const NL_HINT = /(请|帮我|帮忙|怎么|怎样|如何|查看|显示|列出|查找|寻找|搜索|我想|想要|我要|需要|创建|新建|删除|移除|修改|更改|设置|统计|比较|压缩|解压|下载|上传|安装|卸载|更新|升级|重启|关机|结束|终止|杀死|监控|跟踪|实时|占用|权限|属主|密码|用户|服务|进程|端口|磁盘|内存|文件|目录|文件夹|日志|版本|内核|主机|网络|连接|测试|生成|批量|定时|后台|前台|历史|环境|变量|命令|指令|操作|方法|步骤|吗|呢|？|\?)/;
const SHELL_META = /[|&;<>$`]/;
const MAX_EXPLAIN = 240;
const MAX_WARN = 140;

const cap = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Strip leading sudo/env-assignment/nohup/time wrappers; return notes + words. */
function unwrap(words) {
  const notes = [];
  let i = 0;
  while (i < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i])) i++;
  while (i < words.length) {
    const w = words[i];
    if (w === 'sudo') {
      notes.push('以管理员权限执行');
      i++;
      while (i < words.length && /^-[a-zA-Z]$/.test(words[i])) {
        if (words[i] === '-u' || words[i] === '-g') i++;
        i++;
      }
      continue;
    }
    if (w === 'nohup') { notes.push('忽略挂断信号'); i++; continue; }
    if (w === 'time') { notes.push('统计执行耗时'); i++; continue; }
    break;
  }
  return { notes, rest: words.slice(i) };
}

/** Split one command segment into words, honoring quotes. */
function tokenize(seg) {
  const words = [];
  let cur = '';
  let q = null;
  let esc = false;
  let has = false;
  for (const c of seg) {
    if (esc) { cur += c; esc = false; continue; }
    if (c === '\\' && q !== "'") { esc = true; has = true; continue; }
    if (q) { if (c === q) q = null; else cur += c; continue; }
    if (c === '"' || c === "'") { q = c; has = true; continue; }
    if (/\s/.test(c)) { if (has) { words.push(cur); cur = ''; has = false; } continue; }
    cur += c;
    has = true;
  }
  if (has) words.push(cur);
  return words;
}

/** Split a full input into [segment, operator, segment, ...] honoring quotes. */
function splitSegments(input) {
  const out = [];
  let cur = '';
  let q = null;
  let esc = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (esc) { cur += c; esc = false; continue; }
    if (c === '\\' && q !== "'") { cur += c; esc = true; continue; }
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '|' || c === '&' || c === ';' || c === '\n') {
      let op = c;
      if ((c === '|' || c === '&') && input[i + 1] === c) { op = c + c; i++; }
      out.push(cur, op);
      cur = '';
      continue;
    }
    cur += c;
  }
  out.push(cur);
  return out;
}

/** Describe redirections found in a raw segment. */
function redirectNotes(seg) {
  const notes = [];
  if (/2>&1|&>/.test(seg)) notes.push('合并错误输出');
  if (/>\s*\/dev\/null/.test(seg)) notes.push('丢弃输出');
  else {
    const append = /(?:^|[^>])>>\s*([^\s|&;]+)/.exec(seg);
    const write = /(?:^|[^>])>\s*([^\s|&;]+)/.exec(seg);
    if (append) notes.push(`追加输出到 ${append[1]}`);
    else if (write && write[1] !== '/dev/null') notes.push(`输出重定向到 ${write[1]}`);
  }
  const input = /(?:^|\s)<\s*([^\s|&;]+)/.exec(seg);
  if (input) notes.push(`输入来自 ${input[1]}`);
  return notes;
}

/** Explain one command segment. handled: true | 'partial' | false. */
function explainSegment(seg) {
  const words = tokenize(seg);
  if (words.length === 0) return { handled: true, text: '' };
  const { notes, rest } = unwrap(words);
  if (rest.length === 0) return { handled: true, text: notes.join('，') };
  let name = rest[0];
  if (name.includes('/')) name = name.slice(name.lastIndexOf('/') + 1);
  if (!/^[A-Za-z_][A-Za-z0-9_.+-]*$/.test(name)) return { handled: false };
  const entry = COMMANDS[name];
  if (!entry) return { handled: false };
  const flags = entry.f || {};
  const descs = [];
  let unknown = false;
  let positionalOnly = false;
  for (const w of rest.slice(1)) {
    if (positionalOnly) break;
    if (w === '--') { positionalOnly = true; continue; }
    if (/^(?:>|<|>>)/.test(w) || /^\d*>&/.test(w)) continue;
    if (w.startsWith('--')) {
      const key = w.split('=')[0];
      if (flags[key]) descs.push(flags[key]);
      else unknown = true;
      continue;
    }
    if (w.startsWith('-') && w.length > 1 && !/^-\d/.test(w)) {
      if (flags[w]) { descs.push(flags[w]); continue; }
      let allKnown = true;
      for (const ch of w.slice(1)) {
        if (flags['-' + ch]) descs.push(flags['-' + ch]);
        else allKnown = false;
      }
      if (!allKnown) unknown = true;
      continue;
    }
  }
  const parts = [];
  if (notes.length) parts.push(notes.join('，'));
  parts.push(entry.d + (descs.length ? '：' + [...new Set(descs)].join('，') : ''));
  const redir = redirectNotes(seg);
  if (redir.length) parts.push(redir.join('，'));
  return { handled: unknown ? 'partial' : true, text: parts.join('，'), danger: entry.danger };
}

const OP_TEXT = { '|': '；输出交给', '&&': '；成功后执行', '||': '；失败时执行', ';': '；接着执行', '&': '（后台运行）' };

/** Explain a full command line (pipes / lists / redirects). */
export function explainCommand(input) {
  const parts = splitSegments(input);
  const texts = [];
  const dangers = [];
  let partial = false;
  let pendingOp = null;
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 1) { pendingOp = parts[i]; continue; }
    const seg = parts[i].trim();
    if (!seg) { pendingOp = null; continue; }
    const r = explainSegment(seg);
    if (r.handled === false) return { handled: false };
    if (r.handled === 'partial') partial = true;
    if (r.danger) dangers.push(r.danger);
    let text = r.text;
    if (texts.length && pendingOp && OP_TEXT[pendingOp]) {
      text = pendingOp === '&' ? text + OP_TEXT['&'] : OP_TEXT[pendingOp] + ' ' + text;
    } else if (pendingOp === '&') {
      text += OP_TEXT['&'];
    }
    if (text) texts.push(text);
    pendingOp = null;
  }
  if (!texts.length) return { handled: false };
  for (const rule of DANGER_RULES) {
    try {
      if (new RegExp(rule.re, 'i').test(input)) dangers.push(rule.warn);
    } catch { /* skip malformed data rule */ }
  }
  const warning = [...new Set(dangers)].join('；');
  return {
    handled: partial ? 'partial' : true,
    kind: 'explain',
    command: input,
    explanation: cap(texts.join(''), MAX_EXPLAIN),
    ...(warning ? { warning: cap(warning, MAX_WARN) } : {}),
  };
}

/** First matching natural-language rule wins. */
export function generateNL(input) {
  for (const rule of NL_RULES) {
    const m = rule.re.exec(input);
    if (!m) continue;
    let cmd;
    try {
      cmd = typeof rule.cmd === 'function' ? rule.cmd(m) : rule.cmd;
    } catch { continue; }
    if (typeof cmd !== 'string' || !cmd.trim()) continue;
    return {
      handled: true,
      kind: 'generate',
      command: cmd.trim(),
      explanation: rule.note || '',
      ...(rule.warn ? { warning: rule.warn } : {}),
    };
  }
  return { handled: false };
}

/** Classify input: 'command' | 'natural' | 'auto'. */
export function detectIntent(input) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const first = trimmed.split(/\s+/)[0];
  const base = first.includes('/') ? first.slice(first.lastIndexOf('/') + 1) : first;
  if (COMMANDS[base] || base === 'sudo') return 'command';
  if (CJK.test(trimmed)) return NL_HINT.test(trimmed) ? 'natural' : 'natural';
  if (SHELL_META.test(trimmed) || /\s--?[A-Za-z]/.test(trimmed)) return 'command';
  if (/^\.{1,2}\//.test(trimmed) || /^~\//.test(trimmed)) return 'command';
  if (/^[A-Za-z_][A-Za-z0-9_.+-]*$/.test(trimmed)) return 'auto';
  return 'auto';
}

/** Local-first pipeline with injected AI fallback. */
export function createPipeline({ ai }) {
  return async function run(raw) {
    const input = String(raw ?? '').replace(/[\r\n]+/g, ' ').trim().slice(0, 500);
    if (!input) return { ok: false, code: 'empty', message: '请输入内容' };
    const intent = detectIntent(input);
    let partial = null;
    if (intent === 'command' || intent === 'auto') {
      const r = explainCommand(input);
      if (r.handled === true) return { ok: true, source: 'local', ...r };
      if (r.handled === 'partial') partial = r;
    }
    if (intent === 'natural' || intent === 'auto') {
      const r = generateNL(input);
      if (r.handled) return { ok: true, source: 'local', ...r };
    }
    const res = await ai.query(input, intent);
    if (res.ok) return res;
    if (partial) {
      return { ok: true, source: 'local', ...partial, explanation: cap(partial.explanation + '（部分参数未收录，仅供参考）', MAX_EXPLAIN) };
    }
    return res;
  };
}