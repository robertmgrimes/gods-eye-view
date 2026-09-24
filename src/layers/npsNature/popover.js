import { sameOriginStillUrl } from './model.js';
import { CREDIT_NOTE } from './policy.js';

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * Glass card for one curated NPS camera. Stills use the same-origin proxy.
 * A livestream or directory entry is a link, never an embed.
 */
export function createNpsNaturePopover({
  document: doc = globalThis.document,
} = {}) {
  let root = null;
  let handlers = {};
  let imageRetried = false;

  function ensure() {
    if (root || !doc?.body || typeof doc.createElement !== 'function')
      return root;
    root = el(doc, 'section', 'nps-nature-popover');
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.tabIndex = -1;
    doc.body.appendChild(root);
    root.addEventListener('click', (event) => {
      const action =
        event.target?.closest?.('[data-nps-action]')?.dataset?.npsAction;
      if (action === 'close') handlers.onClose?.();
      else if (action === 'refresh') handlers.onRefresh?.();
    });
    return root;
  }

  function button(action, label) {
    const node = el(doc, 'button', 'nps-nature-popover-action', label);
    node.type = 'button';
    node.dataset.npsAction = action;
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
    const row = el(doc, 'div', 'nps-nature-popover-head');
    const heading = el(doc, 'h2', 'nps-nature-popover-title', title);
    heading.id = 'nps-nature-popover-title';
    const close = button('close', 'Close');
    close.className = 'nps-nature-popover-close';
    close.setAttribute('aria-label', 'Close NPS camera');
    row.append(heading, close);
    root.setAttribute('aria-labelledby', 'nps-nature-popover-title');
    return row;
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
      node.setAttribute('aria-label', record.name || 'NPS camera');
      node.append(header(record.name || 'NPS camera'));
      const place = [record.park, record.place].filter(Boolean).join(' · ');
      if (place) node.append(el(doc, 'p', 'nps-nature-popover-meta', place));
      if (record.approximate)
        node.append(
          el(
            doc,
            'p',
            'nps-nature-popover-meta',
            'Approximate location. The NPS page does not publish camera coordinates.',
          ),
        );
      if (record.seasonal)
        node.append(
          el(
            doc,
            'p',
            'nps-nature-popover-meta',
            `Seasonal, roughly ${record.seasonal}.`,
          ),
        );
      const still = sameOriginStillUrl(view.stillUrl || record.stillUrl);
      if (record.kind === 'still' && still) {
        const image = el(doc, 'img', 'nps-nature-popover-still');
        image.alt = record.name || 'NPS camera still';
        image.referrerPolicy = 'no-referrer';
        image.src = still;
        image.addEventListener('error', () => {
          image.replaceWith(
            el(doc, 'p', 'nps-nature-popover-meta', 'Still unavailable.'),
          );
          if (!imageRetried && view.refreshOnError) {
            imageRetried = true;
            handlers.onImageError?.();
          }
        });
        node.append(image);
      } else if (record.kind === 'link') {
        node.append(
          el(
            doc,
            'p',
            'nps-nature-popover-meta',
            record.note || 'Opens the official page. Nothing is embedded.',
          ),
        );
      } else {
        node.append(
          el(doc, 'p', 'nps-nature-popover-meta', 'No still available.'),
        );
      }
      if (record.pageUrl) {
        const open = el(
          doc,
          'a',
          'nps-nature-popover-link',
          'Open the official page',
        );
        open.href = record.pageUrl;
        open.target = '_blank';
        open.rel = 'noopener noreferrer';
        node.append(open);
      }
      node.append(el(doc, 'p', 'nps-nature-popover-note', CREDIT_NOTE));
      if (view.error)
        node.append(el(doc, 'p', 'nps-nature-popover-error', view.error));
      const actions = el(doc, 'div', 'nps-nature-popover-actions');
      if (record.kind === 'still')
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
