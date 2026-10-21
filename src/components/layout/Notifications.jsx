// ─── Notification centre: background jobs (uploads, audiobooks) ──────────────
import React, { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, BookOpen, Check, Headphones, Loader2, Trash2, XCircle } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { useClickOutside } from '../../hooks/useAsync';
import { timeAgo } from '../../lib/format';
import { ProgressBar } from '../ui';

export default function Notifications() {
  const { jobs, loadJobs } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const close = useCallback(() => setOpen(false), []);
  useClickOutside(ref, close, open);

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
      {open && (
        <div className="notif-panel" role="dialog" aria-label="Notifications">
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
        </div>
      )}
    </div>
  );
}
