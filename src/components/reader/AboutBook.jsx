// "About this book": shown once, the first time a document is opened (switch off in Reading settings).
import React, { useEffect, useState } from 'react';
import { BookOpen, Clock3, Headphones } from 'lucide-react';
import { formatMinutes } from '../../lib/format';
import { Modal } from '../ui';

const key = (id) => `rv.about.${id}`;
export const aboutSeen = (id) => { try { return localStorage.getItem(key(id)) === '1'; } catch { return true; } };

export default function AboutBook({ doc, enabled, onStart }) {
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(!!enabled && !!doc && (doc.progress || 0) < 1 && !aboutSeen(doc.id)); }, [doc?.id, enabled]); // eslint-disable-line
  if (!open || !doc) return null;
  const close = () => { try { localStorage.setItem(key(doc.id), '1'); } catch { /* private mode */ } setOpen(false); };
  const minutes = doc.minutes_total || 0;
  return (
    <Modal open onClose={close} eyebrow="ABOUT THIS BOOK" title={doc.title} size="sm"
      footer={<button className="primary-button" onClick={() => { close(); onStart?.(); }}>Start reading</button>}>
      <p className="muted" style={{ marginTop: 0 }}>{doc.author}</p>
      <ul className="about-facts">
        <li><BookOpen size={14} /> {doc.chapter_count || doc.chapters?.length || 1} sections · {(doc.word_count || 0).toLocaleString()} words</li>
        <li><Clock3 size={14} /> About {formatMinutes(minutes)} to read</li>
        <li><Headphones size={14} /> About {formatMinutes(Math.round(minutes * 1.15))} to listen</li>
      </ul>
      {doc.description && <p>{doc.description}</p>}
      {doc.tags?.length > 0 && <p className="about-tags">{doc.tags.map((t) => <span key={t} className="chip">#{t}</span>)}</p>}
    </Modal>
  );
}
