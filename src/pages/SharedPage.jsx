// Public read-only page for a share link (/s/:token). No sign-in; it renders only what the owner chose to share.
import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { BookOpen, Pin } from 'lucide-react';
import { api } from '../api/client';
import { describeMarks, markPresentation } from '../lib/annotations';

export default function SharedPage() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { document.title = 'Shared highlights — ReadVibe'; api.shares.view(token).then(setData).catch((e) => setError(e.status === 404 ? 'This link is no longer available.' : e.message)); }, [token]);

  if (error) return <main className="shared-page"><div className="shared-card"><BookOpen size={28} /><h1>Link unavailable</h1><p>{error}</p></div></main>;
  if (!data) return <main className="shared-page"><div className="shared-card"><p>Loading…</p></div></main>;
  let last = null;
  return (
    <main className="shared-page">
      <article className="shared-card">
        <div className="eyebrow">SHARED FROM READVIBE</div>
        <h1>{data.title}</h1>
        <p className="muted">{data.author} · {data.highlights.length} highlight{data.highlights.length === 1 ? '' : 's'}</p>
        {data.highlights.map((h, i) => {
          const heading = h.chapter !== last ? h.chapter : null;
          last = h.chapter;
          const pres = markPresentation(h.marks);
          return (
            <React.Fragment key={i}>
              {heading && <h2>{heading}</h2>}
              <blockquote>
                <p><mark className={pres ? `hl ${pres.className}` : 'hl hl-yellow'} style={pres?.style} title={describeMarks(h.marks)}>{h.text}</mark>{h.pinned && <Pin size={12} aria-label="Pinned" />}</p>
                {h.note && <footer>Note: {h.note}</footer>}
              </blockquote>
            </React.Fragment>
          );
        })}
        <p className="fineprint">Read-only link · expires {new Date(data.expires_at).toLocaleDateString()}</p>
      </article>
    </main>
  );
}
