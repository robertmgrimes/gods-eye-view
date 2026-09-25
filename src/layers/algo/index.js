import * as Cesium from 'cesium';
import { isPointerFree } from '../../data/inputOwnership.js';
import { ALGO_CREDIT, registerDynamicCredit } from '../../data/dataCredits.js';
import { governorRequestRender } from '../../renderGovernor.js';
import { algoCamerasEnabled } from './flag.js';
import {
  algoClientMessage,
  isCameraId,
  parseBBox,
  preferLocalQuery,
} from './model.js';
import { createAlgoPopover } from './popover.js';
import {
  keepSearchHold,
  rememberSearchCamera,
  revealScreen,
} from '../searchHold.js';
import {
  AIM_LABEL,
  EMPTY_IN_VIEW_LABEL,
  EMPTY_OUTSIDE_LABEL,
  LAYER_ID,
  LAYER_INFO,
  LIST_CACHE_TTL_MS,
  REQUEST_DEBOUNCE_MS,
  STILL_REFRESH_MS,
  STILL_WARM_LIMIT,
} from './policy.js';

const PIN = Cesium.Color.fromCssColorString('#c23b4a');
const PIN_SELECTED = Cesium.Color.fromCssColorString('#ffe08a');
const PIN_HEIGHT = 80;

function viewCenter(viewer) {
  const canvas = viewer?.scene?.canvas;
  const camera = viewer?.camera;
  if (!canvas || typeof camera?.pickEllipsoid !== 'function') return null;
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  if (!width || !height) return null;
  const focus = camera.pickEllipsoid(
    new Cesium.Cartesian2(width / 2, height / 2),
    viewer.scene.globe?.ellipsoid,
  );
  if (!focus) return null;
  const cartographic = Cesium.Cartographic.fromCartesian(focus);
  return {
    lat: Cesium.Math.toDegrees(cartographic.latitude),
    lon: Cesium.Math.toDegrees(cartographic.longitude),
  };
}

function viewQuery(viewer) {
  const rectangle = viewer?.camera?.computeViewRectangle?.(
    viewer.scene?.globe?.ellipsoid,
  );
  const box = rectangle
    ? parseBBox({
        west: Cesium.Math.toDegrees(rectangle.west),
        south: Cesium.Math.toDegrees(rectangle.south),
        east: Cesium.Math.toDegrees(rectangle.east),
        north: Cesium.Math.toDegrees(rectangle.north),
      })
    : null;
  return preferLocalQuery(
    box,
    viewCenter(viewer),
    viewer?.camera?.positionCartographic?.height,
  );
}

function screenFromClick(viewer, position) {
  const rect = viewer?.scene?.canvas?.getBoundingClientRect?.();
  if (!rect || !position) return { x: 24, y: 24 };
  return { x: rect.left + position.x, y: rect.top + position.y };
}

/**
 * Alabama ALGO pins for the current view. The layer stays inert unless
 * `GEV_ALGO_CAMERAS` is explicitly on. A click opens the still through the
 * same-origin proxy. Snapshot bytes refresh on the still cadence for the
 * pins currently in view. Live video is not opened.
 */
