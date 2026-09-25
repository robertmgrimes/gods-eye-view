import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAlgoPopover } from './algo/popover.js';
import { createCwwpPopover } from './cwwp/popover.js';
import { createKytcPopover } from './kytc/popover.js';
import { createNpsNaturePopover } from './npsNature/popover.js';
import { createWindyPopover } from './windy/popover.js';

class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.className = '';
    this.classList = { contains: () => false };
    this.children = [];
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.textContent = '';
    this.offsetWidth = 320;
    this.offsetHeight = 240;
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }

  setAttribute(name, value) {
    if (name === 'id') this.id = value;
    this.dataset[name] = value;
  }

  addEventListener() {}

  replaceChildren() {
    this.children = [];
  }

  remove() {}

  closest() {
    return null;
  }
}

function fakeDocument() {
  const body = new FakeElement('body');
  return {
    body,
    documentElement: { clientWidth: 800, clientHeight: 600 },
    createElement: (tag) => new FakeElement(tag),
  };
}

function textOf(node) {
  const own = node.textContent || '';
  return own + (node.children || []).map(textOf).join('');
}

test('opening a camera card closes the one already on screen', () => {
  const doc = fakeDocument();
  const caltrans = createCwwpPopover({ document: doc });
  const kytc = createKytcPopover({ document: doc });
  caltrans.show({
    record: { title: 'Sacramento', route: 'I-5' },
    screen: { x: 40, y: 40 },
  });
  assert.equal(caltrans.element.hidden, false);
  kytc.show({
    record: { title: 'Lexington', highway: 'I-64' },
    screen: { x: 40, y: 40 },
  });
  assert.equal(caltrans.element.hidden, true);
  assert.equal(kytc.element.hidden, false);
  caltrans.destroy();
  kytc.destroy();
});

test('non-Windy camera cards do not offer an Open on Windy link', () => {
  const record = {
    title: 'KYTC camera',
    highway: 'I-64',
    detailUrl: 'https://www.windy.com/webcams/9',
    pageUrl: 'https://www.windy.com/webcams/9',
    stillUrl: '/api/kytc/webcams/1/still',
    kind: 'still',
  };
  const cards = [
    createKytcPopover({ document: fakeDocument() }),
    createCwwpPopover({ document: fakeDocument() }),
    createAlgoPopover({ document: fakeDocument() }),
    createNpsNaturePopover({ document: fakeDocument() }),
  ];
  for (const card of cards) {
    card.show({ record, stillUrl: record.stillUrl });
    assert.equal(textOf(card.element).includes('Open on Windy'), false);
    card.destroy();
  }
  const windy = createWindyPopover({ document: fakeDocument() });
  windy.show({
    record: { title: 'Other', detailUrl: 'https://example.com/cam' },
  });
  assert.equal(textOf(windy.element).includes('Open on Windy'), false);
  windy.show({
    record: {
      title: 'Windy cam',
      detailUrl: 'https://www.windy.com/webcams/9',
    },
  });
  assert.equal(textOf(windy.element).includes('Open on Windy'), true);
  windy.destroy();
});
