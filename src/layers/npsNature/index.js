import * as Cesium from 'cesium';
import { isPointerFree } from '../../data/inputOwnership.js';
import {
  NPS_NATURE_CREDIT,
  registerDynamicCredit,
} from '../../data/dataCredits.js';
import { governorRequestRender } from '../../renderGovernor.js';
import { isCameraId } from './model.js';
import { createNpsNaturePopover } from './popover.js';
import {
  LAYER_ID,
  LAYER_INFO,
  LAYER_SOURCE,
  STILL_REFRESH_MS,
  STILL_WARM_LIMIT,
} from './policy.js';

const PIN = Cesium.Color.fromCssColorString('#d4a017');
const PIN_SELECTED = Cesium.Color.fromCssColorString('#ffe08a');
const PIN_HEIGHT = 80;

function screenFromClick(viewer, position) {
  const rect = viewer?.scene?.canvas?.getBoundingClientRect?.();
  if (!rect || !position) return { x: 24, y: 24 };
  return { x: rect.left + position.x, y: rect.top + position.y };
}

/**
 * Curated NPS and nature pins. Enabling the layer draws the small catalog.
 * A still opens through the same-origin proxy. A livestream or seasonal
 * partnership opens as a link. Visible stills refresh once a minute.
 */
export function createNpsNatureLayer({ source } = {}) {
  if (typeof source?.cameras !== 'function')
    throw new TypeError('NPS nature cameras require a cameras source');

  const state = {
    viewer: null,
    dataSource: null,
    enabled: false,
    records: [],
    byId: new Map(),
    linkOuts: [],
    selectedId: null,
    loading: false,
    error: null,
    status: 'idle',
    lastUpdate: null,
    count: 0,
    abort: null,
    stillTimer: null,
    warming: false,
    warmAgain: false,
    warmRefreshCard: false,
    warmAbort: null,
    clickHandler: null,
    controlsListener: null,
    listeners: new Set(),
    popover: null,
    stillRetried: false,
    lastScreen: null,
  };

  function notify() {
    const snap = snapshot();
    for (const listener of state.listeners) listener(snap);
    state.controlsListener?.();
  }

  function snapshot() {
    return {
      enabled: state.enabled,
      loading: state.loading,
      status: state.status,
      error: state.error,
      linkOuts: state.linkOuts.map((row) => ({ ...row })),
      count: state.count,
    };
  }

  function setStatus(status, error = null) {
    state.status = status;
    state.error = error;
    notify();
  }

  function clearCadence() {
    clearInterval(state.stillTimer);
    state.stillTimer = null;
    state.warmAbort?.abort();
    state.warmAbort = null;
    state.warming = false;
    state.warmAgain = false;
    state.warmRefreshCard = false;
  }

  function warmIds() {
    const ids = [];
    const seen = new Set();
    const selected = state.byId.get(state.selectedId);
    if (selected?.kind === 'still' && selected.stillUrl) {
      ids.push(selected.id);
      seen.add(selected.id);
    }
    for (const record of state.records) {
      if (record.kind !== 'still' || !record.stillUrl || seen.has(record.id))
        continue;
      ids.push(record.id);
      seen.add(record.id);
      if (ids.length >= STILL_WARM_LIMIT) break;
    }
    return ids;
  }

  async function warmVisible({ refreshCard = false } = {}) {
    if (!state.enabled || typeof source.warm !== 'function') return;
    if (state.warming) {
      state.warmAgain = true;
      state.warmRefreshCard = state.warmRefreshCard || refreshCard;
      return;
    }
    state.warming = true;
    state.warmRefreshCard = refreshCard;
    const request = new AbortController();
    state.warmAbort = request;
    try {
      do {
        const refresh = state.warmRefreshCard;
        state.warmAgain = false;
        state.warmRefreshCard = false;
        const selected = state.selectedId;
        await source.warm(warmIds(), { signal: request.signal });
        if (!state.enabled || state.warmAbort !== request) return;
        if (refresh && selected && state.selectedId === selected) {
          const record = state.byId.get(selected);
          if (record?.kind === 'still')
            showCamera(record, state.lastScreen, { refresh: true });
        }
      } while (state.warmAgain && state.enabled && state.warmAbort === request);
    } catch {
      /* a missed still refresh waits for the next minute */
    } finally {
      if (state.warmAbort === request) {
        state.warmAbort = null;
        state.warming = false;
      }
    }
  }

  function startCadence() {
    clearCadence();
    state.stillTimer = setInterval(() => {
      warmVisible({ refreshCard: true });
    }, STILL_REFRESH_MS);
  }

  function entityId(id) {
    return `nps:${id}`;
  }

  function cameraIdFromEntity(entity) {
    const id = entity?.id;
    return typeof id === 'string' && id.startsWith('nps:') ? id.slice(4) : null;
  }

  function renderPins() {
    const data = state.dataSource;
    if (!data) return;
    const pinned = state.records.filter((record) => record.pin);
    const next = new Set(pinned.map((record) => record.id));
    for (const entity of [...data.entities.values]) {
      const id = cameraIdFromEntity(entity);
      if (!next.has(id)) data.entities.remove(entity);
    }
    for (const record of pinned) {
      const id = entityId(record.id);
      const selected = record.id === state.selectedId;
      let entity = data.entities.getById(id);
      const position = Cesium.Cartesian3.fromDegrees(
        record.longitude,
        record.latitude,
        PIN_HEIGHT,
      );
      if (!entity) {
        entity = data.entities.add({
          id,
          position,
          point: {
            pixelSize: 12,
            color: PIN,
            outlineColor: Cesium.Color.BLACK,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      } else {
        entity.position = position;
      }
      entity.point.pixelSize = selected ? 14 : 12;
      entity.point.color = selected ? PIN_SELECTED : PIN;
    }
    state.count = data.entities.values.length;
    governorRequestRender('nps-nature-pins');
  }

  function closePopover() {
    state.selectedId = null;
    state.popover?.hide();
    renderPins();
  }

  function stillSrc(record, { refresh = false } = {}) {
    if (!record?.stillUrl) return null;
    if (!refresh) return record.stillUrl;
    const path = record.stillUrl.split('?')[0];
    return `${path}?t=${Date.now()}`;
  }

  function showCamera(record, screen, { error = null, refresh = false } = {}) {
    state.selectedId = record?.id || null;
    if (screen) state.lastScreen = screen;
    renderPins();
    state.popover?.show({
      record,
      screen: screen || state.lastScreen,
      stillUrl: record?.kind === 'still' ? stillSrc(record, { refresh }) : null,
      error,
      refreshOnError: !state.stillRetried,
    });
  }

  function openCamera(id, screen, { refresh = false } = {}) {
    const known = state.byId.get(id);
    if (!known || !state.enabled) return;
    if (!refresh) state.stillRetried = false;
    showCamera(known, screen, { refresh });
  }

  async function loadCameras() {
    if (!state.enabled) return;
    state.abort?.abort();
    const request = new AbortController();
    state.abort = request;
    state.loading = true;
    setStatus('loading', null);
    try {
      const payload = await source.cameras({ signal: request.signal });
      if (request.signal.aborted || state.abort !== request || !state.enabled)
        return;
      const cameras = Array.isArray(payload?.cameras) ? payload.cameras : [];
      state.records = cameras.filter(
        (record) => record && isCameraId(record.id) && record.pin,
      );
      state.linkOuts = cameras.filter((record) => record?.kind === 'link');
      state.byId = new Map(
        cameras
          .filter((record) => isCameraId(record?.id))
          .map((record) => [record.id, record]),
      );
      if (state.selectedId && !state.byId.has(state.selectedId)) closePopover();
      state.lastUpdate = Number(payload?.fetchedAt) || Date.now();
      renderPins();
      setStatus(state.records.length ? 'ready' : 'empty', null);
      warmVisible();
    } catch (error) {
      if (
        error?.name === 'AbortError' ||
        request.signal.aborted ||
        state.abort !== request ||
        !state.enabled
      )
        return;
      setStatus('unavailable', npsMessage(error));
    } finally {
      if (state.abort === request) {
        state.abort = null;
        state.loading = false;
        notify();
      }
    }
  }

  function npsMessage(error) {
    return error?.message || 'NPS cameras are unavailable';
  }

  function installClick(viewer) {
    if (state.clickHandler) return;
    state.clickHandler = new Cesium.ScreenSpaceEventHandler(
      viewer.scene.canvas,
    );
    state.clickHandler.setInputAction((click) => {
      if (!isPointerFree() || !state.enabled) return;
      const picked = viewer.scene.pick?.(click.position);
      const id = cameraIdFromEntity(picked?.id);
      if (!id || !state.byId.has(id)) return;
      openCamera(id, screenFromClick(viewer, click.position));
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  const layer = {
    id: LAYER_ID,
    name: 'NPS & nature',
    icon: '📷',
    source: LAYER_SOURCE,
    updateInterval: 0,
    statsRefreshInterval: 1000,
    showInTogglePanel: true,
    init(viewer) {
      if (state.viewer)
        throw new Error('NPS nature layer is already initialized');
      state.viewer = viewer;
      state.dataSource = new Cesium.CustomDataSource(LAYER_ID);
      state.dataSource.show = false;
      viewer.dataSources.add(state.dataSource);
      state.popover = createNpsNaturePopover({
        document: viewer.scene.canvas?.ownerDocument,
      });
      state.popover.setHandlers({
        onClose: () => closePopover(),
        onRefresh: () => {
          if (!state.selectedId) return;
          state.stillRetried = false;
          openCamera(state.selectedId, state.lastScreen, { refresh: true });
        },
        onImageError: () => {
          if (state.stillRetried || !state.selectedId) return;
          state.stillRetried = true;
          openCamera(state.selectedId, state.lastScreen, { refresh: true });
        },
      });
      installClick(viewer);
    },
    enable() {
      if (state.enabled) return;
      registerDynamicCredit(state.viewer, NPS_NATURE_CREDIT);
      state.enabled = true;
      if (state.dataSource) state.dataSource.show = true;
      startCadence();
      notify();
    },
    disable() {
      state.enabled = false;
      clearCadence();
      state.abort?.abort();
      state.abort = null;
      state.loading = false;
      closePopover();
      if (state.dataSource) state.dataSource.show = false;
      setStatus('idle', null);
    },
    update() {
      return loadCameras();
    },
    destroy(viewer = state.viewer) {
      this.disable();
      state.clickHandler?.destroy();
      state.clickHandler = null;
      state.popover?.destroy();
      state.popover = null;
      if (state.dataSource && viewer)
        viewer.dataSources.remove(state.dataSource, true);
      state.dataSource = null;
      state.records = [];
      state.linkOuts = [];
      state.byId = new Map();
      state.viewer = null;
      state.lastUpdate = null;
      state.count = 0;
      state.listeners.clear();
    },
    getSnapshot: snapshot,
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      state.listeners.add(listener);
      return () => state.listeners.delete(listener);
    },
    setRowControlsListener(listener) {
      state.controlsListener = typeof listener === 'function' ? listener : null;
    },
    getRowControls() {
      return {
        chips: [],
        info: LAYER_INFO,
      };
    },
    getStats() {
      let loadingLabel = '';
      if (state.loading) loadingLabel = 'loading…';
      else if (state.error) loadingLabel = state.error;
      else if (state.lastUpdate) loadingLabel = `${state.count} cameras`;
      return {
        count: state.count,
        lastUpdate: state.lastUpdate,
        loading: state.loading,
        status: state.status,
        error: state.error,
        loadingLabel,
        source: LAYER_SOURCE,
      };
    },
  };

  return layer;
}
