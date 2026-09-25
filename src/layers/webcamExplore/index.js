import {
  WEBCAM_EXPLORE_CREDIT,
  registerDynamicCredit,
} from '../../data/dataCredits.js';
import { ambiguousGeorgia, clientMessage, publicWebcam } from './model.js';
import {
  DEFAULT_LIMIT,
  DISCOVERY_NOTE,
  EMPTY_MESSAGE,
  IDLE_MESSAGE,
  LAYER_ID,
  LAYER_SOURCE,
} from './policy.js';

/**
 * Webcam Explore discovery. Enabling the layer opens search in the Cameras
 * section. It does not create globe pins and it does not request a stream.
 */
export function createWebcamExploreLayer({ source } = {}) {
  if (typeof source?.search !== 'function')
    throw new TypeError('Webcam Explore requires a search source');

  const listeners = new Set();
  const state = {
    viewer: null,
    enabled: false,
    loading: false,
    status: 'idle',
    message: IDLE_MESSAGE,
    error: null,
    ambiguous: null,
    webcams: [],
    mode: null,
    stale: false,
    lastUpdate: null,
    abort: null,
    request: 0,
    controlsListener: null,
  };

  function notify() {
    const snap = snapshot();
    for (const listener of listeners) listener(snap);
    state.controlsListener?.();
  }

  function snapshot() {
    return {
      enabled: state.enabled,
      loading: state.loading,
      status: state.status,
      message: state.message,
      error: state.error,
      ambiguous: state.ambiguous,
      webcams: state.webcams.map((webcam) => ({ ...webcam })),
      mode: state.mode,
      stale: state.stale,
      note: DISCOVERY_NOTE,
    };
  }

  function applyWebcams(payload, mode) {
    const webcams = (Array.isArray(payload?.webcams) ? payload.webcams : [])
      .map((row) => publicWebcam(row))
      .filter(Boolean)
      .slice(0, DEFAULT_LIMIT);
    state.webcams = webcams;
    state.mode = mode;
    state.ambiguous = null;
    state.stale = payload?.stale === true;
    state.lastUpdate = Date.now();
    state.loading = false;
    state.error = null;
    if (webcams.length) {
      state.status = 'ready';
      state.message = state.stale
        ? `${webcams.length} shown from cache`
        : `${webcams.length} found`;
    } else {
      state.status = 'empty';
      state.message = EMPTY_MESSAGE;
    }
    notify();
  }

  function fail(error) {
    if (error?.name === 'AbortError') return;
    if (error?.code === 'ambiguous_location') {
      state.ambiguous = {
        note: error.note || clientMessage('ambiguous_location'),
        choices: Array.isArray(error.choices) ? error.choices : [],
      };
      state.webcams = [];
      state.loading = false;
      state.error = null;
      state.status = 'idle';
      state.message = state.ambiguous.note;
      notify();
      return;
    }
    state.loading = false;
    state.status = 'error';
    state.error = clientMessage(error?.code);
    state.message = state.error;
    state.ambiguous = null;
    notify();
  }

  async function run(mode, { query = '', load }) {
    if (!state.enabled) return;
    const ambiguous = mode === 'search' ? ambiguousGeorgia(query) : null;
    if (ambiguous) {
      state.abort?.abort();
      state.abort = null;
      state.loading = false;
      state.webcams = [];
      state.mode = 'search';
      state.error = null;
      state.status = 'idle';
      state.ambiguous = ambiguous;
      state.message = ambiguous.note;
      notify();
      return;
    }
    const request = ++state.request;
    state.abort?.abort();
    const controller = new AbortController();
    state.abort = controller;
    state.loading = true;
    state.status = 'idle';
    state.error = null;
    state.ambiguous = null;
    state.message = 'Searching…';
    state.mode = mode;
    notify();
    try {
      const payload = await load(controller.signal);
      if (!state.enabled || state.request !== request) return;
      applyWebcams(payload, mode);
    } catch (error) {
      if (!state.enabled || state.request !== request) return;
      fail(error);
    }
  }

  const layer = {
    id: LAYER_ID,
    name: 'Webcam Explore',
    icon: '◎',
    source: LAYER_SOURCE,
    updateInterval: 0,
    statsRefreshInterval: 1000,
    showInTogglePanel: true,
    init(viewer) {
      if (state.viewer)
        throw new Error('Webcam Explore layer is already initialized');
      state.viewer = viewer;
    },
    enable(viewer) {
      if (state.enabled) return;
      state.viewer = viewer || state.viewer;
      state.enabled = true;
      registerDynamicCredit(state.viewer, WEBCAM_EXPLORE_CREDIT);
      notify();
    },
    disable() {
      state.enabled = false;
      state.abort?.abort();
      state.abort = null;
      state.loading = false;
      if (state.status !== 'error') state.message = IDLE_MESSAGE;
      notify();
    },
    update() {
      // Discovery fetches only when the operator searches. A false return
      // would reject enablement in the layer lifecycle.
    },
    destroy() {
      this.disable();
      state.webcams = [];
      state.viewer = null;
      state.lastUpdate = null;
      listeners.clear();
    },
    search(query) {
      const text = String(query ?? '').trim();
      if (!text) return;
      return run('search', {
        query: text,
        load: (signal) =>
          source.search({ query: text, limit: DEFAULT_LIMIT, signal }),
      });
    },
    trending() {
      return run('trending', {
        load: (signal) => source.trending({ limit: DEFAULT_LIMIT, signal }),
      });
    },
    popular() {
      return run('popular', {
        load: (signal) => source.popular({ limit: DEFAULT_LIMIT, signal }),
      });
    },
    category(slug) {
      const category = String(slug ?? '')
        .trim()
        .toLowerCase();
      if (!category) return;
      return run(`category:${category}`, {
        load: (signal) =>
          source.byCategory({ category, limit: DEFAULT_LIMIT, signal }),
      });
    },
    getSnapshot: snapshot,
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setRowControlsListener(listener) {
      state.controlsListener = typeof listener === 'function' ? listener : null;
    },
    getRowControls() {
      return { chips: [] };
    },
    getStats() {
      return {
        count: state.webcams.length,
        lastUpdate: state.lastUpdate,
        loading: state.loading,
        stale: state.stale,
        status: state.webcams.length ? 'ready' : state.status,
        error: state.error,
        statusMessage: state.enabled ? state.message : '',
        loadingLabel: state.loading
          ? 'searching…'
          : state.webcams.length
            ? `${state.webcams.length} found`
            : state.enabled
              ? state.message
              : '',
        source: LAYER_SOURCE,
      };
    },
  };

  return layer;
}
