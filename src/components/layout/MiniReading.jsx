// Compact "continue reading" bar above the mobile tab bar (the book you were last in).
import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Play, X } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { useQuery } from '../../hooks/useAsync';
import { Cover } from '../ui';

export default function MiniReading() {
  const { dataVersion } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(null);
  const docs = useQuery(() => api.documents.list({ sort: 'recent' }), [dataVersion, location.pathname]);
  const doc = (docs.data || []).find((d) => d.status === 'ready' && d.last_opened_at && Math.round(d.progress) < 100);
  if (!doc || dismissed === doc.id) return null;
  return (
    <div className="mini-reading" style={{ '--mini-progress': `${doc.progress}%` }}>
      <button className="mini-open" onClick={() => navigate(`/read/${doc.id}`)} aria-label={`Continue reading ${doc.title}`}>
        <Cover doc={doc} size="sm" />
        <span className="mini-text">
          <strong>{doc.title}</strong>
          <small>{doc.minutes_left} mins left</small>
        </span>
        <span className="mini-go" aria-hidden="true"><Play size={16} fill="currentColor" /></span>
      </button>
      <button className="mini-close" onClick={() => setDismissed(doc.id)} aria-label="Dismiss"><X size={18} /></button>
    </div>
  );
}
