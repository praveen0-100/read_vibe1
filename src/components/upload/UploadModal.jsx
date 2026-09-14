// ─── Upload Modal ──────────────────────────────────────────────────────────────
import React, { useState, useRef } from 'react';
import { X, Upload, FileText, File, Check, AlertCircle, ArrowRight } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { ProgressBar } from '../ui';

const SUPPORTED = ['PDF', 'EPUB', 'DOCX', 'TXT', 'MD'];

export default function UploadModal() {
  const { state, dispatch, notify } = useApp();
  const { uploadOpen } = state;
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState(null);
  const [stage, setStage] = useState('pick'); // 'pick' | 'uploading' | 'processing' | 'done'
  const [progress, setProgress] = useState(0);
  const [stageLabel, setStageLabel] = useState('');
  const inputRef = useRef(null);

  if (!uploadOpen) return null;

  const close = () => {
    dispatch({ type: 'SET_UPLOAD_OPEN', payload: false });
    setFile(null);
    setStage('pick');
    setProgress(0);
  };

  const handleFile = (f) => {
    if (!f) return;
    const ext = f.name.split('.').pop().toUpperCase();
    if (!SUPPORTED.includes(ext)) {
      notify(`Unsupported format. Please use: ${SUPPORTED.join(', ')}`, 'error');
      return;
    }
    setFile(f);
  };

  const processUpload = async () => {
    setStage('uploading');
    const stages = [
      { label: 'Uploading file...', pct: 30 },
      { label: 'Extracting text...', pct: 55 },
      { label: 'Analyzing structure...', pct: 75 },
      { label: 'Building index...', pct: 90 },
      { label: 'Ready!', pct: 100 },
    ];
    for (const s of stages) {
      setStageLabel(s.label);
      setProgress(s.pct);
      await new Promise(r => setTimeout(r, 600));
    }
    setStage('done');
    const newDoc = {
      id: Date.now(),
      title: file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' '),
      author: 'Uploaded document',
      type: 'PDF',
      format: file.name.split('.').pop().toUpperCase(),
      progress: 0,
      chapter: 'Start reading',
      currentPage: 1,
      totalPages: 200,
      color: 'lavender',
      time: '—',
      tag: 'New',
      lastOpened: 'Just now',
      offline: false,
      audioGenerated: false,
      coverSymbol: '⌁',
      description: '',
      chapters: [{ id: 1, title: 'Chapter 1', page: 1, duration: '—' }],
      highlights: [],
    };
    dispatch({ type: 'ADD_DOCUMENT', payload: newDoc });
  };

  return (
    <div className="overlay" onClick={e => e.target === e.currentTarget && close()}>
      <div className="upload-modal" role="dialog" aria-label="Upload document" aria-modal="true">
        <div className="modal-head">
          <div>
            <div className="eyebrow">ADD TO LIBRARY</div>
            <h2><Upload size={19} /> Upload document</h2>
          </div>
          <button onClick={close} aria-label="Close"><X size={18} /></button>
        </div>

        {stage === 'pick' && (
          <>
            <div
              className={`drop-zone ${dragOver ? 'over' : ''} ${file ? 'has-file' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files[0]); }}
              onClick={() => inputRef.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && inputRef.current?.click()}
              aria-label="Drop zone — click or drag a file here"
            >
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.epub,.docx,.txt,.md"
                onChange={e => handleFile(e.target.files[0])}
                style={{ display: 'none' }}
              />
              {file ? (
                <div className="file-preview">
                  <FileText size={36} />
                  <div>
                    <strong>{file.name}</strong>
                    <small>{(file.size / 1024 / 1024).toFixed(1)} MB</small>
                  </div>
                  <button className="remove-file" onClick={e => { e.stopPropagation(); setFile(null); }} aria-label="Remove file">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <>
                  <Upload size={40} />
                  <p>Drag & drop a file here, or <span className="browse-link">browse</span></p>
                  <div className="supported-formats">
                    {SUPPORTED.map(f => <span key={f} className="format-badge">{f}</span>)}
                  </div>
                </>
              )}
            </div>

            <button
              className="primary-button full-width"
              onClick={processUpload}
              disabled={!file}
            >
              <Upload size={15} /> Upload and process
            </button>

            <p className="upload-notice">
              <AlertCircle size={12} /> Documents are processed locally in this prototype. Connect your backend for cloud processing.
            </p>
          </>
        )}

        {(stage === 'uploading' || stage === 'processing') && (
          <div className="upload-progress">
            <div className="upload-spinner">
              <Upload size={28} />
            </div>
            <p>{stageLabel}</p>
            <ProgressBar value={progress} />
            <small>{progress}% complete</small>
          </div>
        )}

        {stage === 'done' && (
          <div className="upload-success">
            <div className="success-icon"><Check size={32} /></div>
            <h3>{file?.name.replace(/\.[^/.]+$/, '')} is ready</h3>
            <p>Your document has been added to your library and is ready to read.</p>
            <div className="success-actions">
              <button className="primary-button" onClick={() => {
                close();
                notify('Opening your new document');
                dispatch({ type: 'SET_PAGE', payload: 'library' });
              }}>
                View in library <ArrowRight size={14} />
              </button>
              <button className="secondary-button" onClick={close}>Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
