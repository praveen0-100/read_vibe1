// ─── Toast Notification ───────────────────────────────────────────────────────
import React from 'react';
import { Check, X, AlertCircle, Info } from 'lucide-react';
import { useApp } from '../../context/AppContext';

export function Toast() {
  const { state, dispatch } = useApp();
  const toast = state.toast;
  if (!toast) return null;

  const icons = { success: Check, error: X, warning: AlertCircle, info: Info };
  const Icon = icons[toast.type] || Check;

  return (
    <div
      className={`toast toast-${toast.type || 'success'}`}
      role="status"
      aria-live="polite"
    >
      <Icon size={15} />
      <span>{toast.msg}</span>
      <button
        onClick={() => dispatch({ type: 'CLEAR_TOAST' })}
        aria-label="Dismiss notification"
        className="toast-close"
      >
        <X size={13} />
      </button>
    </div>
  );
}

// ─── Upload FAB ───────────────────────────────────────────────────────────────
import { Plus } from 'lucide-react';

export function UploadFAB() {
  const { state, dispatch, notify } = useApp();
  if (state.page === 'reader') return null;

  return (
    <button
      className="quick-fab"
      onClick={() => dispatch({ type: 'SET_UPLOAD_OPEN', payload: true })}
      aria-label="Upload document"
      title="Upload document"
    >
      <Plus size={22} />
    </button>
  );
}

// ─── Page Shell (container) ───────────────────────────────────────────────────
export function PageShell({ children, className = '' }) {
  return (
    <div className={`page-shell ${className}`}>
      {children}
    </div>
  );
}

// ─── Section Heading ──────────────────────────────────────────────────────────
import { ArrowRight } from 'lucide-react';

export function SectionHead({ eyebrow, title, action, onAction, actionLabel }) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h2>{title}</h2>
      </div>
      {(action || onAction) && (
        <button className="text-button" onClick={onAction}>
          {actionLabel || action} <ArrowRight size={14} />
        </button>
      )}
    </div>
  );
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────
export function ProgressBar({ value, className = '', thin = false }) {
  return (
    <div className={`progress-track ${thin ? 'thin' : ''} ${className}`} role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-fill" style={{ width: `${value}%` }} />
    </div>
  );
}

// ─── Loading Spinner ──────────────────────────────────────────────────────────
export function Spinner({ size = 20, label = 'Loading...' }) {
  return (
    <div className="spinner-wrap" role="status" aria-label={label}>
      <div className="spinner" style={{ width: size, height: size }} />
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────
export function EmptyState({ emoji, title, description, action, onAction }) {
  return (
    <div className="empty-state">
      <div className="empty-emoji">{emoji}</div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {action && <button className="primary-button" onClick={onAction}>{action}</button>}
    </div>
  );
}

// ─── Tag Badge ────────────────────────────────────────────────────────────────
export function Tag({ children, color }) {
  return <span className={`tag tag-${color || 'default'}`}>{children}</span>;
}

// ─── Icon Button ─────────────────────────────────────────────────────────────
export function IconBtn({ icon: Icon, label, onClick, active, size = 18 }) {
  return (
    <button
      className={`icon-button ${active ? 'active' : ''}`}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <Icon size={size} />
    </button>
  );
}
