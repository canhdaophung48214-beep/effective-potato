'use strict';
const crypto = require('crypto');
const { createHarness } = require('./ugc_fake_cloud');

function fixture() {
  const h = createHarness();
  process.env.UGC_RETENTION_POLICY_STATUS = 'confirmed';
  process.env.UGC_RETENTION_MARK_AFTER_DAYS = '29';
  process.env.UGC_RETENTION_BATCH_LIMIT = '10';
  process.env.UGC_RETENTION_CONFIRMED_BY = 'offline-test';
  process.env.UGC_RETENTION_TRIGGER_TOKEN = 'offline-t363-secret';
  const fn = h.loadFunction('cloudfunctions/retention/index.js');
  const now = new Date();
  function seed(id, pendingAudit) {
    const row = { _id: id, status: 'expired', rev: pendingAudit ? 2 : 1,
      createdAt: new Date(now.getTime() - 31 * 86400000),
      payload: { text: 'private-' + id } };
    if (pendingAudit) {
      const eventId = 'retention_mark_' + crypto.createHash('sha256')
        .update(id + '\0' + '2').digest('hex');
      row.retention = { audit: { state: 'pending', eventId,
        markedRev: 2, day: now.toISOString().slice(0, 10), retryAfter: new Date(0) } };
    }
    h.seed('submissions', row);
    return row;
  }
  function row(id) { return h.docs('submissions').find(x => x._id === id); }
  function batch(batchId) { return h.docs('upload_logs').filter(x => x.result && x.result.stats &&
    x.result.stats.batchId === batchId); }
  return { h, fn, T: fn.__test__, now, seed, row, batch };
}
module.exports = { fixture };
