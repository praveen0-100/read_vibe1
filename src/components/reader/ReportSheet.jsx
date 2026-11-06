// "Report extraction error": flag text that was imported wrongly so it can be fixed.
import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { Field, Modal } from '../ui';

const KINDS = [['typo', 'Typo or wrong characters'], ['missing', 'Text is missing'], ['garbled', 'Garbled or out of order'], ['other', 'Something else']];

export default function ReportSheet({ documentId, chapterIndex, text, onClose }) {
  const { notify } = useApp();
  const [kind, setKind] = useState('typo');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);

  const send = async () => {
    setBusy(true);
    try {
      await api.documents.report(documentId, { chapter_index: chapterIndex, text: text.slice(0, 2000), kind, comment });
      notify('Thanks — the report was saved');
      onClose();
    } catch (e) { notify(e.message, 'error'); } finally { setBusy(false); }
  };

  return (
    <Modal open onClose={onClose} eyebrow="REPORT" title="Report an extraction error" size="sm"
      footer={<><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" onClick={send} disabled={busy}>{busy && <Loader2 size={14} className="spin" />} Send report</button></>}>
      <blockquote className="report-quote">{text.length > 240 ? `${text.slice(0, 240)}…` : text}</blockquote>
      <Field label="What is wrong?">
        <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>{KINDS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
      </Field>
      <Field label="Details (optional)"><textarea className="input" rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="What should it say?" /></Field>
    </Modal>
  );
}
