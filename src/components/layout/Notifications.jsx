// ─── Notification centre: background jobs (uploads, audiobooks) ──────────────
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Bell, BookOpen, Check, Headphones, Loader2, Trash2, XCircle } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { timeAgo } from '../../lib/format';
import { ProgressBar } from '../ui';

export default function Notifications() {
  const { jobs, loadJobs } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const panelRef = useRef(null);
  const [pos, setPos] = useState(null);

  // The panel lives on <body>, so no sidebar or page layer can stack above it; it is placed beside the bell.
  const place = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const up = r.top > window.innerHeight / 2;
    const left = Math.min(Math.max(8, r.left - 120), window.innerWidth - 328);
    setPos(up ? { left, bottom: window.innerHeight - r.top + 8 } : { left, top: r.bottom + 8 });
  };

  useEffect(() => {
    if (!open) return undefined;
    place();
    const out = (e) => { if (!ref.current?.contains(e.target) && !panelRef.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', out);
    document.addEventListener('keydown', esc);
    window.addEventListener('resize', place);
    return () => { document.removeEventListener('pointerdown', out); document.removeEventListener('keydown', esc); window.removeEventListener('resize', place); };
  }, [open]);

  const unseen = jobs.filter((j) => !j.seen && (j.status === 'completed' || j.status === 'failed')).length;
  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'processing').length;

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next) {
      await loadJobs();
      if (unseen) api.activity.markSeen().then(loadJobs).catch(() => {});
    }
  };

  const openJob = (job) => {
    if (job.status !== 'completed') return;
    setOpen(false);
    if (job.kind === 'document') navigate(`/read/${job.ref_id}`);
    if (job.kind === 'audiobook') navigate(`/audio?book=${job.ref_id}`);
  };

  return (
    <div className="notif-wrap" ref={ref}>
      <button className="icon-ghost notif-bell" onClick={toggle} aria-label={`Notifications${unseen ? ` (${unseen} new)` : ''}`} aria-expanded={open}>
        {active ? <Loader2 size={17} className="spin" /> : <Bell size={17} />}
        {(unseen > 0 || active > 0) && <span className="notif-dot">{unseen || ''}</span>}
      </button>
      {open && pos && createPortal(
        <div className="notif-panel" ref={panelRef} style={pos} role="dialog" aria-label="Notifications">
          <div className="notif-head">
            <strong>Activity</strong>
            {jobs.some((j) => j.status === 'completed' || j.status === 'failed') && (
              <button className="text-button" onClick={() => api.activity.clearJobs().then(loadJobs)}><Trash2 size={12} /> Clear</button>
            )}
          </div>
          {jobs.length === 0 && <p className="notif-empty">Uploads and audiobook generation will show their progress here.</p>}
          {jobs.map((j) => {
            const Icon = j.kind === 'audiobook' ? Headphones : BookOpen;
            return (
              <button key={j.id} className={`notif-item ${j.status}`} onClick={() => openJob(j)} disabled={j.status !== 'completed'}>
                <span className="notif-icon"><Icon size={14} /></span>
                <span className="notif-body">
                  <strong>{j.title}</strong>
                  <small>
                    {j.status === 'failed' ? (j.error || 'Failed') : j.status === 'completed' ? `Ready · ${timeAgo(j.updated_at)}` : j.stage}
                  </small>
                  {(j.status === 'processing' || j.status === 'queued') && <ProgressBar value={j.progress} thin />}
                </span>
                {j.status === 'completed' && <Check size={14} className="ok" />}
                {j.status === 'failed' && <XCircle size={14} className="bad" />}
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}
