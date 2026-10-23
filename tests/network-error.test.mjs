import { test } from 'node:test';
import assert from 'node:assert/strict';
import { networkError } from '../scripts/network-error.mjs';
test('distinguishes sandbox denial, DNS, refused connection and timeout', () => {
  assert.equal(networkError({ cause: { code: 'EACCES' } }).code, 'NETWORK_PERMISSION_DENIED');
  assert.equal(networkError({ cause: { code: 'ENOTFOUND' } }).code, 'N8N_DNS_ERROR');
  assert.equal(networkError({ cause: { code: 'ECONNREFUSED' } }).code, 'N8N_CONNECTION_REFUSED');
  assert.equal(networkError({ name: 'TimeoutError' }).status, 504);
  assert.equal(networkError({ cause: { code: 'CERT_HAS_EXPIRED' } }).code, 'N8N_TLS_ERROR');
});
