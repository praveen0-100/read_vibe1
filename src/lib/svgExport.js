// Export an on-screen SVG as PNG, SVG or a self-contained HTML embed.

function serialise(svg) {
  const clone = svg.cloneNode(true);
  const styles = getComputedStyle(document.documentElement);
  const bg = styles.getPropertyValue('--panel').trim() || '#1a1917';
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.querySelectorAll('[data-panzoom]').forEach((g) => g.removeAttribute('transform')); // export the full, un-zoomed view
  // inline the CSS variables the diagram uses so the export renders standalone
  const vars = ['--text', '--text-2', '--muted', '--line', '--line-2', '--panel', '--panel-2', '--panel-3', '--accent', '--accent-soft', '--purple', '--purple-soft', '--blue', '--blue-soft', '--green', '--green-soft', '--amber', '--amber-soft'];
  const css = `:root{${vars.map((v) => `${v}:${styles.getPropertyValue(v)}`).join(';')}} text{font-family:'DM Sans',system-ui,sans-serif}`;
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = css;
  clone.insertBefore(style, clone.firstChild);
  const vb = svg.viewBox.baseVal;
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  Object.entries({ x: vb.x, y: vb.y, width: vb.width, height: vb.height, fill: bg }).forEach(([k, v]) => rect.setAttribute(k, v));
  clone.insertBefore(rect, style.nextSibling);
  clone.removeAttribute('style');
  clone.setAttribute('width', vb.width);
  clone.setAttribute('height', vb.height);
  return new XMLSerializer().serializeToString(clone);
}

function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

export function exportSvg(svg, name = 'diagram') {
  save(new Blob([serialise(svg)], { type: 'image/svg+xml' }), `${name}.svg`);
}

export function exportHtml(svg, name = 'diagram', title = 'ReadVibe diagram') {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>body{margin:0;display:grid;place-items:center;min-height:100vh;background:#111}svg{max-width:100%;height:auto}</style></head><body>${serialise(svg)}</body></html>`;
  save(new Blob([html], { type: 'text/html' }), `${name}.html`);
}

export function exportPng(svg, name = 'diagram', scale = 2) {
  return new Promise((resolve, reject) => {
    const data = serialise(svg);
    const img = new Image();
    const vb = svg.viewBox.baseVal;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = vb.width * scale;
      canvas.height = vb.height * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, vb.width, vb.height);
      canvas.toBlob((blob) => { if (blob) { save(blob, `${name}.png`); resolve(); } else reject(new Error('PNG export failed')); }, 'image/png');
    };
    img.onerror = () => reject(new Error('PNG export failed'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data)}`;
  });
}
