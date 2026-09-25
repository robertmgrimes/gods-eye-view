import { sameOriginStillUrl } from './model.js';

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * Glass card for one KYTC still. API text is assigned with textContent.
 * The image address is the same-origin proxy path, never the upstream HTTP URL.
 */
export function createKytcPopover({
  document: doc = globalThis.document,
} = {}) {
  let root = null;
  let handlers = {};
  let imageRetried = false;

  function ensure() {
    if (root || !doc?.body || typeof doc.createElement !== 'function')
      return root;
    root = el(doc, 'section', 'kytc-popover');
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.tabIndex = -1;
    doc.body.appendChild(root);
    root.addEventListener('click', (event) => {
      const action =
        event.target?.closest?.('[data-kytc-action]')?.dataset?.kytcAction;
      if (action === 'close') handlers.onClose?.();
      else if (action === 'refresh') handlers.onRefresh?.();
    });
    return root;
  }

  function button(action, label) {
    const node = el(doc, 'button', 'kytc-popover-action', label);
    node.type = 'button';
    node.dataset.kytcAction = action;
    return node;
  }

  function place(screen) {
    if (!root) return;
    const width = root.offsetWidth || 320;
    const height = root.offsetHeight || 240;
    const viewW = doc.documentElement?.clientWidth || 800;
    const viewH = doc.documentElement?.clientHeight || 600;
    const x = Number(screen?.x);
    const y = Number(screen?.y);
    const left = Number.isFinite(x) ? x + 14 : 24;
    const top = Number.isFinite(y) ? y + 14 : 24;
    root.style.left = `${Math.max(12, Math.min(left, viewW - width - 12))}px`;
    root.style.top = `${Math.max(12, Math.min(top, viewH - height - 12))}px`;
  }

  function header(title) {
    const row = el(doc, 'div', 'kytc-popover-head');
    const heading = el(doc, 'h2', 'kytc-popover-title', title);
    heading.id = 'kytc-popover-title';
    const close = button('close', 'Close');
    close.className = 'kytc-popover-close';
    close.setAttribute('aria-label', 'Close KYTC camera');
    row.append(heading, close);
    root.setAttribute('aria-labelledby', 'kytc-popover-title');
    return row;
  }

  function metaLine(record) {
    const placeLabel = [record.highway, record.direction, record.county]
      .filter(Boolean)
      .join(' · ');
    const district = record.district ? `District ${record.district}` : '';
    return [placeLabel, district, record.state].filter(Boolean).join(' · ');
  }

  function feedLine(record) {
    if (record.place === 'Indiana') return 'Indiana border · KYTC feed';
    return `${record.place || 'Kentucky'} · KYTC feed`;
  }

  return {
    setHandlers(next) {
      handlers = next || {};
    },
    show(view = {}) {
      const node = ensure();
      if (!node) return;
      imageRetried = false;
      const record = view.record || {};
      node.replaceChildren();
      node.setAttribute('aria-label', record.title || 'KYTC camera');
      node.append(header(record.title || 'KYTC camera'));
      const meta = metaLine(record);
      if (meta) node.append(el(doc, 'p', 'kytc-popover-meta', meta));
      node.append(el(doc, 'p', 'kytc-popover-meta', feedLine(record)));
      if (record.description && record.description !== record.title)
        node.append(el(doc, 'p', 'kytc-popover-meta', record.description));
      if (record.status)
        node.append(
          el(doc, 'p', 'kytc-popover-meta', `Status ${record.status}`),
        );
      const still = sameOriginStillUrl(view.stillUrl || record.stillUrl);
      if (view.loading)
        node.append(el(doc, 'p', 'kytc-popover-meta', 'Loading still…'));
      else if (still) {
        const image = el(doc, 'img', 'kytc-popover-still');
        image.alt = record.title || 'Traffic camera still';
        image.referrerPolicy = 'no-referrer';
        image.src = still;
        image.addEventListener('error', () => {
          image.replaceWith(
            el(doc, 'p', 'kytc-popover-meta', 'Still unavailable.'),
          );
          if (!imageRetried && view.refreshOnError) {
            imageRetried = true;
            handlers.onImageError?.();
          }
        });
        node.append(image);
      } else {
        node.append(el(doc, 'p', 'kytc-popover-meta', 'No still available.'));
      }
      node.append(
        el(
          doc,
          'p',
          'kytc-popover-note',
          'Still preview. This feed does not include live video.',
        ),
      );
      if (view.error)
        node.append(el(doc, 'p', 'kytc-popover-error', view.error));
      const actions = el(doc, 'div', 'kytc-popover-actions');
      actions.append(button('refresh', 'Refresh still'));
      node.append(actions);
      node.hidden = false;
      place(view.screen);
    },
    hide() {
      if (root) root.hidden = true;
    },
    destroy() {
      root?.remove();
      root = null;
      handlers = {};
    },
    get element() {
      return root;
    },
  };
}
