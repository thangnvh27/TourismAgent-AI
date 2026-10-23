import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeDemo, validTrip, demoAnswer, escapeHtml } from '../frontend/core.js';
const wf = JSON.parse(await readFile(new URL('../workflows/AI Tourism v2.json', import.meta.url), 'utf8'));
const find = prefix => wf.nodes.find(n => n.name.startsWith(prefix));
const run = (prefix, json, state = {}) => {
  const fn = new Function('$json', '$', '$input', find(prefix).parameters.jsCode);
  return fn(json, name => ({ first: () => ({ json: state[name] }) }), { first: () => ({ json }) })[0].json;
};
const body = { destination: { name: 'Đà Nẵng' }, days: 3, people: 2, budget: 8000000, transport: 'Ô tô', interests: ['Thiên nhiên'], sendEmail: false, startDate: '2026-10-17' };
const promptBase = () => run('08', run('07', run('06', run('03', run('02', { body })))));

test('29 unique nodes, all connection targets and code syntax valid', () => {
  assert.equal(wf.nodes.length, 29); assert.equal(new Set(wf.nodes.map(n => n.name)).size, 29);
  const names = new Set(wf.nodes.map(n => n.name));
  for (const [name, outputs] of Object.entries(wf.connections)) {
    assert.ok(names.has(name));
    for (const branches of Object.values(outputs)) for (const branch of branches) for (const target of branch) assert.ok(names.has(target.node));
  }
  for (const n of wf.nodes.filter(n => n.type.endsWith('.code'))) new Function('$json', '$', '$input', n.parameters.jsCode);
  assert.equal(wf.active, false); assert.equal(wf.nodes.some(n => n.credentials), false);
});
test('all main nodes reachable from webhooks; no disconnected filler', () => {
  const reached = new Set(); const walk = name => { if (reached.has(name)) return; reached.add(name); for (const branch of wf.connections[name]?.main || []) for (const edge of branch) walk(edge.node); };
  walk(find('01').name); walk(find('24').name);
  for (const n of wf.nodes.filter(n => !n.type.endsWith('.lmChatOpenAi'))) assert.ok(reached.has(n.name), n.name);
});
test('input rejects invalid budget, day count, date and email consent', () => {
  for (const patch of [{ days: 0 }, { people: 21 }, { budget: 'NaN' }, { sendEmail: true, email: 'bad' }, { startDate: '2026-02-30' }, { days: 1.5 }]) assert.equal(run('03', run('02', { body: { ...body, ...patch } })).valid, false);
  assert.equal(run('03', run('02', { body })).valid, true);
  assert.equal(run('03', run('02', { body: { ...body, email: 'unused' } })).valid, true);
});
test('prompt does not pass email to model', () => {
  const base = run('08', run('07', run('06', run('03', run('02', { body: { ...body, email: 'private@example.com' } })))));
  assert.ok(!base.prompt.includes('private@example.com'));
});
test('AI schema rejects malformed output, wrong day count, invalid time and cost', () => {
  const base = promptBase(), state = { [find('08').name]: base };
  assert.equal(run('11', { text: 'not JSON' }, state).valid, false);
  const valid = makeDemo(body).itinerary;
  assert.equal(run('11', { text: '```json\n' + JSON.stringify(valid) + '\n```' }, state).valid, true);
  for (const mutate of [t => t.days.pop(), t => t.days[0].activities[0].cost = -1, t => t.days[0].activities[0].time = '25:00', t => t.days[0].activities[1].time = '07:00']) {
    const copy = structuredClone(valid); mutate(copy); assert.equal(run('11', { text: JSON.stringify(copy) }, state).valid, false);
  }
});
test('cost recomputation, over-budget warning, packing and narration survive success path', () => {
  const base = promptBase(), parsed = run('11', { text: JSON.stringify(makeDemo(body).itinerary) }, { [find('08').name]: base });
  parsed.itinerary.totalEstimatedCost = 1;
  parsed.itinerary.days[0].activities[0].cost = 9000000;
  const audit = run('14', parsed); assert.equal(audit.budgetAudit.overBudget, true); assert.ok(audit.itinerary.totalEstimatedCost > 9000000);
  const pack = run('15', audit); assert.ok(pack.packing.includes('Đồ bơi'));
  const narrated = run('16', pack); assert.match(narrated.narration, /An/);
  const email = run('17', narrated); const skipped = run('21', email), response = run('22', skipped);
  assert.equal(response.emailSent, false); assert.ok(validTrip(response)); assert.equal(response.request.email, undefined);
});
test('HTML email escapes generated content and handles Gmail failure honestly', () => {
  const t = makeDemo(body); t.itinerary.title = '<img src=x onerror=alert(1)>';
  const base = { ...t, request: { ...body, destination: body.destination.name }, warnings: [] };
  const html = run('17', base); assert.ok(!html.html.includes('<img')); assert.match(html.html, /&lt;img/);
  const state = { [find('17').name]: html };
  assert.equal(run('20', { error: 'OAuth expired' }, state).emailSent, false);
  assert.equal(run('20', { id: 'gmail-message-id' }, state).emailSent, true);
  assert.equal(run('20', { threadId: 'not-delivered' }, state).emailSent, false);
});
test('guide validation and parser cover invalid input and model errors', () => {
  assert.equal(run('25', { body: { question: 'hello' } }).valid, false);
  assert.equal(run('25', { body: { question: 'ăn gì', itinerary: makeDemo(body).itinerary } }).valid, true);
  assert.equal(run('28', { text: '{"answer":"Mì Quảng"}' }).status, 200);
  assert.equal(run('28', { error: 'model offline' }).status, 502);
});
test('demo destination, days, group costs and fallback answers consistent', () => {
  for (const city of ['Đà Nẵng', 'Ninh Bình', 'Đà Lạt', 'Phú Quốc', 'Hạ Long', 'Hội An']) for (const days of [2, 3, 14]) {
    const t = makeDemo({ ...body, destination: { name: city }, days }); assert.ok(validTrip(t)); assert.equal(t.itinerary.days.length, days); assert.equal(t.destination, city);
    assert.equal(t.itinerary.totalEstimatedCost, Object.values(t.budgetAudit.breakdown).reduce((s, v) => s + v, 0));
    assert.equal(t.emailSent, false); assert.equal(t.request.email, undefined);
  }
  assert.match(demoAnswer('Thời tiết?', makeDemo(body)), /chưa có dữ liệu/);
  assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
});
