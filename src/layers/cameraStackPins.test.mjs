import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as Cesium from 'cesium';
import {
  ShareLinkManager,
  cameraDestinationForTarget,
  panelStateForRestoredLayers,
} from '../sharelink.js';
import { createWindyWebcamsLayer } from './windy/index.js';
import { createKytcWebcamsLayer } from './kytc/index.js';
import { createCwwpWebcamsLayer } from './cwwp/index.js';
import { createAlgoWebcamsLayer } from './algo/index.js';
import { createNpsNatureLayer } from './npsNature/index.js';
import { createWebcamExploreLayer } from './webcamExplore/index.js';

const HOME = { lat: 35.0914, lon: -82.5 };
const LOUISVILLE = { lat: 38.25, lon: -85.76 };

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function viewerAt(place) {
  const canvas = {
    clientWidth: 800,
    clientHeight: 600,
    width: 800,
    height: 600,
    disableRootEvents: true,
    onwheel: null,
    addEventListener() {},
    removeEventListener() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 800, height: 600 };
    },
  };
  const pose = {
    destination: Cesium.Cartesian3.fromDegrees(place.lon, place.lat, 40000),
    heading: 0,
    pitch: Cesium.Math.toRadians(-90),
  };
  const camera = {
    changed: new Cesium.Event(),
    moveEnd: new Cesium.Event(),
    positionCartographic: { height: 40000 },
    pickEllipsoid() {
      const ground = groundUnderPose(pose.destination, pose.heading, pose.pitch);
      return ground
        ? Cesium.Cartesian3.fromDegrees(ground.lon, ground.lat)
        : null;
    },
    flyTo(options) {
      rememberPose(pose, options);
      options?.complete?.();
    },
    setView(options) {
      rememberPose(pose, options);
    },
  };
  return {
    camera,
    scene: {
      canvas,
      requestRender() {},
      frameState: { camera: { frustum: {} } },
      postRender: new Cesium.Event(),
    },
    dataSources: { add() {}, remove() {} },
  };
}

function cameraRecord(id, place) {
  return {
    id,
    latitude: place.lat,
    longitude: place.lon,
    title: id,
    pin: true,
    kind: 'still',
    name: id,
  };
}

function rememberPose(pose, options) {
  if (options?.destination) pose.destination = options.destination;
  if (Number.isFinite(options?.orientation?.heading))
    pose.heading = options.orientation.heading;
  if (Number.isFinite(options?.orientation?.pitch))
    pose.pitch = options.orientation.pitch;
}

function groundUnderPose(destination, heading, pitch) {
  const enu = Cesium.Transforms.eastNorthUpToFixedFrame(destination);
  const direction = Cesium.Matrix4.multiplyByPointAsVector(
    enu,
    new Cesium.Cartesian3(
      Math.cos(pitch) * Math.sin(heading),
      Math.cos(pitch) * Math.cos(heading),
      Math.sin(pitch),
    ),
    new Cesium.Cartesian3(),
  );
  Cesium.Cartesian3.normalize(direction, direction);
  const ray = new Cesium.Ray(destination, direction);
  const hit = Cesium.IntersectionTests.rayEllipsoid(ray, Cesium.Ellipsoid.WGS84);
  if (!hit) return null;
  const carto = Cesium.Cartographic.fromCartesian(
    Cesium.Ray.getPoint(ray, hit.start),
  );
  return {
    lat: Cesium.Math.toDegrees(carto.latitude),
    lon: Cesium.Math.toDegrees(carto.longitude),
  };
}

function nearLouisville(query) {
  if (query?.kind === 'bbox') {
    return (
      query.south <= LOUISVILLE.lat &&
      query.north >= LOUISVILLE.lat &&
      query.west <= LOUISVILLE.lon &&
      query.east >= LOUISVILLE.lon
    );
  }
  return (
    Math.abs(Number(query?.lat) - LOUISVILLE.lat) < 0.2 &&
    Math.abs(Number(query?.lon) - LOUISVILLE.lon) < 0.2
  );
}

