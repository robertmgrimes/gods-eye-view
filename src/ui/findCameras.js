import * as Cesium from 'cesium';
import { isPointerFree } from '../data/inputOwnership.js';
import {
  createCameraSearchRegistry,
  resolveCameraPlace,
} from '../search/cameras/index.js';

/** Typing waits a second so place search stays inside the Nominatim budget. */
export const FIND_CAMERAS_DEBOUNCE_MS = 1000;

const LAYER_BY_SOURCE = Object.freeze({
  windy: 'windy-webcams',
  kytc: 'ky-kytc-webcams',
  cwwp: 'ca-cwwp-webcams',
  algo: 'al-algo-webcams',
  nps: 'nps-nature-cameras',
});

function formatDistance(km) {
  if (!Number.isFinite(km)) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

function statusLabel(status) {
  if (status === 'ok') return 'ok';
  if (status === 'no results') return 'none';
  if (status === 'timed out') return 'timeout';
  if (status === 'error') return 'error';
  if (status === 'disabled') return 'off';
  if (status === 'loading') return '…';
  return status || '';
}

/**
 * Find cameras. Mounted at the top of the Cameras group, which is where the
 * other camera controls live, and it stays available without turning a layer on.
 */
export function createFindCamerasPanel({
  container,
  viewer,
  dataManager,
  placeSearch,
  registry = createCameraSearchRegistry(),
  openPage = (url) => window.open(url, '_blank', 'noopener,noreferrer'),
} = {}) {
  const doc = container?.ownerDocument;
  if (!doc?.createElement) return null;

  const listeners = new AbortController();
  const signal = listeners.signal;
  let searchAbort = null;
  let debounceTimer = null;
  let pickHandler = null;
  let picking = false;

  const root = doc.createElement('section');
  root.className = 'find-cameras';
  root.setAttribute('aria-label', 'Find cameras');

  const form = doc.createElement('form');
  form.className = 'find-cameras-form';
  const query = doc.createElement('input');
  query.className = 'find-cameras-query';
  query.type = 'search';
  query.name = 'q';
  query.maxLength = 200;
  query.placeholder = 'City, park, address, landmark';
  query.setAttribute('aria-label', 'Find cameras');
  query.autocomplete = 'off';
  const submit = doc.createElement('button');
  submit.className = 'find-cameras-submit';
  submit.type = 'submit';
  submit.textContent = 'Find';
  const pick = doc.createElement('button');
  pick.className = 'find-cameras-pick';
  pick.type = 'button';
  pick.textContent = 'Search here';
  pick.title = 'Click the globe to search for cameras at that point';
  pick.setAttribute('aria-pressed', 'false');
  form.append(query, submit, pick);

  const status = doc.createElement('p');
  status.className = 'find-cameras-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');

  const sources = doc.createElement('p');
  sources.className = 'find-cameras-sources';

  const nearHeading = doc.createElement('h4');
  nearHeading.className = 'find-cameras-heading';
  nearHeading.textContent = 'Nearest';
  const nearList = doc.createElement('div');
  nearList.className = 'find-cameras-list';

  const nameHeading = doc.createElement('h4');
  nameHeading.className = 'find-cameras-heading';
  nameHeading.textContent = 'By name';
  const nameList = doc.createElement('div');
  nameList.className = 'find-cameras-list';

  root.append(
    form,
    status,
    sources,
    nearHeading,
    nearList,
    nameHeading,
    nameList,
  );
  container.append(root);
  paint({ near: [], byName: [], statuses: [] }, { message: '' });

  function paint(result, { message = '' } = {}) {
    status.textContent = message;
    sources.textContent = (result.statuses || [])
      .map((row) => `${row.badge || row.label} ${statusLabel(row.status)}`)
      .join(' · ');
    fillList(nearList, result.near || [], true);
    fillList(nameList, result.byName || [], false);
    const hasNear = (result.near || []).length > 0;
    const hasName = (result.byName || []).length > 0;
    nearHeading.hidden = !hasNear;
    nearList.hidden = !hasNear;
    nameHeading.hidden = !hasName;
    nameList.hidden = !hasName;
  }

  function fillList(list, hits, withDistance) {
    list.replaceChildren();
    for (const hit of hits) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.className = 'find-cameras-row';
      button.dataset.source = hit.source || '';
      button.dataset.cameraId = hit.id || '';
      if (hit.stillUrl) {
        const image = doc.createElement('img');
        image.className = 'find-cameras-thumb';
        image.alt = '';
        image.referrerPolicy = 'no-referrer';
        image.src = hit.stillUrl;
        image.addEventListener('error', () => image.remove(), { signal });
        button.append(image);
      }
      const body = doc.createElement('span');
      body.className = 'find-cameras-row-body';
      const badge = doc.createElement('span');
      badge.className = 'find-cameras-badge';
      const adapter = registry.adapters.find(
        (entry) => entry.id === hit.source,
      );
      badge.textContent = adapter?.badge || hit.source || '';
      const name = doc.createElement('span');
      name.className = 'find-cameras-name';
      name.textContent = hit.name || 'Camera';
      body.append(badge, name);
      if (withDistance) {
        const distance = doc.createElement('span');
        distance.className = 'find-cameras-distance';
        distance.textContent = formatDistance(hit.distanceKm);
        body.append(distance);
      }
      button.append(body);
      button.addEventListener('click', () => openHit(hit), { signal });
      list.append(button);
    }
  }

  async function openHit(hit) {
    if (hit?.source === 'webcam-explore') {
      if (hit.pageUrl) openPage(hit.pageUrl);
      return;
    }
    const layerId = LAYER_BY_SOURCE[hit?.source];
    const layer = dataManager?.layers?.get(layerId)?.module;
    if (!layerId || !layer?.revealSearchCamera) return;
    try {
      await dataManager.setEnabled(layerId, true, { origin: 'user' });
    } catch {
      /* the still can still open if the layer was already up */
    }
    if (
      viewer?.camera?.flyTo &&
      Number.isFinite(hit.lat) &&
      Number.isFinite(hit.lon)
    ) {
      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(hit.lon, hit.lat, 3500),
        duration: 1.4,
      });
    }
    const record = hit.record || {
      id: hit.id,
      title: hit.name,
      name: hit.name,
      latitude: hit.lat,
      longitude: hit.lon,
      stillUrl: hit.stillUrl || null,
      pageUrl: hit.pageUrl || '',
      kind: hit.stillUrl ? 'still' : 'link',
      pin: true,
    };
    layer.revealSearchCamera(record);
  }

  function disarmPick() {
    picking = false;
    pick.setAttribute('aria-pressed', 'false');
    pickHandler?.destroy();
    pickHandler = null;
  }

  function armPick() {
    const canvas = viewer?.scene?.canvas;
    if (!canvas || typeof Cesium.ScreenSpaceEventHandler !== 'function') return;
    disarmPick();
    picking = true;
    pick.setAttribute('aria-pressed', 'true');
    status.textContent = 'Click the globe';
    pickHandler = new Cesium.ScreenSpaceEventHandler(canvas);
    pickHandler.setInputAction((click) => {
      if (!isPointerFree()) return;
      const ellipsoid = viewer.scene?.globe?.ellipsoid;
      const cartesian = viewer.camera?.pickEllipsoid?.(
        click.position,
        ellipsoid,
      );
      if (!cartesian) return;
      const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
      const lat = Cesium.Math.toDegrees(cartographic.latitude);
      const lon = Cesium.Math.toDegrees(cartographic.longitude);
      disarmPick();
      runSearch({ lat, lon, label: 'Dropped point' });
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  async function runSearch({ lat, lon, label, text }) {
    searchAbort?.abort();
    const controller = new AbortController();
    searchAbort = controller;
    paint(
      { near: [], byName: [], statuses: [] },
      { message: label ? `Searching ${label}` : 'Searching…' },
    );
    try {
      const result = await registry.search({
        lat,
        lon,
        query: text || '',
        signal: controller.signal,
        onUpdate: (partial) => {
          if (searchAbort !== controller) return;
          paint(partial, {
            message: label ? `Searching ${label}` : 'Searching…',
          });
        },
      });
      if (searchAbort !== controller) return;
      const count = result.near.length + result.byName.length;
      paint(result, {
        message: count
          ? `${count} cameras`
          : `No cameras near ${label || 'that search'}`,
      });
    } catch (error) {
      if (error?.name === 'AbortError' || searchAbort !== controller) return;
      paint(
        { near: [], byName: [], statuses: [] },
        { message: 'Camera search failed' },
      );
    }
  }

  async function searchText(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return;
    status.textContent = 'Finding that place…';
    let place = null;
    try {
      place = await resolveCameraPlace(trimmed, {
        placeSearch,
        signal: searchAbort?.signal,
      });
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
    if (!place) {
      await runSearch({ text: trimmed, label: trimmed });
      return;
    }
    await runSearch({
      lat: place.lat,
      lon: place.lon,
      label: place.label || trimmed,
      text: trimmed,
    });
  }

  form.addEventListener(
    'submit',
    (event) => {
      event.preventDefault();
      clearTimeout(debounceTimer);
      searchText(query.value);
    },
    { signal },
  );
  query.addEventListener(
    'input',
    () => {
      clearTimeout(debounceTimer);
      const text = query.value.trim();
      if (text.length < 2) return;
      debounceTimer = setTimeout(
        () => searchText(text),
        FIND_CAMERAS_DEBOUNCE_MS,
      );
    },
    { signal },
  );
  pick.addEventListener(
    'click',
    () => {
      if (picking) disarmPick();
      else armPick();
    },
    { signal },
  );

  return {
    destroy() {
      clearTimeout(debounceTimer);
      searchAbort?.abort();
      disarmPick();
      listeners.abort();
      root.remove();
    },
  };
}
