import { sameOriginStillUrl } from './model.js';

const WARNING =
  'WARNING: Undocumented experimental feed. Not a stable API. Not cleared for production. Stills only — live video is not opened.';

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * Glass card for one ALGO still. API text is assigned with textContent.
 * The image address is the same-origin proxy path. HLS and DASH are never opened.
 */
export function createAlgoPopover({
  document: doc = globalThis.document,
} = {}) {
  let root = null;
  let handlers = {};
  let imageRetried = false;

  function ensure() {
    if (root || !doc?.body || typeof doc.createElement !== 'function')
      return root;
    root = el(doc, 'section', 'algo-popover');
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.tabIndex = -1;
    doc.body.appendChild(root);
    root.addEventListener('click', (event) => {
      const action =
        event.target?.closest?.('[data-algo-action]')?.dataset?.algoAction;
      if (action === 'close') handlers.onClose?.();
      else if (action === 'refresh') handlers.onRefresh?.();
    });
    return root;
  }

  function button(action, label) {
    const node = el(doc, 'button', 'algo-popover-action', label);
    node.type = 'button';
    node.dataset.algoAction = action;
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
    const row = el(doc, 'div', 'algo-popover-head');
    const heading = el(doc, 'h2', 'algo-popover-title', title);
    heading.id = 'algo-popover-title';
    const close = button('close', 'Close');
    close.className = 'algo-popover-close';
    close.setAttribute('aria-label', 'Close ALGO camera');
    row.append(heading, close);
    root.setAttribute('aria-labelledby', 'algo-popover-title');
    return row;
  }

  function metaLine(record) {
    return [record.route, record.direction, record.city, record.county]
      .filter(Boolean)
      .join(' · ');
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
      node.setAttribute('aria-label', record.title || 'ALGO camera');
      node.append(header(record.title || 'ALGO camera'));
      node.append(el(doc, 'p', 'algo-popover-warning', WARNING));
      const meta = metaLine(record);
      if (meta) node.append(el(doc, 'p', 'algo-popover-meta', meta));
      const region = record.region
        ? `${record.region} · ALGO Traffic`
        : 'ALGO Traffic';
      node.append(el(doc, 'p', 'algo-popover-meta', region));
      if (view.loading)
        node.append(el(doc, 'p', 'algo-popover-meta', 'Loading still…'));
      else {
        const still = sameOriginStillUrl(view.stillUrl || record.stillUrl);
        if (still) {
          const image = el(doc, 'img', 'algo-popover-still');
          image.alt = record.title || 'Traffic camera still';
          image.referrerPolicy = 'no-referrer';
          image.src = still;
          image.addEventListener('error', () => {
            image.replaceWith(
              el(doc, 'p', 'algo-popover-meta', 'Still unavailable.'),
            );
            if (!imageRetried && view.refreshOnError) {
              imageRetried = true;
              handlers.onImageError?.();
            }
          });
          node.append(image);
        } else {
          node.append(el(doc, 'p', 'algo-popover-meta', 'No still available.'));
        }
      }
      if (view.error)
        node.append(el(doc, 'p', 'algo-popover-error', view.error));
      const actions = el(doc, 'div', 'algo-popover-actions');
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
