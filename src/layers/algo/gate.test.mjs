import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlgoWebcamsLayer } from './index.js';

function layer(isEnabled) {
  return createAlgoWebcamsLayer({
    source: {
      cameras() {
        throw new Error('catalog must wait for an enabled view');
      },
      warm() {
        throw new Error('stills must wait for an enabled view');
      },
    },
    isEnabled,
  });
}

test('the layer stays hidden and refuses to enable when the flag is off', async () => {
  const row = layer(() => false);
  try {
    assert.equal(row.showInTogglePanel, false);
    assert.equal(row.enable(), false);
    assert.equal(await row.update(), false);
    assert.match(row.getRowControls().info, /WARNING/);
    assert.match(row.getRowControls().info, /not cleared for production/);
  } finally {
    row.destroy();
  }
});

test('an explicit flag reveals the layer and still does not fetch until a view exists', () => {
  const row = layer(() => true);
  try {
    assert.equal(row.showInTogglePanel, true);
    assert.equal(row.name, 'ALGO (experimental)');
    row.enable();
    assert.equal(row.getStats().status, 'idle');
  } finally {
    row.destroy();
  }
});
