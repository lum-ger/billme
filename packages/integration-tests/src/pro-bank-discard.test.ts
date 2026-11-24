import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { startPro, type ProHarness } from './harness.js';
import { bankTransactions, importCsv } from './pro-fixtures.js';

/**
 * A card import carries 0,00 € verification lines (Chrome Temp, Amazon Prime).
 * Their draft is blocked (UNBALANCED_ENTRY), "reject" only returns an
 * incomplete draft to incomplete, so the line stayed in "Buchen" forever.
 * "discard" is the real state: the line leaves the open bank work.
 */
describe('pro bank lines: discarding a line that must not be booked', () => {
  let h: ProHarness;
  const bank = `bank-${randomUUID().slice(0, 6)}`;
  before(async () => {
    h = await startPro(null, 'pro-bank-discard');
    await h.api.accounts.upsert({ account: { id: bank, name: 'Kreditkarte', iban: 'DE02120300000000202051', balance: 0, transactions: [], type: 'bank', color: '#000000', defaultSkrAccountNumber: '1200' } as never });
  });
  after(async () => { await h.close(); });

  test('a 0,00 € line is discarded and leaves the open bank lines; a booked line cannot be', async () => {
    await importCsv(h, bank, [
      { date: '2026-11-23', amount: 0, counterparty: 'Google Chrome Temp', purpose: 'Verifizierung' },
      { date: '2026-11-23', amount: -10, counterparty: 'Papier GmbH', purpose: 'Papier' },
    ]);
    const zero = (await bankTransactions(h)).find((tx) => tx.counterparty === 'Google Chrome Temp')!;
    assert.equal(zero.amount, 0);
    await h.api.pro.getDraftByTransactionId({ transactionId: zero.id });
    // reject is a return for correction, not a way out: still open.
    const rejected = await h.api.pro.dispatchDraftAction({ transactionId: zero.id, action: 'reject', rejectReason: 'Verifizierung' });
    assert.equal(rejected.workflowStatus, 'incomplete');
    assert.ok((await bankTransactions(h)).some((tx) => tx.id === zero.id));

    await h.api.pro.dispatchDraftAction({ transactionId: zero.id, action: 'discard', rejectReason: 'Kartenverifizierung' });
    const after = await bankTransactions(h);
    assert.ok(!after.some((tx) => tx.id === zero.id), 'the discarded line is gone from the open bank lines');
    assert.ok(after.some((tx) => tx.counterparty === 'Papier GmbH'));
  });
});
