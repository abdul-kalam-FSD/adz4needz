import test from 'node:test';
import assert from 'node:assert/strict';
import { reviewLabel, reviewBadge, checkReviewNote } from './payment-labels.js';

test('review labels fall back to pending for anything unknown', () => {
  assert.equal(reviewLabel('approved'), 'Approved'); assert.equal(reviewLabel('rejected'), 'Rejected');
  assert.equal(reviewLabel(undefined), 'Awaiting review'); assert.equal(reviewBadge('zzz'), 'badge-review-pending'); assert.equal(reviewBadge('approved'), 'badge-review-approved');
});
test('checkReviewNote: a rejection needs a reason, notes are capped', () => {
  assert.match(checkReviewNote('rejected', '  '), /reason/); assert.equal(checkReviewNote('rejected', 'Blurry'), null);
  assert.equal(checkReviewNote('approved', ''), null); assert.match(checkReviewNote('approved', 'x'.repeat(301)), /at most 300/);
});
