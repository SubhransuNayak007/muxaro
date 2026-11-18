/**
 * @file credit-ledger.test.ts
 * Tests for the append-only transaction ledger and credit accounting model
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EntitlementsEngine } from '../src/engine.js';

describe('Credit & Transaction Ledger Model', () => {
  it('records monotonically incremented transaction entries for every quota lifecycle event', async () => {
    const engine = new EntitlementsEngine();
    const userId = 'usr_ledger_audit_1';

    // 1. Reserve a job
    const res = await engine.reserveJobQuota({
      userId,
      userTier: 'free',
      jobType: 'VIDEO_DOWNLOAD',
      jobId: 'job_ledger_1',
    });

    // 2. Commit the job
    await engine.commitJobQuota(res.reservationId);

    // 3. Reserve a second job
    const res2 = await engine.reserveJobQuota({
      userId,
      userTier: 'free',
      jobType: 'VIDEO_DOWNLOAD',
      jobId: 'job_ledger_2',
    });

    // 4. Rollback the second job
    await engine.rollbackJobQuota(res2.reservationId, 'Cancelled');

    // Query ledger history
    const history = await engine.getLedgerHistory(userId);
    assert.equal(history.totalCount, 4);

    // Entries should be sorted newest first (sequenceNumber descending)
    assert.equal(history.entries[0]?.action, 'QUOTA_ROLLBACK');
    assert.equal(history.entries[0]?.sequenceNumber, 4);

    assert.equal(history.entries[1]?.action, 'QUOTA_RESERVE');
    assert.equal(history.entries[1]?.sequenceNumber, 3);

    assert.equal(history.entries[2]?.action, 'QUOTA_COMMIT');
    assert.equal(history.entries[2]?.sequenceNumber, 2);

    assert.equal(history.entries[3]?.action, 'QUOTA_RESERVE');
    assert.equal(history.entries[3]?.sequenceNumber, 1);
  });

  it('handles credit grants, debits, refunds, and balance checks accurately', async () => {
    const engine = new EntitlementsEngine();
    const userId = 'usr_credit_user_1';

    // Initial balance is 0
    let balance = await engine.getCreditBalance(userId);
    assert.equal(balance, 0);

    // Grant 100 credits (e.g. promo or payment)
    const grant = await engine.grantCredits(userId, 100, 'Welcome bonus');
    assert.equal(grant.amount, 100);
    assert.equal(grant.balanceAfter, 100);
    balance = await engine.getCreditBalance(userId);
    assert.equal(balance, 100);

    // Debit 25 credits for priority render
    const debit = await engine.debitCredits(userId, 25, 'Priority 8K transcoding job');
    assert.equal(debit.amount, -25);
    assert.equal(debit.balanceAfter, 75);
    balance = await engine.getCreditBalance(userId);
    assert.equal(balance, 75);

    // Refund 25 credits on failed transcode
    const refund = await engine.refundCredits(userId, 25, 'Transcoding failed - refund');
    assert.equal(refund.balanceAfter, 100);
    balance = await engine.getCreditBalance(userId);
    assert.equal(balance, 100);

    // Attempting to debit more than balance should fail
    await assert.rejects(async () => {
      await engine.debitCredits(userId, 500, 'Overdraft attempt');
    });

    // Check complete ledger
    const history = await engine.getLedgerHistory(userId);
    assert.equal(history.totalCount, 3);
  });
});
