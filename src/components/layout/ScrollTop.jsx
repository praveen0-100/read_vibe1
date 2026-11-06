// "Back to top": appears after scrolling down on phones and tablets and glides back up. The page scrolls inside #main, so that
// is the element watched and scrolled.
import React, { useEffect, useState } from 'react';
import { ArrowUp } from 'lucide-react';

export default function ScrollTop() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const main = document.getElementById('main');
    if (!main) return undefined;
    let raf = 0;
    const update = () => { raf = 0; setShow(main.scrollTop > Math.max(500, main.clientHeight * 0.9)); };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); }; // at most once per frame: scrolling stays smooth
    main.addEventListener('scroll', onScroll, { passive: true });
    update();
    return () => { main.removeEventListener('scroll', onScroll); if (raf) cancelAnimationFrame(raf); };
  }, []);
  const up = () => {
    const main = document.getElementById('main');
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!main) return;
    const start = main.scrollTop;
    main.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
    // some embedded browsers / battery-saver modes never run the glide: if it hasn't started, just go
    if (!reduced) setTimeout(() => { if (main.scrollTop > start - 4) main.scrollTo({ top: 0, behavior: 'auto' }); }, 280);
  };
  return (
    <button className={`scroll-top ${show ? 'show' : ''}`} onClick={up} aria-label="Back to top" tabIndex={show ? 0 : -1} aria-hidden={!show}><ArrowUp size={18} /></button>
  );
}
