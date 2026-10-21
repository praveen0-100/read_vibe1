// Renders chapter paragraphs with saved highlights, search matches and read-aloud focus.
import React, { memo, useMemo } from 'react';
import { escapeRegExp } from '../../lib/format';
import { categoryColor } from './ReaderTools';

const norm = (s) => s.replace(/\s+/g, ' ').trim();

/** Ranges of `hl.text` inside `para`, including highlights that span paragraph boundaries. */
function highlightRanges(para, hl) {
  const text = norm(hl.text);
  if (!text) return [];
  const idx = para.indexOf(text);
  if (idx >= 0) return [[idx, idx + text.length]];
  if (text.includes(para)) return [[0, para.length]];
  // selection started in this paragraph and continued into the next
  for (let len = Math.min(para.length, text.length) - 1; len >= 16; len--) {
    if (text.startsWith(para.slice(para.length - len))) return [[para.length - len, para.length]];
    if (len < para.length - 400) break;
  }
  // selection ended in this paragraph
  for (let len = Math.min(para.length, text.length) - 1; len >= 16; len--) {
    if (text.endsWith(para.slice(0, len))) return [[0, len]];
    if (len < para.length - 400) break;
  }
  return [];
}

function Paragraph({ text, index, highlights, query, active, onHighlightClick }) {
  const nodes = useMemo(() => {
    const ranges = [];
    highlights.forEach((h) => highlightRanges(text, h).forEach(([s, e]) => ranges.push({ s, e, h })));
    if (query && query.length >= 2) {
      const re = new RegExp(escapeRegExp(query), 'gi');
      let m;
      while ((m = re.exec(text))) ranges.push({ s: m.index, e: m.index + m[0].length, search: true });
    }
    if (!ranges.length) return [text];
    ranges.sort((a, b) => a.s - b.s || (a.search ? -1 : 1));
    const out = [];
    let cursor = 0;
    ranges.forEach((r, i) => {
      if (r.s < cursor) return; // overlapping — keep the first
      if (r.s > cursor) out.push(text.slice(cursor, r.s));
      const content = text.slice(r.s, r.e);
      out.push(r.search
        ? <mark key={`s${i}`} className="search-hit">{content}</mark>
        : (
          <mark key={`h${i}`} data-hl={r.h.id} className={`hl hl-${categoryColor(r.h.category)} ${r.h.note ? 'has-note' : ''}`}
            title={r.h.note ? `${r.h.category}: ${r.h.note}` : r.h.category} tabIndex={0}
            onClick={(e) => onHighlightClick(r.h, e.currentTarget)} onKeyDown={(e) => e.key === 'Enter' && onHighlightClick(r.h, e.currentTarget)}>
            {content}
          </mark>
        ));
      cursor = r.e;
    });
    if (cursor < text.length) out.push(text.slice(cursor));
    return out;
  }, [text, highlights, query, onHighlightClick]);

  const isQuote = /^["“].{10,}["”]$/.test(text);
  const isHeading = text.length < 70 && /^#{1,3}\s/.test(text);
  if (isHeading) return <h3 data-p={index} className="in-chapter-heading">{text.replace(/^#+\s*/, '')}</h3>;
  const Tag = isQuote ? 'blockquote' : 'p';
  return <Tag data-p={index} className={active ? 'reading-now' : undefined}>{nodes}</Tag>;
}

const MemoParagraph = memo(Paragraph);

function ChapterText({ content, highlights, query, activeParagraph, onHighlightClick, dropcap = true }) {
  const paragraphs = useMemo(() => content.split(/\n\s*\n/).map(norm).filter(Boolean), [content]);
  return (
    <div className={`article-copy ${dropcap ? 'with-dropcap' : ''}`}>
      {paragraphs.map((p, i) => (
        <MemoParagraph key={i} index={i} text={p} highlights={highlights} query={query} active={activeParagraph === i} onHighlightClick={onHighlightClick} />
      ))}
    </div>
  );
}

export default memo(ChapterText);
export const splitParagraphs = (content) => content.split(/\n\s*\n/).map(norm).filter(Boolean);
