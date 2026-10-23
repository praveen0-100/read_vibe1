// ─── Shared UI kit ────────────────────────────────────────────────────────────
import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, AlertTriangle, ArrowRight, Check, Info, RotateCcw, X } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { useClickOutside } from '../../hooks/useAsync';
import { coverSymbol } from '../../lib/format';

// ─── Toasts ───────────────────────────────────────────────────────────────────
export function Toasts() {
  const { toasts, dismissToast } = useApp();
  const icons = { success: Check, error: AlertCircle, warning: AlertTriangle, info: Info };
  return (
    <div className="toast-stack" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((t) => {
        const Icon = icons[t.type] || Check;
        return (
          <div key={t.id} className={`toast toast-${t.type}`} role={t.type === 'error' ? 'alert' : 'status'}>
            <Icon size={15} />
            <span>{t.msg}</span>
            {t.action && (
              <button className="toast-action" onClick={() => { t.action.onClick(); dismissToast(t.id); }}>
                {t.action.label}
              </button>
            )}
            <button className="toast-close" onClick={() => dismissToast(t.id)} aria-label="Dismiss notification"><X size={13} /></button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Modal ────────────────────────────────────────────────────────────────────
export function Modal({ open, onClose, title, eyebrow, icon: Icon, children, footer, size = 'md', className = '' }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.activeElement;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose?.(); }
      if (e.key === 'Tab' && ref.current) {
        const f = ref.current.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])');
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    setTimeout(() => ref.current?.querySelector('[autofocus], input, textarea, button.primary-button')?.focus(), 30);
    return () => { document.removeEventListener('keydown', onKey, true); prev?.focus?.(); };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div ref={ref} className={`modal modal-${size} ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        {(title || eyebrow) && (
          <header className="modal-head">
            <div>
              {eyebrow && <div className="eyebrow">{eyebrow}</div>}
              <h2 id={titleId}>{Icon && <Icon size={18} />} {title}</h2>
            </div>
            <button className="icon-ghost" onClick={onClose} aria-label="Close"><X size={18} /></button>
          </header>
        )}
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog() {
  const { confirmState, closeConfirm } = useApp();
  if (!confirmState) return null;
  const { title = 'Are you sure?', message, confirmLabel = 'Confirm', danger } = confirmState;
  return (
    <Modal open onClose={() => closeConfirm(false)} title={title} size="sm"
      footer={<>
        <button className="secondary-button" onClick={() => closeConfirm(false)}>Cancel</button>
        <button className={`primary-button ${danger ? 'danger' : ''}`} onClick={() => closeConfirm(true)} autoFocus>{confirmLabel}</button>
      </>}>
      {message && <p className="confirm-message">{message}</p>}
    </Modal>
  );
}

// ─── Menu (dropdown) ──────────────────────────────────────────────────────────
export function Menu({ trigger, items, align = 'right', label = 'More options' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close, open);
  // keep the dropdown inside the screen: slide it sideways, flip it above/below, and scroll it when there isn't room
  const menuRef = useRef(null);
  const [fit, setFit] = useState(null);
  useLayoutEffect(() => {
    if (!open) { setFit(null); return; }
    const m = menuRef.current;
    if (!m) return;
    const pad = 8;
    const t = m.parentElement.getBoundingClientRect();
    const k = m.getBoundingClientRect().width / (m.offsetWidth || 1) || 1; // the app may be scaled on very large screens
    const w = m.offsetWidth * k;
    const h = m.scrollHeight * k + 2;
    const room = { up: t.top - pad - 6, down: window.innerHeight - t.bottom - pad - 6 };
    const want = align === 'up' ? 'up' : 'down';
    const place = h > room[want] && room[want === 'up' ? 'down' : 'up'] > room[want] ? (want === 'up' ? 'down' : 'up') : want;
    // horizontal position the menu would have before any shift
    const natural = align === 'up' || align === 'right' ? t.right - w : t.left;
    let dx = 0;
    if (natural < pad) dx = pad - natural;
    else if (natural + w > window.innerWidth - pad) dx = window.innerWidth - pad - (natural + w);
    setFit({ place, dx: dx / k, maxH: Math.max(120, Math.floor(room[place] / k)) });
  }, [open, align]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button className="menu-trigger" aria-haspopup="menu" aria-expanded={open} aria-label={label} onClick={() => setOpen((o) => !o)}>
        {trigger}
      </button>
      {open && (
        <div ref={menuRef} className={`menu menu-${align}`} role="menu"
          style={fit ? { maxHeight: fit.maxH, overflowY: 'auto', translate: fit.dx ? `${fit.dx}px 0` : undefined, ...(fit.place === 'up' ? { bottom: 'calc(100% + 6px)', top: 'auto' } : { top: 'calc(100% + 6px)', bottom: 'auto' }) } : { visibility: 'hidden' }}>
          {items.filter(Boolean).map((item, i) => item === '-' ? <div key={i} className="menu-sep" /> : (
            <button key={item.label} role="menuitem" className={item.danger ? 'danger' : ''} disabled={item.disabled}
              onClick={() => { setOpen(false); item.onClick?.(); }}>
              {item.icon && <item.icon size={14} />} {item.label}
              {item.checked && <Check size={13} className="menu-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Primitives ───────────────────────────────────────────────────────────────
export function ProgressBar({ value = 0, className = '', thin = false, label }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={`progress-track ${thin ? 'thin' : ''} ${className}`} role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="progress-fill" style={{ width: `${v}%` }} />
    </div>
  );
}

export function Spinner({ size = 18, label = 'Loading' }) {
  return <span className="spinner" style={{ width: size, height: size }} role="status" aria-label={label} />;
}

export function PageLoader({ label = 'Loading…' }) {
  return <div className="page-loader"><Spinner size={26} /><span>{label}</span></div>;
}

export function EmptyState({ icon: Icon, emoji, title, description, action, onAction, secondary }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{Icon ? <Icon size={26} /> : emoji}</div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      <div className="empty-actions">
        {action && <button className="primary-button" onClick={onAction}>{action} <ArrowRight size={14} /></button>}
        {secondary}
      </div>
    </div>
  );
}

export function ErrorState({ error, onRetry, compact }) {
  return (
    <div className={`error-state ${compact ? 'compact' : ''}`} role="alert">
      <AlertTriangle size={compact ? 16 : 24} />
      <div>
        <strong>{error?.isNetwork ? 'You’re offline or the server is unreachable' : 'Couldn’t load this'}</strong>
        <p>{error?.message}</p>
      </div>
      {onRetry && <button className="secondary-button small" onClick={onRetry}><RotateCcw size={13} /> Retry</button>}
    </div>
  );
}

export function Skeleton({ h = 16, w = '100%', r = 8, className = '' }) {
  return <span className={`skeleton ${className}`} style={{ height: h, width: w, borderRadius: r }} aria-hidden="true" />;
}

export function Switch({ checked, onChange, label, description, disabled }) {
  const id = useId();
  return (
    <label className={`switch-row ${disabled ? 'disabled' : ''}`} htmlFor={id}>
      <span className="switch-text">
        <span>{label}</span>
        {description && <small>{description}</small>}
      </span>
      <button id={id} type="button" role="switch" aria-checked={!!checked} disabled={disabled}
        className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
        <i />
      </button>
    </label>
  );
}

export function Segmented({ value, onChange, options, size = 'md', label }) {
  return (
    <div className={`segmented segmented-${size}`} role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const opt = typeof o === 'string' ? { value: o, label: o } : o;
        return (
          <button key={opt.value} role="radio" aria-checked={value === opt.value} className={value === opt.value ? 'active' : ''}
            onClick={() => onChange(opt.value)} title={opt.title}>
            {opt.icon && <opt.icon size={14} />} {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function Slider({ label, value, min = 0, max = 100, step = 1, onChange, format = (v) => v, icon: Icon }) {
  const id = useId();
  return (
    <div className="slider-row">
      <label htmlFor={id}>{Icon && <Icon size={13} />} {label}</label>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)}
        style={{ '--fill': `${((value - min) / (max - min)) * 100}%` }} />
      <output htmlFor={id}>{format(value)}</output>
    </div>
  );
}

export function Tabs({ tabs, value, onChange, className = '' }) {
  return (
    <div className={`tabs ${className}`} role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={value === t.id ? 'selected' : ''} onClick={() => onChange(t.id)}>
          {t.icon && <t.icon size={14} />} {t.label}
          {t.count != null && <span className="tab-count">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function SectionHead({ eyebrow, title, actionLabel, onAction, children }) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h2>{title}</h2>
      </div>
      {children}
      {onAction && <button className="text-button" onClick={onAction}>{actionLabel} <ArrowRight size={14} /></button>}
    </div>
  );
}

export function Cover({ doc, size = 'md' }) {
  const lastName = (doc?.author || '').split(' ').slice(-1)[0];
  if (size === 'lg') {
    return (
      <div className={`book-cover cover-${doc?.color || 'coral'}`} aria-hidden="true">
        <div className="cover-symbol">{coverSymbol(doc)}</div>
        <small>{(doc?.title || '').toUpperCase().slice(0, 40)}</small>
        <b>{lastName.toUpperCase()}</b>
      </div>
    );
  }
  return (
    <div className={`mini-cover mini-cover-${size} cover-${doc?.color || 'coral'}`} aria-hidden="true">
      <span>{coverSymbol(doc)}</span>
    </div>
  );
}

export function Field({ label, hint, error, children }) {
  return (
    <label className={`field ${error ? 'has-error' : ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {(error || hint) && <small className={error ? 'field-error' : 'field-hint'}>{error || hint}</small>}
    </label>
  );
}

/** Tiny safe markdown: **bold**, *italic*, bullet lines, paragraphs. */
export function RichText({ text, className = '' }) {
  if (!text) return null;
  const inline = (s, key) => {
    const parts = s.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
    return parts.map((p, i) => {
      if (p.startsWith('**') && p.endsWith('**')) return <strong key={`${key}-${i}`}>{p.slice(2, -2)}</strong>;
      if (p.startsWith('*') && p.endsWith('*') && p.length > 2) return <em key={`${key}-${i}`}>{p.slice(1, -1)}</em>;
      return <React.Fragment key={`${key}-${i}`}>{p}</React.Fragment>;
    });
  };
  const blocks = text.split(/\n{2,}/);
  return (
    <div className={`rich-text ${className}`}>
      {blocks.map((block, bi) => {
        const lines = block.split('\n');
        if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l))) {
          return <ul key={bi}>{lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ''), `${bi}-${li}`)}</li>)}</ul>;
        }
        return (
          <p key={bi}>
            {lines.map((l, li) => {
              if (/^\s*[-*•]\s+/.test(l)) return <span key={li} className="rt-bullet">• {inline(l.replace(/^\s*[-*•]\s+/, ''), `${bi}-${li}`)}<br /></span>;
              return <React.Fragment key={li}>{inline(l.replace(/^#+\s*/, ''), `${bi}-${li}`)}{li < lines.length - 1 && <br />}</React.Fragment>;
            })}
          </p>
        );
      })}
    </div>
  );
}