export function createAlgoWebcamsLayer({
  source,
  isEnabled = algoCamerasEnabled,
} = {}) {
  if (typeof source?.cameras !== 'function')
    throw new TypeError('ALGO webcams require a cameras source');

  const state = {
    viewer: null,
    dataSource: null,
    enabled: false,
    records: [],
    byId: new Map(),
    selectedId: null,
    loading: false,
    error: null,
    status: 'idle',
    stale: false,
    lastUpdate: null,
    count: 0,
    abort: null,
    debounceTimer: null,
    stillTimer: null,
    catalogTimer: null,
    warming: false,
    warmAgain: false,
    warmRefreshCard: false,
    warmAbort: null,
    moveEndRemove: null,
    clickHandler: null,
    controlsListener: null,
    popover: null,
    stillRetried: false,
    lastScreen: null,
    emptyLabel: '',
  };

  function notify() {
    state.controlsListener?.();
  }

  function setStatus(status, error = null) {
    state.status = status;
    state.error = error;
    notify();
  }

  function clearTimers() {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }

  function clearCadence() {
    clearInterval(state.stillTimer);
    clearInterval(state.catalogTimer);
    state.stillTimer = null;
    state.catalogTimer = null;
    state.warmAbort?.abort();
    state.warmAbort = null;
    state.warming = false;
    state.warmAgain = false;
    state.warmRefreshCard = false;
  }

  function warmIds() {
    const center = state.viewer ? viewCenter(state.viewer) : null;
    const ranked = state.records.filter((record) => record.stillUrl);
    if (center) {
      ranked.sort((a, b) => {
        const da =
          (a.latitude - center.lat) ** 2 + (a.longitude - center.lon) ** 2;
        const db =
          (b.latitude - center.lat) ** 2 + (b.longitude - center.lon) ** 2;
        return da - db;
      });
    }
    const ids = [];
    const seen = new Set();
    const selected = state.byId.get(state.selectedId);
    if (selected?.stillUrl) {
      ids.push(selected.id);
      seen.add(selected.id);
    }
    for (const record of ranked) {
      if (seen.has(record.id)) continue;
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
          if (record) showCamera(record, state.lastScreen, { refresh: true });
        }
      } while (state.warmAgain && state.enabled && state.warmAbort === request);
    } catch {
      /* a missed still refresh waits for the next cadence */
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
    state.catalogTimer = setInterval(() => {
      loadCameras();
    }, LIST_CACHE_TTL_MS);
  }

  function entityId(id) {
    return `algo:${id}`;
  }

  function cameraIdFromEntity(entity) {
    const id = entity?.id;
    return typeof id === 'string' && id.startsWith('algo:')
      ? id.slice(5)
      : null;
  }

  function renderPins() {
    const data = state.dataSource;
    if (!data) return;
    const next = new Set(state.records.map((record) => record.id));
    for (const entity of [...data.entities.values]) {
      const id = cameraIdFromEntity(entity);
      if (!next.has(id)) data.entities.remove(entity);
    }
    for (const record of state.records) {
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
    governorRequestRender('algo-pins');
  }

  /** The view box is a rectangle around a trapezoid, so corners can be off-screen. */
  function projectsOnScreen(record) {
    const viewer = state.viewer;
    const canvas = viewer?.scene?.canvas;
    if (!viewer || !canvas) return false;
    let win;
    try {
      win = Cesium.SceneTransforms.worldToWindowCoordinates(
        viewer.scene,
        Cesium.Cartesian3.fromDegrees(
          record.longitude,
          record.latitude,
          PIN_HEIGHT,
        ),
      );
    } catch {
      return false;
    }
    if (!win) return false;
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    if (!width || !height) return false;
    return (
      win.x >= -24 &&
      win.y >= -24 &&
      win.x <= width + 24 &&
      win.y <= height + 24
    );
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
      stillUrl: stillSrc(record, { refresh }),
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
    if (!isEnabled() || !state.enabled || !state.viewer) return;
    clearTimers();
    const query = viewQuery(state.viewer);
    if (!query) {
      state.loading = false;
      state.emptyLabel = AIM_LABEL;
      state.records = [];
      state.byId = new Map();
      renderPins();
      setStatus('zoom-in', null);
      return;
    }
    state.abort?.abort();
    const request = new AbortController();
    state.abort = request;
    state.loading = true;
    setStatus('loading', null);
    try {
      const payload = await source.cameras(query, { signal: request.signal });
      if (request.signal.aborted || state.abort !== request || !state.enabled)
        return;
      const records = Array.isArray(payload?.cameras) ? payload.cameras : [];
      state.records = records.filter(
        (record) =>
          record &&
          isCameraId(record.id) &&
          Number.isFinite(record.latitude) &&
          Number.isFinite(record.longitude) &&
          projectsOnScreen(record),
      );
      state.byId = new Map(state.records.map((record) => [record.id, record]));
      keepSearchHold(state);
      if (state.selectedId && !state.byId.has(state.selectedId)) closePopover();
      state.lastUpdate = Number(payload?.fetchedAt) || Date.now();
      state.stale = payload?.stale === true;
      state.emptyLabel =
        payload?.coverage === 'outside'
          ? EMPTY_OUTSIDE_LABEL
          : EMPTY_IN_VIEW_LABEL;
      renderPins();
      setStatus(
        state.records.length ? (state.stale ? 'stale' : 'ready') : 'empty',
        null,
      );
      warmVisible();
    } catch (error) {
      if (
        error?.name === 'AbortError' ||
        request.signal.aborted ||
        state.abort !== request ||
        !state.enabled
      )
        return;
      setStatus('unavailable', algoClientMessage(error.code));
    } finally {
      if (state.abort === request) {
        state.abort = null;
        state.loading = false;
        notify();
      }
    }
  }

  function scheduleLoad() {
    if (!state.enabled) return;
    clearTimers();
    state.debounceTimer = setTimeout(() => {
      state.debounceTimer = null;
      loadCameras();
    }, REQUEST_DEBOUNCE_MS);
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
    name: 'ALGO (experimental)',
    icon: '📷',
    source: 'ALGO Traffic',
    updateInterval: 0,
    statsRefreshInterval: 1000,
    get showInTogglePanel() {
      return isEnabled();
    },
    init(viewer) {
      if (state.viewer)
        throw new Error('ALGO webcam layer is already initialized');
      state.viewer = viewer;
      state.dataSource = new Cesium.CustomDataSource(LAYER_ID);
      state.dataSource.show = false;
      viewer.dataSources.add(state.dataSource);
      state.moveEndRemove =
        viewer.camera.moveEnd.addEventListener(scheduleLoad);
      state.popover = createAlgoPopover({
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
      if (!isEnabled()) return false;
      if (state.enabled) return;
      registerDynamicCredit(state.viewer, ALGO_CREDIT);
      state.enabled = true;
      if (state.dataSource) state.dataSource.show = true;
      startCadence();
    },
    disable() {
      state.enabled = false;
      clearTimers();
      clearCadence();
      state.abort?.abort();
      state.abort = null;
      state.loading = false;
      closePopover();
      if (state.dataSource) state.dataSource.show = false;
      setStatus('idle', null);
    },
    update() {
      if (!isEnabled()) return false;
      return loadCameras();
    },
    destroy(viewer = state.viewer) {
      this.disable();
      state.moveEndRemove?.();
      state.moveEndRemove = null;
      state.clickHandler?.destroy();
      state.clickHandler = null;
      state.popover?.destroy();
      state.popover = null;
      if (state.dataSource && viewer)
        viewer.dataSources.remove(state.dataSource, true);
      state.dataSource = null;
      state.records = [];
      state.byId = new Map();
      state.viewer = null;
      state.lastUpdate = null;
      state.count = 0;
    },
    revealSearchCamera(record) {
      if (
        !state.enabled ||
        !isEnabled() ||
        !rememberSearchCamera(state, record)
      )
        return false;
      renderPins();
      openCamera(record.id, revealScreen(state.viewer));
      return true;
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
      else if (state.status === 'empty') loadingLabel = state.emptyLabel;
      else if (state.status === 'zoom-in') loadingLabel = AIM_LABEL;
      else if (state.error) loadingLabel = state.error;
      else if (state.stale) loadingLabel = 'STALE';
      else if (state.lastUpdate) loadingLabel = `${state.count} in view`;
      return {
        count: state.count,
        lastUpdate: state.lastUpdate,
        loading: state.loading,
        stale: state.stale,
        status: state.status,
        error: state.error,
        loadingLabel,
      };
    },
  };

  return layer;
}
