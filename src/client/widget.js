// Linux 指令器 — client widget source (plain JS, inlined into client.js by
// build-client.mjs). Expects React, ctx, t in scope via createWidget args.
// Minimal floating tool: right-edge dock tab -> compact query panel.
// Never executes anything; commands are text only.

const CSS = String.raw`
.lxc-root{position:fixed;right:0;top:0;width:0;height:0;z-index:1000;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;}
.lxc-root *,.lxc-root *::before,.lxc-root *::after{box-sizing:border-box;}
.lxc-dock{position:absolute;right:0;margin-top:-28px;width:30px;height:56px;display:flex;align-items:center;justify-content:center;padding:0;border:1px solid var(--dsw-alias-border-l1);border-right:none;border-radius:10px 0 0 10px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:grab;touch-action:none;user-select:none;-webkit-user-select:none;box-shadow:-2px 2px 10px color-mix(in srgb,var(--dsw-alias-label-primary) 10%,transparent);transition:color .16s ease,background .16s ease,transform .16s ease,box-shadow .16s ease;animation:lxc-fade .18s ease;}
.lxc-dock:hover{color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2);transform:translateX(-2px);}
.lxc-dock:active{transform:translateX(-2px) scale(.96);}
.lxc-dock.lxc-dragging{cursor:grabbing;transition:none;color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2);transform:translateX(-2px) scale(1.04);box-shadow:-4px 5px 16px color-mix(in srgb,var(--dsw-alias-label-primary) 20%,transparent);}
.lxc-dock:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}
.lxc-panel{position:absolute;right:10px;width:min(340px,calc(100vw - 24px));max-height:min(460px,calc(100vh - 32px));display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);border-radius:14px;box-shadow:0 12px 32px color-mix(in srgb,var(--dsw-alias-label-primary) 16%,transparent),0 2px 8px color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent);animation:lxc-in .19s cubic-bezier(.2,.7,.3,1);}
.lxc-panel.lxc-closing{animation:lxc-out .15s ease forwards;}
.lxc-head{display:flex;align-items:center;justify-content:space-between;padding:10px 10px 8px 14px;flex:none;}
.lxc-title{font-size:12.5px;font-weight:600;letter-spacing:.02em;color:var(--dsw-alias-label-primary);user-select:none;}
.lxc-close{width:24px;height:24px;display:flex;align-items:center;justify-content:center;padding:0;border:none;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;transition:background .14s ease,color .14s ease;}
.lxc-close:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);}
.lxc-close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}
.lxc-form{padding:0 12px;flex:none;}
.lxc-input{width:100%;height:36px;padding:0 11px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;font-family:inherit;outline:none;transition:border-color .14s ease,box-shadow .14s ease;}
.lxc-input::placeholder{color:var(--dsw-alias-label-secondary);opacity:.75;}
.lxc-input:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-brand-primary) 18%,transparent);}
.lxc-input.lxc-shake{animation:lxc-shake .24s ease;}
.lxc-result{margin:10px 12px 12px;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-border-l2) transparent;}
.lxc-result::-webkit-scrollbar{width:6px;}
.lxc-result::-webkit-scrollbar-track{background:transparent;}
.lxc-result::-webkit-scrollbar-thumb{background:var(--dsw-alias-border-l2);border-radius:3px;}
.lxc-result::-webkit-scrollbar-thumb:hover{background:color-mix(in srgb,var(--dsw-alias-label-secondary) 55%,transparent);}
.lxc-cmd{position:relative;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base);}
.lxc-cmd code{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-size:12.5px;line-height:1.55;color:var(--dsw-alias-label-primary);white-space:pre-wrap;word-break:break-all;user-select:text;}
.lxc-foot{display:flex;align-items:center;justify-content:space-between;margin-top:7px;}
.lxc-copy{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:11.5px;font-family:inherit;cursor:pointer;transition:color .14s ease,border-color .14s ease,background .14s ease;}
.lxc-copy:hover{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,transparent);}
.lxc-copy:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}
.lxc-copy.lxc-ok{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary);}
.lxc-copy.lxc-fail{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary);}
.lxc-src{font-size:10px;color:var(--dsw-alias-label-secondary);opacity:.8;user-select:none;letter-spacing:.04em;}
.lxc-note{margin-top:8px;font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);}
.lxc-warn{display:flex;align-items:flex-start;gap:6px;margin-top:8px;padding:6px 8px;border-radius:7px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent);color:var(--dsw-alias-state-warn-primary);font-size:11.5px;line-height:1.5;}
.lxc-warn svg{flex:none;margin-top:1px;}
.lxc-err{display:flex;align-items:center;gap:6px;padding:6px 2px;color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:1.5;}
.lxc-loading{display:flex;align-items:center;justify-content:center;gap:5px;height:44px;}
.lxc-loading i{width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-label-secondary);opacity:.35;animation:lxc-pulse 1s ease-in-out infinite;}
.lxc-loading i:nth-child(2){animation-delay:.16s;}
.lxc-loading i:nth-child(3){animation-delay:.32s;}
@keyframes lxc-in{from{opacity:0;transform:translateX(12px);}to{opacity:1;transform:translateX(0);}}
@keyframes lxc-out{from{opacity:1;transform:translateX(0);}to{opacity:0;transform:translateX(12px);}}
@keyframes lxc-fade{from{opacity:0;}to{opacity:1;}}
@keyframes lxc-pulse{0%,100%{opacity:.25;transform:scale(.85);}50%{opacity:.9;transform:scale(1);}}
@keyframes lxc-shake{0%,100%{transform:translateX(0);}25%{transform:translateX(-3px);}75%{transform:translateX(3px);}}
@media (max-width:480px){
.lxc-panel{right:8px;width:calc(100vw - 16px);}
.lxc-dock{width:26px;height:48px;margin-top:-24px;}
}
@media (prefers-reduced-motion:reduce){
.lxc-panel,.lxc-dock,.lxc-input,.lxc-copy,.lxc-close,.lxc-loading i{animation:none !important;transition:none !important;}
.lxc-panel.lxc-closing{opacity:0;}
}
`;

