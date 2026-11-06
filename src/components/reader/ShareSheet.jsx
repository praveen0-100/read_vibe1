// Share highlights: create an expiring read-only public link, copy it (shown once), and revoke existing links.
import React, { useState } from 'react';
import { Check, Copy, Link2, Loader2, Trash2 } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { useQuery } from '../../hooks/useAsync';
import { timeAgo } from '../../lib/format';
import { Modal, Switch } from '../ui';

export default function ShareSheet({ documentId, title, onClose }) {
  const { notify } = useApp();
  const [version, setVersion] = useState(0);
  const shares = useQuery(() => api.shares.list(), [version]);
  const [days, setDays] = useState(14);
  const [notes, setNotes] = useState(false);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState(null); // { url } — the token is only ever shown here
  const mine = (shares.data || []).filter((s) => s.document_id === documentId);

  const create = async () => {
    setBusy(true);
    try {
      const s = await api.shares.create({ document_id: documentId, expires_days: days, include_notes: notes });
      setCreated({ url: `${window.location.origin}${s.path}` }); setVersion((v) => v + 1);
    } catch (e) { notify(e.message, 'error'); } finally { setBusy(false); }
  };
  const copy = (url) => navigator.clipboard?.writeText(url).then(() => notify('Link copied'));
  const revoke = async (s) => { try { await api.shares.revoke(s.id); setVersion((v) => v + 1); notify('Link revoked'); } catch (e) { notify(e.message, 'error'); } };

  return (
    <Modal open onClose={onClose} eyebrow="SHARE" title="Share your highlights" size="sm" footer={<button className="primary-button" onClick={onClose}>Done</button>}>
      <p className="muted" style={{ marginTop: 0 }}>Anyone with the link can read the highlights from “{title}” — no account needed. Only highlights are shared, never the book itself.</p>
      {created ? (
        <div className="share-created" role="status">
          <label className="field-label">Your link (copy it now — it can’t be shown again)</label>
          <div className="share-url"><input className="input" readOnly value={created.url} onFocus={(e) => e.target.select()} /><button className="secondary-button" onClick={() => copy(created.url)}><Copy size={14} /> Copy</button></div>
          <button className="text-button" onClick={() => setCreated(null)}>Create another</button>
        </div>
      ) : (
        <div className="stack">
          <label className="field"><span className="field-label">Expires after</span>
            <select className="input" value={days} onChange={(e) => setDays(+e.target.value)}>{[[1, '1 day'], [7, '7 days'], [14, '14 days'], [30, '30 days'], [90, '90 days']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
          </label>
          <Switch label="Include my notes" description="Notes you wrote on highlights become visible to anyone with the link" checked={notes} onChange={setNotes} />
          <button className="primary-button" disabled={busy} onClick={create}>{busy ? <Loader2 size={14} className="spin" /> : <Link2 size={14} />} Create link</button>
        </div>
      )}
      {mine.length > 0 && (
        <div className="share-list">
          <div className="eyebrow">LINKS FOR THIS BOOK</div>
          {mine.map((s) => (
            <div key={s.id} className={`share-row ${s.status}`}>
              <span>{s.status === 'active' ? <Check size={12} /> : null} {s.status === 'active' ? `Active · expires ${timeAgo(s.expires_at).replace(' ago', '')}` : s.status === 'revoked' ? 'Revoked' : 'Expired'}<small> · {s.views} view{s.views === 1 ? '' : 's'}{s.include_notes ? ' · with notes' : ''}</small></span>
              {s.status === 'active' && <button className="icon-ghost sm" onClick={() => revoke(s)} aria-label="Revoke link"><Trash2 size={13} /></button>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}
