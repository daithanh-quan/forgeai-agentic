import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidTaskId } from '../bin/lib/utils.js';

test('isValidTaskId accepts a well-formed task id', () => {
  assert.equal(isValidTaskId('TASK-20260724-routing-fallback'), true);
  assert.equal(isValidTaskId('TASK-20260101-a'), true);
});

test('isValidTaskId rejects placeholders and malformed ids', () => {
  assert.equal(isValidTaskId(''), false);
  assert.equal(isValidTaskId('TASK-YYYYMMDD-short-slug'), false);
  assert.equal(isValidTaskId('TASK-...'), false);
  assert.equal(isValidTaskId('TASK-2026-routing'), false); // date not 8 digits
  assert.equal(isValidTaskId('task-20260724-x'), false);   // wrong prefix case
  assert.equal(isValidTaskId('TASK-20260724-'), false);    // empty slug
});