const svgProps = { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true };

function DockIcon() {
  return React.createElement('svg', { ...svgProps, width: 15, height: 15 },
    React.createElement('path', { d: 'M3 4.5 L6.5 8 L3 11.5', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    React.createElement('line', { x1: 8.2, y1: 11.8, x2: 13, y2: 11.8, stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' }));
}
function CloseIcon() {
  return React.createElement('svg', { ...svgProps, width: 13, height: 13 },
    React.createElement('path', { d: 'M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }));
}
function CopyIcon() {
  return React.createElement('svg', { ...svgProps, width: 12, height: 12 },
    React.createElement('rect', { x: 5, y: 5, width: 8.5, height: 8.5, rx: 1.8, stroke: 'currentColor', strokeWidth: 1.4 }),
    React.createElement('path', { d: 'M11 3.2 V2.8 A1.8 1.8 0 0 0 9.2 1 H2.8 A1.8 1.8 0 0 0 1 2.8 V9.2 A1.8 1.8 0 0 0 2.8 11 H3.2', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }));
}
function CheckIcon() {
  return React.createElement('svg', { ...svgProps, width: 12, height: 12 },
    React.createElement('path', { d: 'M2.5 8.5 L6 12 L13.5 4', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }));
}
function WarnIcon() {
  return React.createElement('svg', { ...svgProps, width: 12, height: 12 },
    React.createElement('path', { d: 'M8 1.8 L15 13.6 H1 Z', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' }),
    React.createElement('line', { x1: 8, y1: 6.2, x2: 8, y2: 9.2, stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
    React.createElement('circle', { cx: 8, cy: 11.4, r: .9, fill: 'currentColor' }));
}

function createWidget(React, ctx, t) {
  const h = React.createElement;
  const { useState, useRef, useEffect, useLayoutEffect, useReducer } = React;

  const DOCK_MARGIN = 36; // keep the tab fully on-screen
  const STORE_KEY = 'linux-commander.dockY';
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), Math.max(lo, hi));

  function initialDockY() {
    const vh = window.innerHeight || 800;
    let frac = 0.5;
    try {
      const saved = Number(localStorage.getItem(STORE_KEY));
      if (Number.isFinite(saved) && saved > 0 && saved < 1) frac = saved;
    } catch { /* storage unavailable */ }
    return clamp(frac * vh, DOCK_MARGIN, vh - DOCK_MARGIN);
  }

  function Widget() {
    const [open, setOpen] = useState(false);
    const [closing, setClosing] = useState(false);
    const [value, setValue] = useState('');
    const [phase, setPhase] = useState('idle'); // idle | loading | done | error
    const [result, setResult] = useState(null);
    const [error, setError] = useState('');
    const [copyState, setCopyState] = useState('idle'); // idle | ok | fail
    const [shake, setShake] = useState(false);
    const [dockY, setDockYState] = useState(initialDockY);
    const [vh, setVh] = useState(() => window.innerHeight || 800);
    const [panelH, setPanelH] = useState(180);
    const [dragging, setDragging] = useState(false);
    const [, bump] = useReducer((x) => x + 1, 0);

    const inputRef = useRef(null);
    const dockRef = useRef(null);
    const panelRef = useRef(null);
    const seqRef = useRef(0);
    const abortRef = useRef(null);
    const lastQueryRef = useRef('');
    const closeTimerRef = useRef(null);
    const copyTimerRef = useRef(null);
    const shakeTimerRef = useRef(null);
    const closingRef = useRef(false);
    const dockYRef = useRef(dockY);
    const dragRef = useRef(null);
    const suppressClickRef = useRef(false);

    function setDockY(y) {
      dockYRef.current = y;
      setDockYState(y);
    }

    function persistDockY() {
      try {
        const frac = dockYRef.current / (window.innerHeight || vh || 1);
        localStorage.setItem(STORE_KEY, String(clamp(frac, 0, 1)));
      } catch { /* storage unavailable */ }
    }

    useEffect(() => ctx.locale.subscribe(bump), [ctx]);

    useEffect(() => {
      const onResize = () => {
        const hgt = window.innerHeight || 800;
        setVh(hgt);
        setDockY(clamp(dockYRef.current, DOCK_MARGIN, hgt - DOCK_MARGIN));
      };
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }, []);

    // Measure the panel so it stays fully on-screen near the dock position.
    useLayoutEffect(() => {
      if (!open || !panelRef.current) return;
      const el = panelRef.current;
      const measure = () => setPanelH(el.offsetHeight || 180);
      measure();
      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }, [open]);

    useEffect(() => () => {
      abortRef.current?.abort();
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
    }, []);

    useEffect(() => {
      if (!open) return;
      const raf = requestAnimationFrame(() => {
        const el = inputRef.current;
        if (el) { el.focus(); el.select(); }
      });
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePanel(); } };
      document.addEventListener('keydown', onKey, true);
      return () => { cancelAnimationFrame(raf); document.removeEventListener('keydown', onKey, true); };
    }, [open]);

    // --- vertical drag of the docked tab (pointer + keyboard) ---
    function onDockPointerDown(e) {
      if (e.button !== undefined && e.button !== 0) return;
      dragRef.current = { startY: e.clientY, origY: dockYRef.current, moved: false };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* older browsers */ }
    }

    function onDockPointerMove(e) {
      const d = dragRef.current;
      if (!d) return;
      const dy = e.clientY - d.startY;
      if (!d.moved && Math.abs(dy) > 4) { d.moved = true; setDragging(true); }
      if (d.moved) {
        e.preventDefault();
        setDockY(clamp(d.origY + dy, DOCK_MARGIN, (window.innerHeight || vh) - DOCK_MARGIN));
      }
    }

    function onDockPointerUp(e) {
      const d = dragRef.current;
      dragRef.current = null;
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      if (!d) return;
      if (d.moved) {
        setDragging(false);
        persistDockY();
        suppressClickRef.current = true; // the trailing click must not open the panel
      }
    }

    function onDockPointerCancel() {
      dragRef.current = null;
      setDragging(false);
    }

    function onDockClick() {
      if (suppressClickRef.current) { suppressClickRef.current = false; return; }
      openPanel();
    }

    function onDockKeyDown(e) {
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      e.preventDefault();
      const step = e.shiftKey ? 96 : 24;
      const dy = e.key === 'ArrowUp' ? -step : step;
      setDockY(clamp(dockYRef.current + dy, DOCK_MARGIN, (window.innerHeight || vh) - DOCK_MARGIN));
      persistDockY();
    }

    function openPanel() {
      if (closeTimerRef.current) { clearTimeout(closeTimerRef.current); closeTimerRef.current = null; }
      closingRef.current = false;
      setClosing(false);
      setOpen(true);
    }

    function closePanel() {
      if (closingRef.current) return;
      closingRef.current = true;
      abortRef.current?.abort();
      seqRef.current++;
      setPhase((p) => (p === 'loading' ? 'idle' : p));
      setClosing(true);
      closeTimerRef.current = setTimeout(() => {
        closeTimerRef.current = null;
        closingRef.current = false;
        setClosing(false);
        setOpen(false);
        requestAnimationFrame(() => dockRef.current?.focus());
      }, 155);
    }

    function submit(e) {
      e.preventDefault();
      if (e.nativeEvent && e.nativeEvent.repeat) return;
      const q = value.replace(/[\r\n]+/g, ' ').trim();
      if (!q) {
        setShake(true);
        if (shakeTimerRef.current) clearTimeout(shakeTimerRef.current);
        shakeTimerRef.current = setTimeout(() => setShake(false), 260);
        inputRef.current?.focus();
        return;
      }
      if (phase === 'loading' && q === lastQueryRef.current) return;
      const seq = ++seqRef.current;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      lastQueryRef.current = q;
      setPhase('loading');
      setResult(null);
      setError('');
      setCopyState('idle');
      fetch('/linux-commander/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: q }),
        signal: controller.signal,
      })
        .then(async (res) => {
          let data = null;
          try { data = await res.json(); } catch { /* non-JSON */ }
          if (seq !== seqRef.current) return;
          if (data && data.ok) { setResult(data); setPhase('done'); }
          else { setError((data && data.message) || t('errorGeneric')); setPhase('error'); }
        })
        .catch(() => {
          if (seq !== seqRef.current || controller.signal.aborted) return;
          setError(t('errorNetwork'));
          setPhase('error');
        });
    }

    async function copyCommand() {
      const text = result?.command;
      if (!text) return;
      let ok = false;
      try {
        await navigator.clipboard.writeText(text);
        ok = true;
      } catch {
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
          document.body.appendChild(ta);
          ta.select();
          ok = document.execCommand('copy');
          ta.remove();
        } catch { ok = false; }
      }
      setCopyState(ok ? 'ok' : 'fail');
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopyState('idle'), 1400);
    }

    if (!open) {
      return h('div', { className: 'lxc-root' },
        h('button', {
          ref: dockRef, type: 'button',
          className: 'lxc-dock' + (dragging ? ' lxc-dragging' : ''),
          style: { top: dockY + 'px' },
          'aria-label': t('open'),
          onClick: onDockClick,
          onPointerDown: onDockPointerDown,
          onPointerMove: onDockPointerMove,
          onPointerUp: onDockPointerUp,
          onPointerCancel: onDockPointerCancel,
          onKeyDown: onDockKeyDown,
        }, h(DockIcon)));
    }

    const panelTop = clamp(dockY - panelH / 2, 8, Math.max(8, vh - panelH - 8));

    const copyLabel = copyState === 'ok' ? t('copied') : copyState === 'fail' ? t('copyFailed') : t('copy');
    const sourceLabel = result ? (result.source === 'local' ? t('sourceLocal') : t('sourceAi')) : '';

    let body = null;
    if (phase === 'loading') {
      body = h('div', { className: 'lxc-loading', role: 'status', 'aria-label': t('loading') },
        h('i'), h('i'), h('i'));
    } else if (phase === 'error') {
      body = h('div', { className: 'lxc-err', role: 'alert' }, error);
    } else if (phase === 'done' && result) {
      body = h(React.Fragment, null,
        h('div', { className: 'lxc-cmd' }, h('code', null, result.command)),
        h('div', { className: 'lxc-foot' },
          h('button', {
            type: 'button',
            className: 'lxc-copy' + (copyState === 'ok' ? ' lxc-ok' : copyState === 'fail' ? ' lxc-fail' : ''),
            onClick: copyCommand, 'aria-live': 'polite',
          }, copyState === 'ok' ? h(CheckIcon) : h(CopyIcon), copyLabel),
          sourceLabel ? h('span', { className: 'lxc-src' }, sourceLabel) : null),
        result.explanation ? h('div', { className: 'lxc-note' }, result.explanation) : null,
        result.warning ? h('div', { className: 'lxc-warn' }, h(WarnIcon), h('span', null, result.warning)) : null);
    }

    return h('div', { className: 'lxc-root' },
      h('div', {
        ref: panelRef,
        className: 'lxc-panel' + (closing ? ' lxc-closing' : ''),
        style: { top: panelTop + 'px' },
        role: 'dialog', 'aria-label': t('title'),
      },
        h('div', { className: 'lxc-head' },
          h('span', { className: 'lxc-title' }, t('title')),
          h('button', { type: 'button', className: 'lxc-close', 'aria-label': t('close'), onClick: closePanel }, h(CloseIcon))),
        h('form', { className: 'lxc-form', onSubmit: submit },
          h('input', {
            ref: inputRef,
            className: 'lxc-input' + (shake ? ' lxc-shake' : ''),
            type: 'text', value, placeholder: t('placeholder'),
            'aria-label': t('placeholder'),
            autoComplete: 'off', autoCorrect: 'off', autoCapitalize: 'off', spellCheck: false,
            enterKeyHint: 'search',
            onChange: (e) => setValue(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter' && e.repeat) e.preventDefault(); },
          })),
        h('div', { className: 'lxc-result', 'aria-live': 'polite' }, body)));
  }

  return Widget;
}