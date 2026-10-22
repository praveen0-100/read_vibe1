// Compact "continue reading" bar above the mobile tab bar (the book you were last in).
import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Play } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { useQuery } from '../../hooks/useAsync';
import { Cover } from '../ui';

export default function MiniReading() {
  const { dataVersion } = useApp();
  const location = useLocation();
  const navigate = useNavigate();
  const docs = useQuery(() => api.documents.list({ sort: 'recent' }), [dataVersion, location.pathname]);
  const doc = (docs.data || []).find((d) => d.status === 'ready' && d.last_opened_at && Math.round(d.progress) < 100);
  if (!doc) return null;
  return (
    <button className="mini-reading" onClick={() => navigate(`/read/${doc.id}`)} aria-label={`Continue reading ${doc.title}`}>
      <Cover doc={doc} size="sm" />
      <span className="mini-text">
        <strong>{doc.title}</strong>
        <small>{doc.current_chapter_title || doc.author} · {Math.round(doc.progress)}%</small>
      </span>
      <span className="mini-go" aria-hidden="true"><Play size={16} fill="currentColor" /></span>
      <span className="mini-bar" aria-hidden="true"><i style={{ width: `${doc.progress}%` }} /></span>
    </button>
  );
}
