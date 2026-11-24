import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isValidKey, maskKey } from '../src/key.js';
import { FAKE_KEY } from './helpers.js';

test('maskKey shows only the last 4 characters', () => {
  assert.equal(maskKey(FAKE_KEY), 'lv_live_…cdef');
  assert.ok(!maskKey(FAKE_KEY).includes(FAKE_KEY.slice(8, 40)));
  assert.equal(maskKey('short'), 'lv_live_…');
  assert.equal(maskKey(undefined), 'lv_live_…');
});

test('isValidKey accepts lv_live_ + 48 lowercase hex only', () => {
  assert.ok(isValidKey(FAKE_KEY));
  assert.ok(!isValidKey(FAKE_KEY.toUpperCase()));
  assert.ok(!isValidKey(FAKE_KEY + '0'));
  assert.ok(!isValidKey(FAKE_KEY.slice(0, -1)));
  assert.ok(!isValidKey('lv_test_' + 'a'.repeat(48)));
  assert.ok(!isValidKey(` ${FAKE_KEY}`));
  assert.ok(!isValidKey(null));
});