test('share restore keeps Caltrans and ALGO pins when the window transform is not ready', async () => {
  const original = Cesium.SceneTransforms.worldToWindowCoordinates;
  Cesium.SceneTransforms.worldToWindowCoordinates = () => undefined;
  const place = { ...HOME };
  const viewer = viewerAt(place);
  const calls = [];
  const windy = createWindyWebcamsLayer({
    source: {
      nearby(query) {
        calls.push(['windy', query.lat, query.lon]);
        const webcams = nearLouisville(query)
          ? [cameraRecord('101', LOUISVILLE)]
          : [];
        return { webcams };
      },
      detail() {
        return { webcam: cameraRecord('101', LOUISVILLE) };
      },
      forecast() {
        return {};
      },
    },
  });
  const kytc = createKytcWebcamsLayer({
    source: {
      cameras(query) {
        calls.push(['kytc', query]);
        return {
          cameras: nearLouisville(query)
            ? [cameraRecord('202', LOUISVILLE)]
            : [],
        };
      },
    },
  });
  const cwwp = createCwwpWebcamsLayer({
    source: {
      cameras(query) {
        calls.push(['cwwp', query]);
        return {
          cameras: nearLouisville(query)
            ? [cameraRecord('d07-12', LOUISVILLE)]
            : [],
        };
      },
    },
  });
  const algo = createAlgoWebcamsLayer({
    isEnabled: () => true,
    source: {
      cameras(query) {
        calls.push(['algo', query]);
        return {
          cameras: nearLouisville(query)
            ? [cameraRecord('303', LOUISVILLE)]
            : [],
        };
      },
    },
  });
  const nps = createNpsNatureLayer({
    source: {
      cameras() {
        calls.push(['nps']);
        return { cameras: [cameraRecord('old-faithful', LOUISVILLE)] };
      },
    },
  });
  const explore = createWebcamExploreLayer({
    source: {
      search() {
        calls.push(['explore']);
        return {
          webcams: [
            {
              id: 'bern-1',
              title: 'Bern',
              page_url: 'https://www.webcamexplore.com/webcams/bern',
              thumbnail_url: 'https://www.webcamexplore.com/thumb.jpg',
            },
          ],
        };
      },
    },
  });
  const layers = [windy, kytc, cwwp, algo, nps, explore];
  let share = null;
  try {
    for (const layer of layers) layer.init(viewer);
    for (const layer of [windy, kytc, cwwp, algo, nps]) {
      layer.enable(viewer);
      await layer.update(viewer);
    }
    assert.equal(windy.getStats().count, 0);
    assert.equal(kytc.getStats().count, 0);
    assert.equal(cwwp.getStats().count, 0);
    assert.equal(algo.getStats().count, 0);
    assert.equal(nps.getStats().count, 1);
    place.lat = LOUISVILLE.lat;
    place.lon = LOUISVILLE.lon;
    share = new ShareLinkManager(viewer);
    await share.applyState({
      lat: LOUISVILLE.lat,
      lon: LOUISVILLE.lon,
      alt: 40000,
      heading: 0,
      pitch: -35,
      roll: 0,
    });
    await delay(500);
    for (const id of ['windy', 'kytc', 'cwwp', 'algo', 'nps']) {
      assert.ok(
        calls.some((call) => call[0] === id),
        `${id} fetch ran`,
      );
    }
    assert.equal(windy.getStats().count, 1);
    assert.equal(kytc.getStats().count, 1);
    assert.equal(cwwp.getStats().count, 1);
    assert.equal(algo.getStats().count, 1);
    Cesium.SceneTransforms.worldToWindowCoordinates = () => ({
      x: -1000,
      y: -1000,
    });
    viewer.scene.postRender.raiseEvent();
    assert.equal(cwwp.getStats().count, 0);
    assert.equal(algo.getStats().count, 0);
    explore.enable(viewer);
    await explore.search('Bern');
    assert.equal(explore.getSnapshot().webcams.length, 1);
  } finally {
    Cesium.SceneTransforms.worldToWindowCoordinates = original;
    for (const layer of layers) layer.destroy(viewer);
    share?.destroy();
  }
});

