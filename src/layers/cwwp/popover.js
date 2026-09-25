import { claimCameraCard, releaseCameraCard } from '../cameraCards.js';
import { sameOriginStillUrl } from './model.js';

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * Glass card for one Caltrans still. API text is assigned with textContent.
 * The image address is the same-origin proxy path. HLS is never opened.
 */
export function createCwwpPopover({
  document: doc = globalThis.document,
} = {}) {
  let root = null;
  let handlers = {};
  let imageRetried = false;

  function ensure() {
    if (root || !doc?.body || typeof doc.createElement !== 'function')
      return root;
    root = el(doc, 'section', 'cwwp-popover');
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.tabIndex = -1;
    doc.body.appendChild(root);
    root.addEventListener('click', (event) => {
      const action =
        event.target?.closest?.('[data-cwwp-action]')?.dataset?.cwwpAction;
      if (action === 'close') handlers.onClose?.();
      else if (action === 'refresh') handlers.onRefresh?.();
    });
    return root;
  }

  function button(action, label) {
    const node = el(doc, 'button', 'cwwp-popover-action', label);
    node.type = 'button';
    node.dataset.cwwpAction = action;
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
    const row = el(doc, 'div', 'cwwp-popover-head');
    const heading = el(doc, 'h2', 'cwwp-popover-title', title);
    heading.id = 'cwwp-popover-title';
    const close = button('close', 'Close');
    close.className = 'cwwp-popover-close';
    close.setAttribute('aria-label', 'Close Caltrans camera');
    row.append(heading, close);
    root.setAttribute('aria-labelledby', 'cwwp-popover-title');
    return row;
  }

  function metaLine(record) {
    return [record.route, record.direction, record.place, record.county]
      .filter(Boolean)
      .join(' · ');
  }

  function feedLine(record) {
    const district = record.district
      ? `District ${record.district}`
      : 'California';
    return `${district} · Caltrans CWWP`;
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
      node.setAttribute('aria-label', record.title || 'Caltrans camera');
      node.append(header(record.title || 'Caltrans camera'));
      const meta = metaLine(record);
      if (meta) node.append(el(doc, 'p', 'cwwp-popover-meta', meta));
      node.append(el(doc, 'p', 'cwwp-popover-meta', feedLine(record)));
      if (view.loading)
        node.append(el(doc, 'p', 'cwwp-popover-meta', 'Loading still…'));
      else {
        const still = sameOriginStillUrl(view.stillUrl || record.stillUrl);
        if (still) {
          const image = el(doc, 'img', 'cwwp-popover-still');
          image.alt = record.title || 'Traffic camera still';
          image.referrerPolicy = 'no-referrer';
          image.src = still;
          image.addEventListener('error', () => {
            image.replaceWith(
              el(doc, 'p', 'cwwp-popover-meta', 'Still unavailable.'),
            );
            if (!imageRetried && view.refreshOnError) {
              imageRetried = true;
              handlers.onImageError?.();
            }
          });
          node.append(image);
        } else {
          node.append(el(doc, 'p', 'cwwp-popover-meta', 'No still available.'));
        }
      }
      node.append(
        el(
          doc,
          'p',
          'cwwp-popover-note',
          'Still preview. Caltrans CWWP. This layer does not open live video.',
        ),
      );
      if (view.error)
        node.append(el(doc, 'p', 'cwwp-popover-error', view.error));
      const actions = el(doc, 'div', 'cwwp-popover-actions');
      actions.append(button('refresh', 'Refresh still'));
      node.append(actions);
      node.hidden = false;
      claimCameraCard(this);
      place(view.screen);
    },
    hide() {
      releaseCameraCard(this);
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
