// Wiring smoke test for the generated client bundle (no DOM):
// node test/client-smoke.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const code = readFileSync(join(root, 'client.js'), 'utf8');

// Minimal DOM stubs for the style-insertion effect (no real browser here).
globalThis.document = {
  createElement: () => ({ setAttribute() {}, remove() {}, style: {}, textContent: '' }),
  head: { appendChild() {} },
  body: { appendChild() {} },
  addEventListener() {},
  removeEventListener() {},
};
globalThis.requestAnimationFrame = () => 0;

const fakeReact = {
  createElement: (...args) => ({ type: args[0], props: args[1], children: args.slice(2) }),
  Fragment: Symbol('Fragment'),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useRef: (init) => ({ current: init }),
  useEffect: () => {},
  useReducer: (_r, init) => [init, () => {}],
};

let registration = null;
const win = { __ModuleLoader__: { load: (reg) => { registration = reg; } } };
new Function('window', code)(win);
assert.ok(registration, 'factory registered');
assert.equal(registration.id, '@local/linux-commander');

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

// Render the docked state once to catch render-path errors.
const tree = seen.component();
assert.ok(tree && tree.props.className === 'lxc-root');
const dock = tree.children[0];
assert.equal(dock.props.className, 'lxc-dock');
assert.equal(typeof dock.props.onClick, 'function');

// Effect cleanups run without throwing.
for (const { cleanup } of seen.effects) cleanup();

console.log('client smoke OK: locales, effects, shell.overlay registration, dock render');