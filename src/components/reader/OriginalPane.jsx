// The original document next to (or instead of) the extracted text.
//  - PDF: the browser's own viewer, positioned on the page of the paragraph being read.
//  - DOCX / text / Markdown: the file's own headings, paragraphs and tables, as written.
// The chapter/paragraph <-> page relationship is never lost: the page follows the paragraph the reader clicks.
import React, { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, FileText, Loader2, X } from 'lucide-react';
import { api, fetchBlob } from '../../api/client';

function Blocks({ blocks }) {
  return (
    <article className="op-doc">
      {blocks.map((b, i) => {
        if (b.type === 'heading') { const H = `h${Math.min(6, Math.max(1, b.level || 1))}`; return <H key={i}>{b.text}</H>; }
        if (b.type === 'table') {
          return (
            <table key={i}><tbody>{b.rows.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}>{c}</td>)}</tr>)}</tbody></table>
          );
        }
        return <p key={i}>{b.text}</p>;
      })}
    </article>
  );
}

export default function OriginalPane({ documentId, kind = 'pdf', page, sectionTitle, mode, onClose, onPage }) {
  const [url, setUrl] = useState(null);
  const [blocks, setBlocks] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let live = true;
    let made = null;
    setUrl(null); setBlocks(null); setError(null);
    if (kind === 'pdf') {
      // the PDF is a protected file, so it is fetched with the auth header and shown from an object URL
      fetchBlob(`/documents/${documentId}/file`)
        .then((blob) => { if (live) { made = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' })); setUrl(made); } })
        .catch((e) => live && setError(e.message || 'The original file could not be loaded'));
    } else {
      api.documents.render(documentId)
        .then((r) => live && setBlocks(r.blocks))
        .catch((e) => live && setError(e.message || 'The original could not be shown'));
    }
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [documentId, kind]);

  const n = Math.max(1, page || 1);
  return (
    <aside className={`original-pane ${mode}`} aria-label="Original document">
      <div className="op-bar">
        <FileText size={15} />
        <span className="op-ref">{kind === 'pdf' ? `Original · page ${n}` : 'Original'}{sectionTitle ? <small> · {sectionTitle}</small> : null}</span>
        {kind === 'pdf' && (
          <>
            <button onClick={() => onPage(Math.max(1, n - 1))} disabled={n <= 1} aria-label="Previous page"><ChevronLeft size={16} /></button>
            <button onClick={() => onPage(n + 1)} aria-label="Next page"><ChevronRight size={16} /></button>
          </>
        )}
        <button onClick={onClose} aria-label="Close original"><X size={16} /></button>
      </div>
      <div className="op-body">
        {error && <p className="op-msg">{error}</p>}
        {!error && !url && !blocks && <p className="op-msg"><Loader2 size={15} className="spin" /> Loading the original…</p>}
        {/* the #page fragment makes the browser's PDF viewer jump to the page; the key re-applies it when the page changes */}
        {url && <iframe key={n} title="Original PDF" src={`${url}#page=${n}&view=FitH`} />}
        {blocks && <Blocks blocks={blocks} />}
      </div>
    </aside>
  );
}
