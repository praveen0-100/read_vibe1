// Page navigator: every chapter as a grid of page tiles (like the Kindle "Page Flip" view). Tapping a tile jumps there and
// leaves a "Back to N" marker so the reader can return to where they were.
import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

export default function PageGrid({ doc, chapterIndex, weights, totalPages, total, currentPage, onGoPage, onClose }) {
  const curRef = useRef(null);
  useEffect(() => { curRef.current?.scrollIntoView({ block: 'center' }); }, []);
  let start = 1;
  const sections = doc.chapters.map((ch, i) => {
    const count = Math.max(1, Math.round((weights[i] / total) * totalPages));
    const sec = { ch, i, first: start, count };
    start += count;
    return sec;
  });
  return (
    <div className="mr-sheet mr-contents mr-pagegrid" role="dialog" aria-label="Pages">
      <div className="mr-tabs">
        <span className="mr-grid-title">Pages · {currentPage} of {totalPages}</span>
        <button className="mr-sheet-close" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      <div className="mr-grid-scroll">
        {sections.map(({ ch, i, first, count }) => (
          <section key={ch.index ?? i}>
            <h4 className={i === chapterIndex ? 'current' : ''}>{ch.title}</h4>
            <div className="mr-tiles">
              {Array.from({ length: Math.min(count, 400) }, (_, k) => {
                const n = first + k;
                const here = n === currentPage;
                return (
                  <button key={n} ref={here ? curRef : undefined} className={`mr-tile ${here ? 'here' : ''}`} onClick={() => onGoPage(n)} aria-label={`Page ${n}`} aria-current={here ? 'page' : undefined}>
                    <i /><i /><i /><i /><i />
                    <span>{n}</span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
