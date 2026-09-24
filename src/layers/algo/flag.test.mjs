import test from 'node:test';
import assert from 'node:assert/strict';
import { algoCamerasEnabled, readAlgoCamerasFlag } from './flag.js';

test('the ALGO flag accepts only an explicit 1 or true', () => {
  assert.equal(readAlgoCamerasFlag(undefined), false);
  assert.equal(readAlgoCamerasFlag(''), false);
  assert.equal(readAlgoCamerasFlag('0'), false);
  assert.equal(readAlgoCamerasFlag('yes'), false);
  assert.equal(readAlgoCamerasFlag('on'), false);
  assert.equal(readAlgoCamerasFlag('1'), true);
  assert.equal(readAlgoCamerasFlag(' true '), true);
  assert.equal(readAlgoCamerasFlag('TRUE'), true);
  assert.equal(algoCamerasEnabled({}), false);
  assert.equal(algoCamerasEnabled({ GEV_ALGO_CAMERAS: '0' }), false);
  assert.equal(algoCamerasEnabled({ GEV_ALGO_CAMERAS: '1' }), true);
  assert.equal(algoCamerasEnabled({ GEV_ALGO_CAMERAS: 'true' }), true);
});
