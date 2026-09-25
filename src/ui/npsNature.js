/**
 * Directory links under the NPS & nature row. These are curated pages.
 * The panel does not request a stream or a still.
 */
export function createNpsNaturePanel({ container, layer } = {}) {
  const doc = container?.ownerDocument;
  if (!container || !doc || typeof layer?.subscribe !== 'function') return null;
  const root = doc.createElement('div');
  root.className = 'nps-nature-links';
  container.appendChild(root);

  function render(snap) {
    root.replaceChildren();
    const rows = Array.isArray(snap?.linkOuts) ? snap.linkOuts : [];
    if (!rows.length) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    const note = doc.createElement('p');
    note.className = 'nps-nature-links-note';
    note.textContent =
      'Link-outs only. Explore.org is not scraped. Yosemite Conservancy cameras are not listed.';
    root.append(note);
    const list = doc.createElement('ul');
    list.className = 'nps-nature-links-list';
    for (const row of rows) {
      if (!row?.pageUrl || !row?.name) continue;
      const item = doc.createElement('li');
      const anchor = doc.createElement('a');
      anchor.href = row.pageUrl;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.textContent = row.seasonal
        ? `${row.name} (${row.seasonal})`
        : row.name;
      item.append(anchor);
      list.append(item);
    }
    root.append(list);
  }

  render(layer.getSnapshot?.() || {});
  const unsubscribe = layer.subscribe(render);
  return {
    destroy() {
      unsubscribe?.();
      root.remove();
    },
  };
}
