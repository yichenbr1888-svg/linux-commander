// Wiring smoke test for the generated client bundle (no DOM):
// node test/client-smoke.mjs
// Uses a tiny stateful hook stub so both the docked and the open-panel
// render paths are exercised: clear, minimize (state kept), panel drag,
// copy button inside the command row, source badge in the header.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const code = readFileSync(join(root, 'client.js'), 'utf8');

// Minimal DOM stubs (no real browser here).
globalThis.document = {
  createElement: () => ({ setAttribute() {}, remove() {}, style: {}, textContent: '' }),
  head: { appendChild() {} },
  body: { appendChild() {} },
  addEventListener() {},
  removeEventListener() {},
};
globalThis.requestAnimationFrame = () => 0;
const stored = {};
globalThis.localStorage = {
  getItem: (k) => (k in stored ? stored[k] : null),
  setItem: (k, v) => { stored[k] = v; },
};

// Stateful hook stub: hooks persist across renders, setters update them.
const hooks = [];
let hookIdx = 0;
const fakeReact = {
  createElement: (...args) => ({ type: args[0], props: args[1] || {}, children: args.slice(2) }),
  Fragment: Symbol('Fragment'),
  useState(init) {
    const i = hookIdx++;
    if (!(i in hooks)) hooks[i] = typeof init === 'function' ? init() : init;
    return [hooks[i], (v) => { hooks[i] = typeof v === 'function' ? v(hooks[i]) : v; }];
  },
  useRef(init) { const i = hookIdx++; if (!(i in hooks)) hooks[i] = { current: init }; return hooks[i]; },
  useEffect() {},
  useLayoutEffect() {},
  useReducer(_r, init) { const i = hookIdx++; if (!(i in hooks)) hooks[i] = init; return [hooks[i], () => {}]; },
};

let registration = null;
const win = {
  __ModuleLoader__: { load: (reg) => { registration = reg; } },
  innerHeight: 800,
  innerWidth: 1200,
  addEventListener() {},
  removeEventListener() {},
};
new Function('window', code)(win);
assert.ok(registration, 'factory registered');
assert.equal(registration.id, 'dsh-linux-commander');

const plugin = registration.factory((name) => {
  if (name === 'react') return fakeReact;
  throw new Error('unexpected require: ' + name);
});
assert.ok(plugin && typeof plugin.apply === 'function', 'plugin exports apply');
assert.deepEqual(plugin.inject, ['slots', 'locale']);

const seen = { locales: [], effects: [], injected: [], slot: null, component: null };
const ctx = {
  locale: {
    bind: () => (key) => key,
    register: (ns, locale) => { seen.locales.push([ns, locale]); return () => {}; },
    subscribe: () => () => {},
  },
  effect: (fn, label) => { const cleanup = fn(); seen.effects.push({ label, cleanup }); return () => {}; },
  slots: {
    inject: (key, cb) => { seen.injected.push(key); cb(); },
    register: (opts, component) => { seen.slot = opts; seen.component = component; return () => {}; },
  },
};
plugin.apply(ctx);

assert.deepEqual(seen.locales, [['linuxCommander', 'zh'], ['linuxCommander', 'en']]);
assert.equal(seen.effects.length, 2);
assert.deepEqual(seen.injected, ['shell.overlay']);
assert.equal(seen.slot.name, 'shell.overlay');
assert.equal(seen.slot.id, 'linux-commander');
assert.equal(typeof seen.component, 'function');

const render = () => { hookIdx = 0; return seen.component(); };
function find(node, pred, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (pred(node)) out.push(node);
  for (const c of node.children || []) find(c, pred, out);
  return out;
}
const byClass = (tree, cls) => find(tree, (n) => typeof n.props?.className === 'string' && n.props.className.split(' ').includes(cls));
const tick = (ms = 10) => new Promise((r) => setTimeout(r, ms));

// --- docked state ---
let tree = render();
assert.ok(tree && tree.props.className === 'lxc-root');
const dock = tree.children[0];
assert.equal(dock.props.className, 'lxc-dock');
assert.equal(typeof dock.props.onClick, 'function');
assert.match(dock.props.style.top, /^\d+(\.\d+)?px$/);
assert.equal(typeof dock.props.onPointerDown, 'function');
assert.equal(typeof dock.props.onKeyDown, 'function');

// Vertical dock drag persists and suppresses the trailing click.
const target = { setPointerCapture() {}, releasePointerCapture() {} };
dock.props.onPointerDown({ button: 0, clientY: 400, pointerId: 1, currentTarget: target });
dock.props.onPointerMove({ clientY: 460, preventDefault() {} });
dock.props.onPointerUp({ pointerId: 1, currentTarget: target });
assert.ok(stored['linux-commander.dockY'], 'drag persisted dock position');
dock.props.onClick(); // suppressed after drag
dock.props.onPointerDown({ button: 0, clientY: 460, pointerId: 2, currentTarget: target });
dock.props.onPointerUp({ pointerId: 2, currentTarget: target });
dock.props.onClick(); // plain click -> openPanel
dock.props.onKeyDown({ key: 'ArrowUp', preventDefault() {} });
dock.props.onKeyDown({ key: 'ArrowDown', shiftKey: true, preventDefault() {} });

