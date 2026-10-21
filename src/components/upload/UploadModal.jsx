// ─── Upload: files (with progress + background processing) or pasted text ────
import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, BookOpen, Check, ClipboardPaste, FileText, Loader2, Upload, X } from 'lucide-react';
import { api } from '../../api/client';
import { useApp } from '../../context/AppContext';
import { formatBytes } from '../../lib/format';
import { Field, Modal, ProgressBar, Segmented } from '../ui';

const SUPPORTED = ['pdf', 'epub', 'docx', 'txt', 'md', 'html', 'rtf'];
const MAX_MB = 5 * 1024; // 5 GB — the API streams uploads to disk

export default function UploadModal() {
  const { uploadOpen, setUploadOpen, trackJob, notify, refreshData } = useApp();
  const navigate = useNavigate();
  const [tab, setTab] = useState('file');
  const [items, setItems] = useState([]); // {id, file, status, progress, stage, error, docId}
  const [dragOver, setDragOver] = useState(false);
  const [text, setText] = useState({ title: '', author: '', content: '', doc_type: 'DOCUMENT' });
  const [savingText, setSavingText] = useState(false);
  const inputRef = useRef(null);

  const busy = items.some((i) => i.status === 'uploading' || i.status === 'processing');
  const close = () => {
    setUploadOpen(false);
    if (!busy) setTimeout(() => setItems([]), 200);
  };

  const update = (id, patch) => setItems((list) => list.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  const addFiles = (fileList) => {
    const next = [];
    for (const file of fileList) {
      const ext = file.name.split('.').pop().toLowerCase();
      const error = !SUPPORTED.includes(ext) ? `.${ext} isn’t supported` : file.size > MAX_MB * 1024 * 1024 ? "Larger than the 5 GB limit" : null;
      next.push({ id: `${file.name}-${file.size}-${Math.random()}`, file, status: error ? 'error' : 'ready', progress: 0, error });
    }
    setItems((list) => [...list, ...next]);
  };

  const uploadOne = async (item) => {
    update(item.id, { status: 'uploading', progress: 0, stage: 'Uploading' });
    try {
      const res = await api.documents.upload(item.file, (p) => update(item.id, {
        progress: p * 0.4,
        stage: `Uploading ${p}% · ${formatBytes((item.file.size * p) / 100)} of ${formatBytes(item.file.size)}`,
      }));
      update(item.id, { status: 'processing', progress: 40, stage: 'Extracting text', docId: res.document.id });
      trackJob(res.job_id, (job) => {
        if (job.status === 'completed') {
          update(item.id, { status: 'done', progress: 100, stage: 'Ready to read', title: job.result?.title });
          notify(`“${job.result?.title || item.file.name}” is ready`, 'success', { action: { label: 'Read', onClick: () => navigate(`/read/${res.document.id}`) } });
        } else {
          update(item.id, { status: 'error', error: job.error || 'Processing failed' });
          notify(job.error || `Couldn’t process ${item.file.name}`, 'error');
        }
      });
      // light polling for granular progress while the modal is open
      const poll = setInterval(async () => {
        try {
          const job = await api.activity.job(res.job_id);
          if (job.status === 'processing' || job.status === 'queued') update(item.id, { progress: 40 + job.progress * 0.6, stage: job.stage });
          else clearInterval(poll);
        } catch { clearInterval(poll); }
      }, 700);
    } catch (err) {
      update(item.id, { status: 'error', error: err.message });
    }
  };

  const startAll = () => items.filter((i) => i.status === 'ready').forEach(uploadOne);

  const saveText = async (e) => {
    e.preventDefault();
    setSavingText(true);
    try {
      const doc = await api.documents.createText({ ...text, author: text.author || 'You', title: text.title || 'Untitled note' });
      notify(`“${doc.title}” added to your library`);
      refreshData();
      setText({ title: '', author: '', content: '', doc_type: 'DOCUMENT' });
      setUploadOpen(false);
      navigate(`/read/${doc.id}`);
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setSavingText(false);
    }
  };

  const ready = items.filter((i) => i.status === 'ready').length;
  const done = items.filter((i) => i.status === 'done');

  return (
    <Modal open={uploadOpen} onClose={close} eyebrow="ADD TO LIBRARY" title="Add a document" icon={Upload} size="md">
      <Segmented value={tab} onChange={setTab} label="Upload method" options={[
        { value: 'file', label: 'Upload files', icon: Upload },
        { value: 'text', label: 'Paste text', icon: ClipboardPaste },
      ]} />

      {tab === 'file' ? (
        <>
          <div className={`drop-zone ${dragOver ? 'over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
            onClick={() => inputRef.current?.click()} role="button" tabIndex={0}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
            aria-label="Choose files to upload, or drop them here">
            <input ref={inputRef} type="file" multiple hidden accept={SUPPORTED.map((s) => `.${s}`).join(',')}
              onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
            <Upload size={30} />
            <p>Drop files here, or <span className="browse-link">browse</span></p>
            <div className="supported-formats">{SUPPORTED.map((f) => <span key={f} className="format-badge">{f.toUpperCase()}</span>)}</div>
            <small>Up to 5 GB each · large files upload with live progress and are processed in the background</small>
          </div>

          {items.length > 0 && (
            <ul className="upload-list">
              {items.map((it) => (
                <li key={it.id} className={`upload-item ${it.status}`}>
                  <FileText size={18} />
                  <div className="upload-item-body">
                    <div className="upload-item-top">
                      <strong>{it.title || it.file.name}</strong>
                      <small>{formatBytes(it.file.size)}</small>
                    </div>
                    {it.status === 'error' ? <small className="field-error"><AlertCircle size={11} /> {it.error}</small>
                      : it.status === 'ready' ? <small className="muted">Ready to upload</small>
                      : <><ProgressBar value={it.progress} thin /><small className="muted">{it.stage}</small></>}
                  </div>
                  {it.status === 'done' && (
                    <button className="secondary-button small" onClick={() => { close(); navigate(`/read/${it.docId}`); }}><BookOpen size={13} /> Read</button>
                  )}
                  {(it.status === 'uploading' || it.status === 'processing') && <Loader2 size={16} className="spin muted" />}
                  {(it.status === 'ready' || it.status === 'error') && (
                    <button className="icon-ghost sm" onClick={() => setItems((l) => l.filter((x) => x.id !== it.id))} aria-label={`Remove ${it.file.name}`}><X size={14} /></button>
                  )}
                  {it.status === 'done' && <Check size={16} className="ok" />}
                </li>
              ))}
            </ul>
          )}

          <div className="modal-actions">
            {done.length > 0 && !busy && <button className="secondary-button" onClick={() => { close(); navigate('/library'); }}>View library</button>}
            <button className="primary-button" onClick={startAll} disabled={!ready}>
              <Upload size={15} /> {ready ? `Upload ${ready} file${ready > 1 ? 's' : ''}` : busy ? 'Processing…' : 'Choose files'}
            </button>
          </div>
        </>
      ) : (
        <form className="paste-form" onSubmit={saveText}>
          <div className="form-row">
            <Field label="Title"><input className="input" value={text.title} onChange={(e) => setText({ ...text, title: e.target.value })} placeholder="My lecture notes" maxLength={300} /></Field>
            <Field label="Author"><input className="input" value={text.author} onChange={(e) => setText({ ...text, author: e.target.value })} placeholder="You" maxLength={200} /></Field>
          </div>
          <Field label="Type">
            <Segmented size="sm" value={text.doc_type} onChange={(v) => setText({ ...text, doc_type: v })}
              options={[{ value: 'DOCUMENT', label: 'Document' }, { value: 'BOOK', label: 'Book' }, { value: 'PAPER', label: 'Paper' }]} />
          </Field>
          <Field label="Text" hint="Use “# Heading” or “Chapter 1” lines to split chapters.">
            <textarea className="input" rows={9} required value={text.content} onChange={(e) => setText({ ...text, content: e.target.value })} placeholder="Paste an article, chapter or notes…" />
          </Field>
          <div className="modal-actions">
            <span className="muted small">{text.content.split(/\s+/).filter(Boolean).length} words</span>
            <button className="primary-button" disabled={!text.content.trim() || savingText}>
              {savingText ? <Loader2 size={15} className="spin" /> : <BookOpen size={15} />} Add & start reading
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
