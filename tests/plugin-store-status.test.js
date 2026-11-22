import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pluginStoreStatus } from '../shared/plugin-store-status.js';

test('only a trusted empty catalog is presented as an empty published registry', () => {
  const empty = pluginStoreStatus({ configured: true, trusted: true, releases: [] });
  assert.equal(empty.kind, 'empty'); assert.equal(empty.title, 'No plugins published yet');
  const failed = pluginStoreStatus({ configured: true, trusted: false, releases: [], error: 'Registry HTTP 503 at /metadata/2.root.json' });
  assert.equal(failed.kind, 'unavailable'); assert.match(failed.title, /temporarily unavailable/);
  const invalid = pluginStoreStatus({ configured: true, trusted: false, releases: [], error: 'targets was signed by 0/1 keys' });
  assert.equal(invalid.kind, 'unverified'); assert.doesNotMatch(invalid.title, /published yet/);
});

test('disabled production activation explains the operator gate without trusting the retired channel', () => {
  const disabled = pluginStoreStatus({ configured: false, trusted: false, releases: [], disabledReason: 'Production key custody is pending.' });
  assert.equal(disabled.kind, 'disabled'); assert.equal(disabled.message, 'Production key custody is pending.');
  assert.equal(pluginStoreStatus({ configured: true, trusted: true, releases: [{ status: 'approved' }] }).kind, 'ready');
});