test('panel toggle fetches and draws pins when the camera is already on target', async () => {
  const place = { ...LOUISVILLE };
  const viewer = viewerAt(place);
  const calls = [];
  const layers = [
    createWindyWebcamsLayer({
      source: {
        nearby(query) {
          calls.push('windy');
          return {
            webcams: nearLouisville(query)
              ? [cameraRecord('101', LOUISVILLE)]
              : [],
          };
        },
        detail() {
          return { webcam: cameraRecord('101', LOUISVILLE) };
        },
        forecast() {
          return {};
        },
      },
    }),
    createKytcWebcamsLayer({
      source: {
        cameras(query) {
          calls.push('kytc');
          return {
            cameras: nearLouisville(query)
              ? [cameraRecord('202', LOUISVILLE)]
              : [],
          };
        },
      },
    }),
    createCwwpWebcamsLayer({
      source: {
        cameras(query) {
          calls.push('cwwp');
          return {
            cameras: nearLouisville(query)
              ? [cameraRecord('d07-12', LOUISVILLE)]
              : [],
          };
        },
      },
    }),
    createAlgoWebcamsLayer({
      isEnabled: () => true,
      source: {
        cameras(query) {
          calls.push('algo');
          return {
            cameras: nearLouisville(query)
              ? [cameraRecord('303', LOUISVILLE)]
              : [],
          };
        },
      },
    }),
    createNpsNatureLayer({
      source: {
        cameras() {
          calls.push('nps');
          return { cameras: [cameraRecord('old-faithful', LOUISVILLE)] };
        },
      },
    }),
  ];
  try {
    for (const layer of layers) {
      layer.init(viewer);
      layer.enable(viewer);
      await layer.update(viewer);
      assert.equal(layer.getStats().count, 1, layer.id);
    }
    assert.deepEqual(calls.sort(), ['algo', 'cwwp', 'kytc', 'nps', 'windy']);
  } finally {
    for (const layer of layers) layer.destroy(viewer);
  }
});

test('a share link with no pitch centers the hash lat/lon under a -35° tilt', () => {
  globalThis.window = {
    location: {
      hash: '#lat=38.25&lon=-85.76&alt=40000&heading=0',
      href: 'http://localhost/#lat=38.25&lon=-85.76&alt=40000&heading=0',
    },
  };
  const parsed = new ShareLinkManager({
    camera: { changed: { addEventListener() {} } },
  }).parseInitialHash();
  assert.equal(parsed.pitch, -35);
  const target = { lon: -85.76, lat: 38.25, alt: 40000, heading: 0, pitch: -35 };
  const destination = cameraDestinationForTarget(target);
  const ground = groundUnderPose(
    destination,
    Cesium.Math.toRadians(0),
    Cesium.Math.toRadians(-35),
  );
  assert.ok(Math.abs(ground.lat - target.lat) < 0.02, `lat ${ground.lat}`);
  assert.ok(Math.abs(ground.lon - target.lon) < 0.02, `lon ${ground.lon}`);
  const nadir = cameraDestinationForTarget({
    lon: -118.24,
    lat: 34.05,
    alt: 40000,
    heading: 0,
    pitch: -89,
  });
  const nadirGround = groundUnderPose(
    nadir,
    0,
    Cesium.Math.toRadians(-89),
  );
  assert.ok(Math.abs(nadirGround.lat - 34.05) < 0.02);
  assert.ok(Math.abs(nadirGround.lon + 118.24) < 0.02);
  assert.ok(
    Cesium.Cartesian3.distance(
      nadir,
      Cesium.Cartesian3.fromDegrees(-118.24, 34.05, 40000),
    ) < 2000,
  );
});

test('hash restore opens Data Layers when Webcam Explore is enabled', () => {
  const opened = panelStateForRestoredLayers(
    { enabledLayerIds: ['webcam-explore'] },
    null,
  );
  assert.deepEqual(opened, {
    specs: [{ id: 'data-panel', collapsed: false }],
  });
  const explicit = panelStateForRestoredLayers(
    { enabledLayerIds: ['webcam-explore'] },
    { specs: [{ id: 'data-panel', collapsed: true }] },
  );
  assert.equal(explicit.specs[0].collapsed, true);
});
