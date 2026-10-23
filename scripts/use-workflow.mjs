import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from './env.mjs';
const version = process.argv[2];
if (!['v2', 'v3'].includes(version)) throw new Error('Usage: node scripts/use-workflow.mjs v3 (or v2 to roll back)');
const file = new URL('../.env', import.meta.url), raw = await readFile(file, 'utf8'), env = parseEnv(raw);
const paths = { N8N_TRIP_URL: '/webhook/generate-trip-' + version, N8N_GUIDE_URL: '/webhook/virtual-guide-' + version };
let updated = raw;
for (const [key, path] of Object.entries(paths)) {
  const url = new URL(env[key]);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid webhook protocol');
  url.pathname = path; url.search = ''; url.hash = '';
  const pattern = new RegExp('^\\s*' + key + '\\s*=.*$', 'm');
  if (!pattern.test(updated)) throw new Error('Missing ' + key + ' in .env');
  updated = updated.replace(pattern, () => key + '=' + url.toString());
}
await writeFile(file, updated);
console.log('Updated webhook paths to ' + version + '. Restart npm.cmd start. Other settings preserved.');
