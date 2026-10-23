import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from '../scripts/env.mjs';

test('loads N8N keys containing digits from Windows env files', () => {
  const env = parseEnv('\uFEFF# configuration\r\nPORT=3000\r\nN8N_TRIP_URL=https://example.com/webhook/generate-trip-v2\r\nN8N_GUIDE_URL=https://example.com/webhook/virtual-guide-v2\r\nN8N_WEBHOOK_SECRET=\r\n');
  assert.equal(env.PORT, '3000');
  assert.equal(env.N8N_TRIP_URL, 'https://example.com/webhook/generate-trip-v2');
  assert.equal(env.N8N_GUIDE_URL, 'https://example.com/webhook/virtual-guide-v2');
  assert.equal(env.N8N_WEBHOOK_SECRET, '');
});

test('handles surrounding whitespace and quoted values without truncating URL fragments', () => {
  const env = parseEnv(' N8N_TRIP_URL = "https://example.com/webhook/trip" \nN8N_WEBHOOK_SECRET=\'test#value\'\n# ignored');
  assert.equal(env.N8N_TRIP_URL, 'https://example.com/webhook/trip');
  assert.equal(env.N8N_WEBHOOK_SECRET, 'test#value');
});
