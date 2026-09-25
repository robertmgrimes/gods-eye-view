import * as Cesium from 'cesium';
import { isPointerFree } from '../../data/inputOwnership.js';
import { governorRequestRender } from '../../renderGovernor.js';
import { imageUrlFresh, windyClientMessage } from './model.js';
import { createWindyPopover } from './popover.js';
import { LAYER_ID, NEARBY_RADIUS_KM, REQUEST_DEBOUNCE_MS } from './policy.js';

const PIN = Cesium.Color.fromCssColorString('#3ec6ff');
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

function screenFromClick(viewer, position) {
  const rect = viewer?.scene?.canvas?.getBoundingClientRect?.();
  if (!rect || !position) return { x: 24, y: 24 };
  return { x: rect.left + position.x, y: rect.top + position.y };
}

function screenCenter(viewer) {
  const rect = viewer?.scene?.canvas?.getBoundingClientRect?.();
  if (!rect) return { x: 24, y: 24 };
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

/**
 * Nearby Windy webcam pins, refreshed when the camera settles, plus a click
 * point forecast. Image tokens are loaded only when a preview opens.
 */
export function createWindyWebcamsLayer({ source } = {}) {
  if (
    typeof source?.nearby !== 'function' ||
    typeof source?.detail !== 'function' ||
    typeof source?.forecast !== 'function'
  )
    throw new TypeError(
      'Windy webcams require a nearby, detail, and forecast source',
    );

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
    keyRequired: false,
    blocked: false,
    lastUpdate: null,
    count: 0,
    abort: null,
    debounceTimer: null,
    moveEndRemove: null,
    clickHandler: null,
    controlsListener: null,
    popover: null,
    detailAbort: null,
    forecastAbort: null,
    stillRetried: false,
    lastScreen: null,
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

  function entityId(id) {
    return `windy:${id}`;
  }

  function webcamIdFromEntity(entity) {
    const id = entity?.id;
    return typeof id === 'string' && id.startsWith('windy:')
      ? id.slice(6)
      : null;
  }

  function renderPins() {
    const data = state.dataSource;
    if (!data) return;
    const next = new Set(state.records.map((record) => record.id));
    for (const entity of [...data.entities.values]) {
      const id = webcamIdFromEntity(entity);
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
            pixelSize: 10,
            color: PIN,
            outlineColor: Cesium.Color.WHITE,
            outlineWidth: 2,
            disableDepthTestDistance: Number.POSITIVE_INFINITY,
          },
        });
      } else {
        entity.position = position;
      }
      entity.point.pixelSize = selected ? 14 : 10;
      entity.point.color = selected ? PIN_SELECTED : PIN;
    }
    state.count = data.entities.values.length;
    governorRequestRender('windy-pins');
  }

  function closePopover() {
    state.detailAbort?.abort();
    state.detailAbort = null;
    state.forecastAbort?.abort();
    state.forecastAbort = null;
    state.selectedId = null;
    state.popover?.hide();
    renderPins();
  }

  function showWebcam(
    record,
    screen,
    { loading = false, error = null, preview = null } = {},
  ) {
    state.selectedId = record?.id || null;
    if (screen) state.lastScreen = screen;
    renderPins();
    const fresh = preview && imageUrlFresh(record?.imagesAt) ? preview : null;
    state.popover?.show({
      kind: 'webcam',
      record,
      screen: screen || state.lastScreen,
      loading,
      error,
      preview: fresh,
      refreshOnError: !state.stillRetried,
    });
  }

  async function openWebcam(id, screen, { keepRetry = false } = {}) {
    const known = state.byId.get(id);
    if (!known || !state.enabled) return;
    if (!keepRetry) state.stillRetried = false;
    if (screen) state.lastScreen = screen;
    state.detailAbort?.abort();
    const request = new AbortController();
    state.detailAbort = request;
    showWebcam(known, screen, { loading: true });
    try {
      const payload = await source.detail(id, { signal: request.signal });
      if (request.signal.aborted || !state.enabled || state.selectedId !== id)
        return;
      const webcam = payload?.webcam;
      if (!webcam?.id)
        throw Object.assign(new Error('empty'), { code: 'upstream' });
      const next = { ...known, ...webcam };
      state.byId.set(id, next);
      const index = state.records.findIndex((record) => record.id === id);
      if (index >= 0) state.records[index] = next;
      showWebcam(next, screen, { preview: next.preview || next.thumbnail });
    } catch (error) {
      if (request.signal.aborted || !state.enabled) return;
      showWebcam(known, screen, {
        error: windyClientMessage(error?.code || 'upstream'),
      });
    } finally {
      if (state.detailAbort === request) state.detailAbort = null;
    }
  }

  async function openForecast(point, screen) {
    if (!point || !state.enabled) return;
    state.forecastAbort?.abort();
    const request = new AbortController();
    state.forecastAbort = request;
    state.popover?.show({
      kind: 'forecast',
      point,
      screen,
      loading: true,
    });
    try {
      const summary = await source.forecast({
        lat: point.lat,
        lon: point.lon,
        signal: request.signal,
      });
      if (request.signal.aborted || !state.enabled) return;
      state.popover?.show({
        kind: 'forecast',
        point,
        screen,
        summary,
      });
    } catch (error) {
      if (request.signal.aborted || !state.enabled) return;
      state.popover?.show({
        kind: 'forecast',
        point,
        screen,
        error: windyClientMessage(error?.code || 'upstream'),
      });
    } finally {
      if (state.forecastAbort === request) state.forecastAbort = null;
    }
  }

  function forecastViewCenter() {
    const point = viewCenter(state.viewer);
    if (!point) {
      state.popover?.show({
        kind: 'forecast',
        screen: screenCenter(state.viewer),
        error: 'Aim the globe at the ground to place a forecast.',
      });
      return;
    }
    openForecast(point, screenCenter(state.viewer));
  }

  async function loadNearby() {
    if (!state.enabled || !state.viewer || state.blocked) return;
    clearTimers();
    const center = viewCenter(state.viewer);
    if (!center) {
      state.loading = false;
      setStatus('zoom-in', null);
      return;
    }
    state.abort?.abort();
    const request = new AbortController();
    state.abort = request;
    state.loading = true;
    setStatus('loading', null);
    try {
      const payload = await source.nearby({
        lat: center.lat,
        lon: center.lon,
        radiusKm: NEARBY_RADIUS_KM,
        signal: request.signal,
      });
      if (request.signal.aborted || state.abort !== request || !state.enabled)
        return;
      const records = Array.isArray(payload?.webcams) ? payload.webcams : [];
      state.records = records.filter(
        (record) =>
          record &&
          /^\d{1,12}$/.test(String(record.id || '')) &&
          Number.isFinite(record.latitude) &&
          Number.isFinite(record.longitude),
      );
      state.byId = new Map(state.records.map((record) => [record.id, record]));
      if (state.selectedId && !state.byId.has(state.selectedId)) closePopover();
      state.lastUpdate = Number(payload?.fetchedAt) || Date.now();
      state.stale = payload?.stale === true;
      state.keyRequired = false;
      renderPins();
      setStatus(
        state.records.length ? (state.stale ? 'stale' : 'ready') : 'empty',
        null,
      );
    } catch (error) {
      if (
        error?.name === 'AbortError' ||
        request.signal.aborted ||
        state.abort !== request ||
        !state.enabled
      )
        return;
      if (error.code === 'no_key') {
        state.keyRequired = true;
        state.blocked = true;
        state.records = [];
        state.byId = new Map();
        renderPins();
        setStatus('unavailable', 'KEY REQUIRED');
        return;
      }
      if (error.code === 'unauthorized') {
        state.blocked = true;
        setStatus('unavailable', windyClientMessage('unauthorized'));
        return;
      }
      setStatus('unavailable', windyClientMessage(error.code));
    } finally {
      if (state.abort === request) {
        state.abort = null;
        state.loading = false;
        notify();
      }
    }
  }

  function scheduleLoad() {
    if (!state.enabled || state.blocked) return;
    clearTimers();
    state.debounceTimer = setTimeout(() => {
      state.debounceTimer = null;
      loadNearby();
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
      const id = webcamIdFromEntity(picked?.id);
      const screen = screenFromClick(viewer, click.position);
      if (id && state.byId.has(id)) {
        openWebcam(id, screen);
        return;
      }
      if (picked?.id) return;
      const cartesian = viewer.camera.pickEllipsoid?.(
        click.position,
        viewer.scene.globe?.ellipsoid,
      );
      if (!cartesian) return;
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      openForecast(
        {
          lat: Cesium.Math.toDegrees(cartographic.latitude),
          lon: Cesium.Math.toDegrees(cartographic.longitude),
        },
        screen,
      );
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  const layer = {
    id: LAYER_ID,
    name: 'Windy Webcams',
    icon: '📹',
    source: 'Windy',
    updateInterval: 0,
    statsRefreshInterval: 1000,
    requiresKeyId: 'windy-webcams',
    init(viewer) {
      if (state.viewer)
        throw new Error('Windy webcam layer is already initialized');
      state.viewer = viewer;
      state.dataSource = new Cesium.CustomDataSource(LAYER_ID);
      state.dataSource.show = false;
      viewer.dataSources.add(state.dataSource);
      state.moveEndRemove =
        viewer.camera.moveEnd.addEventListener(scheduleLoad);
      state.popover = createWindyPopover({
        document: viewer.scene.canvas?.ownerDocument,
      });
      state.popover.setHandlers({
        onClose: () => closePopover(),
        onRefresh: () => {
          if (state.selectedId) openWebcam(state.selectedId, state.lastScreen);
        },
        onForecast: () => {
          const record = state.byId.get(state.selectedId);
          if (!record) return;
          openForecast(
            { lat: record.latitude, lon: record.longitude },
            screenCenter(viewer),
          );
        },
        onImageError: () => {
          if (state.stillRetried || !state.selectedId) return;
          state.stillRetried = true;
          openWebcam(state.selectedId, state.lastScreen, { keepRetry: true });
        },
      });
      installClick(viewer);
    },
    enable() {
      if (state.enabled) return;
      state.enabled = true;
      state.blocked = false;
      state.keyRequired = false;
      if (state.dataSource) state.dataSource.show = true;
    },
    disable() {
      state.enabled = false;
      state.blocked = false;
      clearTimers();
      state.abort?.abort();
      state.abort = null;
      state.loading = false;
      closePopover();
      if (state.dataSource) state.dataSource.show = false;
      setStatus('idle', null);
    },
    update() {
      return loadNearby();
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
    setRowControlsListener(listener) {
      state.controlsListener = typeof listener === 'function' ? listener : null;
    },
    getRowControls() {
      return {
        chips: [
          {
            id: 'forecast-view',
            label: 'POINT FORECAST',
            title:
              'Point forecast at the center of the view. Testing/demo data — Windy may modify the numbers.',
            disabled: !state.enabled,
            onClick: () => forecastViewCenter(),
          },
        ],
        info: 'Nearby stills · click the globe for a point forecast',
      };
    },
    getStats() {
      let loadingLabel = '';
      if (state.loading) loadingLabel = 'loading…';
      else if (state.keyRequired) loadingLabel = 'KEY REQUIRED';
      else if (state.status === 'empty') loadingLabel = 'No Windy cams in view';
      else if (state.status === 'zoom-in') loadingLabel = 'Aim at the ground';
      else if (state.error) loadingLabel = state.error;
      else if (state.stale) loadingLabel = 'STALE';
      else if (state.lastUpdate) loadingLabel = `${state.count} nearby`;
      return {
        count: state.count,
        lastUpdate: state.lastUpdate,
        loading: state.loading,
        stale: state.stale,
        status: state.status,
        keyRequired: state.keyRequired,
        error: state.keyRequired ? 'KEY REQUIRED' : state.error,
        loadingLabel,
      };
    },
  };

  return layer;
}
