import { publicWebcam } from '../layers/webcamExplore/model.js';
import {
  CATEGORY_CHIPS,
  DISCOVERY_NOTE,
} from '../layers/webcamExplore/policy.js';

/**
 * Search cards for Webcam Explore. Mounts under the Cameras row. Each card
 * links to the public page. Thumbnails are previews only.
 */
export function createWebcamExplorePanel({ container, layer } = {}) {
  const document = container?.ownerDocument;
  if (!document?.createElement || typeof layer?.subscribe !== 'function')
    return null;

  const listeners = new AbortController();
  const signal = listeners.signal;
  const root = document.createElement('div');
  root.className = 'webcam-explore';

  const note = document.createElement('p');
  note.className = 'webcam-explore-note';
  note.textContent = DISCOVERY_NOTE;

  const form = document.createElement('form');
  form.className = 'webcam-explore-form';
  const query = document.createElement('input');
  query.className = 'webcam-explore-query';
  query.type = 'search';
  query.name = 'q';
  query.maxLength = 120;
  query.placeholder = 'Search place or title';
  query.setAttribute('aria-label', 'Search Webcam Explore');
  query.autocomplete = 'off';
  const submit = document.createElement('button');
  submit.className = 'webcam-explore-submit';
  submit.type = 'submit';
  submit.textContent = 'Search';
  form.append(query, submit);

  const modes = document.createElement('div');
  modes.className = 'webcam-explore-modes';
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'Browse Webcam Explore');
  for (const [id, label, method] of [
    ['trending', 'Trending', 'trending'],
    ['popular', 'Popular', 'popular'],
  ]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'webcam-explore-mode';
    button.dataset.mode = id;
    button.textContent = label;
    button.addEventListener(
      'click',
      () => {
        layer[method]?.();
      },
      { signal },
    );
    modes.append(button);
  }

  const categories = document.createElement('div');
  categories.className = 'webcam-explore-modes';
  categories.setAttribute('role', 'group');
  categories.setAttribute('aria-label', 'Webcam Explore categories');
  for (const chip of CATEGORY_CHIPS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'webcam-explore-mode';
    button.dataset.category = chip.id;
    button.textContent = chip.label;
    button.addEventListener('click', () => layer.category?.(chip.id), {
      signal,
    });
    categories.append(button);
  }

  const status = document.createElement('p');
  status.className = 'webcam-explore-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const results = document.createElement('div');
  results.className = 'webcam-explore-results';

  root.append(note, form, modes, categories, status, results);
  container.append(root);

  form.addEventListener(
    'submit',
    (event) => {
      event.preventDefault();
      layer.search?.(query.value);
    },
    { signal },
  );

  let signature = '';

  function card(webcam) {
    const safe = publicWebcam(webcam);
    if (!safe) return null;
    const article = document.createElement('article');
    article.className = 'webcam-explore-card';
    article.dataset.webcamId = safe.id;
    if (safe.thumbnail_url) {
      const image = document.createElement('img');
      image.className = 'webcam-explore-thumb';
      image.alt = '';
      image.referrerPolicy = 'no-referrer';
      image.src = safe.thumbnail_url;
      image.addEventListener(
        'error',
        () => {
          const empty = placeholder(document);
          image.parent?.insertBefore(empty, image);
          image.remove();
        },
        { signal },
      );
      article.append(image);
    } else {
      article.append(placeholder(document));
    }
    const title = document.createElement('h4');
    title.className = 'webcam-explore-title';
    title.textContent = safe.title;
    const meta = document.createElement('p');
    meta.className = 'webcam-explore-meta';
    meta.textContent = [safe.location, safe.category]
      .filter(Boolean)
      .join(' · ');
    const live = document.createElement('p');
    live.className = safe.is_live
      ? 'webcam-explore-live is-live'
      : 'webcam-explore-live';
    live.textContent = safe.is_live ? 'LIVE' : 'OFFLINE';
    const open = document.createElement('a');
    open.className = 'webcam-explore-open';
    open.href = safe.page_url;
    open.target = '_blank';
    open.rel = 'noopener noreferrer';
    open.textContent = 'Open on Webcam Explore';
    open.setAttribute('aria-label', `Open ${safe.title} on Webcam Explore`);
    article.append(title, meta, live, open);
    return article;
  }

  function paintChoices(ambiguous) {
    const block = document.createElement('div');
    block.className = 'webcam-explore-choices';
    const prompt = document.createElement('p');
    prompt.textContent = ambiguous.note || '';
    block.append(prompt);
    for (const choice of ambiguous.choices || []) {
      if (!choice?.query || !choice.label) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'webcam-explore-choice';
      button.dataset.choice = choice.id || choice.query;
      button.textContent = choice.label;
      button.addEventListener(
        'click',
        () => {
          query.value = choice.query;
          layer.search?.(choice.query);
        },
        { signal },
      );
      block.append(button);
    }
    return block;
  }

  function paint(snap) {
    root.hidden = snap?.enabled !== true;
    const message = snap?.message || '';
    if (status.textContent !== message) status.textContent = message;
    for (const button of modes.children) {
      const pressed = snap?.mode === button.dataset.mode;
      if (button.getAttribute('aria-pressed') !== String(pressed))
        button.setAttribute('aria-pressed', String(pressed));
    }
    for (const button of categories.children) {
      const pressed = snap?.mode === `category:${button.dataset.category}`;
      if (button.getAttribute('aria-pressed') !== String(pressed))
        button.setAttribute('aria-pressed', String(pressed));
    }
    const nextSignature = JSON.stringify({
      ambiguous: snap?.ambiguous || null,
      webcams: (snap?.webcams || []).map((webcam) => publicWebcam(webcam)),
    });
    if (nextSignature === signature) return;
    signature = nextSignature;
    for (const child of [...results.children]) child.remove();
    if (snap?.ambiguous?.choices?.length) {
      results.append(paintChoices(snap.ambiguous));
      return;
    }
    for (const webcam of snap?.webcams || []) {
      const node = card(webcam);
      if (node) results.append(node);
    }
    if (results.children.length && typeof results.scrollIntoView === 'function')
      results.scrollIntoView({ block: 'nearest' });
  }

  const unsubscribe = layer.subscribe(paint);
  paint(layer.getSnapshot?.() || { enabled: false });

  return {
    root,
    destroy() {
      unsubscribe?.();
      listeners.abort();
      root.remove();
    },
  };
}

function placeholder(document) {
  const node = document.createElement('div');
  node.className = 'webcam-explore-thumb webcam-explore-thumb-empty';
  node.textContent = 'No preview';
  return node;
}
