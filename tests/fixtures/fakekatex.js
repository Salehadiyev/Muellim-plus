window.renderMathInElement = function (root, opts) {
  window.__renders = (window.__renders || 0) + 1;
  const skip = new Set((opts.ignoredTags || []).map(t => t.toUpperCase()));
  const walk = (n) => {
    if (n.nodeType === 1) { if (skip.has(n.tagName) || (opts.ignoredClasses||[]).some(c => n.classList.contains(c)) || n.classList.contains('katex')) return; [...n.childNodes].forEach(walk); return; }
    if (n.nodeType === 3 && /\$[^$]+\$/.test(n.nodeValue)) {
      const span = document.createElement('span'); span.innerHTML = n.nodeValue.replace(/\$\$?([^$]+)\$\$?/g, '<span class="katex">[$1]</span>'); n.replaceWith(span);
    }
  };
  walk(root);
};
