import {
  WINDY_TESTING_DISCLAIMER,
  formatForecastTime,
  formatPrecip,
  formatPressure,
  formatTempC,
  formatWind,
} from './model.js';

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** The Windy card is the only place this link belongs. */
function windyPage(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    const host = new URL(url).hostname;
    return host === 'windy.com' || host.endsWith('.windy.com');
  } catch {
    return false;
  }
}

/**
 * One glass card for a webcam still or a point forecast. API text is assigned
 * with textContent. Image addresses are HTTPS stills the proxy already checked.
 */
export function createWindyPopover({
  document: doc = globalThis.document,
} = {}) {
  let root = null;
  let handlers = {};
  let imageRetried = false;

  function ensure() {
    if (root || !doc?.body || typeof doc.createElement !== 'function')
      return root;
    root = el(doc, 'section', 'windy-popover');
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.tabIndex = -1;
    doc.body.appendChild(root);
    root.addEventListener('click', (event) => {
      const action = event.target?.closest?.('[data-windy-action]')?.dataset
        ?.windyAction;
      if (action === 'close') handlers.onClose?.();
      else if (action === 'refresh') handlers.onRefresh?.();
      else if (action === 'forecast') handlers.onForecast?.();
    });
    return root;
  }

  function button(action, label) {
    const node = el(doc, 'button', 'windy-popover-action', label);
    node.type = 'button';
    node.dataset.windyAction = action;
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

  function renderWebcam(view) {
    const record = view.record || {};
    root.setAttribute('aria-label', record.title || 'Windy webcam');
    root.append(
      header(record.title || 'Windy webcam', 'Windy webcam'),
      el(
        doc,
        'p',
        'windy-popover-meta',
        [record.city, record.region, record.country]
          .filter(Boolean)
          .join(' · ') || 'Location unavailable',
      ),
    );
    if (record.status)
      root.append(
        el(doc, 'p', 'windy-popover-meta', `Status ${record.status}`),
      );
    if (view.loading)
      root.append(el(doc, 'p', 'windy-popover-meta', 'Refreshing still…'));
    else if (view.preview) {
      const image = el(doc, 'img', 'windy-popover-still');
      image.alt = record.title || 'Webcam still';
      image.referrerPolicy = 'no-referrer';
      image.src = view.preview;
      image.addEventListener('error', () => {
        image.replaceWith(
          el(
            doc,
            'p',
            'windy-popover-meta',
            'Still expired. Refresh to load a new one.',
          ),
        );
        if (!imageRetried && view.refreshOnError) {
          imageRetried = true;
          handlers.onImageError?.();
        }
      });
      root.append(image);
    } else if (!view.loading) {
      root.append(el(doc, 'p', 'windy-popover-meta', 'No still available.'));
    }
    root.append(
      el(
        doc,
        'p',
        'windy-popover-note',
        'Still preview. This feed does not include live video.',
      ),
    );
    if (view.error)
      root.append(el(doc, 'p', 'windy-popover-error', view.error));
    const actions = el(doc, 'div', 'windy-popover-actions');
    actions.append(
      button('refresh', 'Refresh still'),
      button('forecast', 'Point forecast'),
    );
    root.append(actions);
    if (windyPage(record.detailUrl)) {
      const link = el(doc, 'a', 'windy-popover-link', 'Open on Windy');
      link.href = record.detailUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      root.append(link);
    }
  }

  function header(title, label) {
    const row = el(doc, 'div', 'windy-popover-head');
    const heading = el(doc, 'h2', 'windy-popover-title', title);
    heading.id = 'windy-popover-title';
    const close = button('close', 'Close');
    close.className = 'windy-popover-close';
    close.setAttribute('aria-label', `Close ${label}`);
    row.append(heading, close);
    root.setAttribute('aria-labelledby', 'windy-popover-title');
    return row;
  }

  function renderForecast(view) {
    root.setAttribute('aria-label', 'Windy point forecast');
    root.append(header('Point forecast', 'point forecast'));
    const banner = el(doc, 'p', 'windy-testing', WINDY_TESTING_DISCLAIMER);
    root.append(banner);
    const where = view.point
      ? `${Number(view.point.lat).toFixed(2)}, ${Number(view.point.lon).toFixed(2)} · GFS`
      : 'GFS';
    root.append(el(doc, 'p', 'windy-popover-meta', where));
    if (view.loading) {
      root.append(el(doc, 'p', 'windy-popover-meta', 'Loading forecast…'));
      return;
    }
    if (view.error) {
      root.append(el(doc, 'p', 'windy-popover-error', view.error));
      return;
    }
    const summary = view.summary;
    const first = summary?.steps?.[0];
    if (!first) {
      root.append(
        el(
          doc,
          'p',
          'windy-popover-meta',
          'No forecast values for this point.',
        ),
      );
      return;
    }
    root.append(
      el(doc, 'p', 'windy-popover-temp', formatTempC(first.tempC)),
      el(doc, 'p', 'windy-popover-wind', formatWind(first)),
      el(
        doc,
        'p',
        'windy-popover-meta',
        `${formatForecastTime(first.time)} · ${formatPressure(first.pressureHpa)} · precip ${formatPrecip(first.precipMm)}`,
      ),
    );
    const list = el(doc, 'ol', 'windy-popover-steps');
    for (const step of summary.steps.slice(1, 5)) {
      list.append(
        el(
          doc,
          'li',
          '',
          `${formatForecastTime(step.time)} · ${formatTempC(step.tempC)} · ${formatWind(step)}`,
        ),
      );
    }
    if (list.childNodes.length) root.append(list);
  }

  return {
    setHandlers(next) {
      handlers = next || {};
    },
    show(view) {
      const node = ensure();
      if (!node) return;
      imageRetried = false;
      node.replaceChildren();
      if (view?.kind === 'forecast') renderForecast(view);
      else renderWebcam(view || {});
      node.hidden = false;
      place(view?.screen);
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