// --- open panel ---
tree = render();
const panel = byClass(tree, 'lxc-panel')[0];
assert.ok(panel, 'panel rendered');
assert.equal(panel.props.role, 'dialog');
assert.match(panel.props.style.left, /^\d+(\.\d+)?px$/);
assert.match(panel.props.style.top, /^\d+(\.\d+)?px$/);
const head = byClass(tree, 'lxc-head')[0];
assert.equal(typeof head.props.onPointerDown, 'function');
assert.equal(typeof head.props.onPointerMove, 'function');
assert.equal(typeof head.props.onPointerUp, 'function');
assert.equal(byClass(tree, 'lxc-title')[0].children[0], 'title');
const minBtn = byClass(tree, 'lxc-min')[0];
assert.equal(minBtn.props['aria-label'], 'minimize');
const clearBtn = byClass(tree, 'lxc-clear')[0];
assert.equal(clearBtn.props.disabled, true, 'clear disabled when pristine');
assert.equal(byClass(tree, 'lxc-src').length, 0, 'no source badge before a result');

// Type a SQL statement; clear becomes enabled.
const input = byClass(tree, 'lxc-input')[0];
input.props.onChange({ target: { value: 'SELECT * FROM users' } });
tree = render();
assert.equal(byClass(tree, 'lxc-clear')[0].props.disabled, false);

// Submit -> loading -> done (stubbed fetch).
globalThis.fetch = async () => ({
  json: async () => ({ ok: true, source: 'ai', kind: 'explain', command: 'SELECT * FROM users', explanation: '查询所有用户' }),
});
byClass(tree, 'lxc-form')[0].props.onSubmit({ preventDefault() {}, nativeEvent: {} });
tree = render();
assert.ok(byClass(tree, 'lxc-loading').length, 'loading dots shown');
await tick();
tree = render();
const cmdRow = byClass(tree, 'lxc-cmd')[0];
assert.ok(cmdRow, 'command row rendered');
assert.ok(find(cmdRow, (n) => n.type === 'code').length, 'command text in row');
assert.ok(byClass(cmdRow, 'lxc-copy').length, 'copy button sits inside the command row');
assert.equal(byClass(tree, 'lxc-src')[0].children[0], 'sourceAi', 'AI badge in header');
assert.ok(byClass(tree, 'lxc-note').length, 'explanation shown');

// --- panel drag by header ---
const leftBefore = panel.props.style.left;
const headTarget = { setPointerCapture() {}, releasePointerCapture() {} };
head.props.onPointerDown({ button: 0, clientX: 900, clientY: 380, pointerId: 3, currentTarget: headTarget, target: { closest: () => null } });
head.props.onPointerMove({ clientX: 820, clientY: 300, preventDefault() {} });
head.props.onPointerUp({ pointerId: 3, currentTarget: headTarget });
assert.ok(stored['linux-commander.panelPos'], 'panel drag persisted position');
tree = render();
assert.notEqual(byClass(tree, 'lxc-panel')[0].props.style.left, leftBefore, 'panel moved');
// Buttons in the header never start a drag.
const posBefore = stored['linux-commander.panelPos'];
const head2 = byClass(tree, 'lxc-head')[0];
head2.props.onPointerDown({ button: 0, clientX: 900, clientY: 380, pointerId: 4, currentTarget: headTarget, target: { closest: (sel) => (sel === 'button' ? {} : null) } });
head2.props.onPointerMove({ clientX: 700, clientY: 200, preventDefault() {} });
head2.props.onPointerUp({ pointerId: 4, currentTarget: headTarget });
assert.equal(stored['linux-commander.panelPos'], posBefore, 'button press does not drag');

// --- minimize keeps state; reopen restores it ---
byClass(tree, 'lxc-min')[0].props.onClick();
tree = render();
assert.ok(byClass(tree, 'lxc-panel')[0].props.className.includes('lxc-closing'));
await tick(220);
tree = render();
assert.equal(byClass(tree, 'lxc-dock').length, 1, 'minimized back to dock');
byClass(tree, 'lxc-dock')[0].props.onClick();
tree = render();
assert.equal(byClass(tree, 'lxc-input')[0].props.value, 'SELECT * FROM users', 'input preserved');
assert.ok(byClass(tree, 'lxc-cmd').length, 'result preserved after minimize');

// --- clear resets to the freshly opened state ---
byClass(tree, 'lxc-clear')[0].props.onClick();
tree = render();
assert.equal(byClass(tree, 'lxc-input')[0].props.value, '');
assert.equal(byClass(tree, 'lxc-clear')[0].props.disabled, true);
assert.equal(byClass(tree, 'lxc-cmd').length, 0, 'result cleared');
assert.equal(byClass(tree, 'lxc-src').length, 0, 'badge cleared');

// Effect cleanups run without throwing.
for (const { cleanup } of seen.effects) cleanup();

console.log('client smoke OK: dock, panel render, SQL submit, copy placement, header badge, panel drag, minimize keeps state, clear resets');