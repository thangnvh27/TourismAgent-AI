import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { makeDemo, validTrip } from '../frontend/core.js';
import { balanceTrip, guidePrompt, jsonBytes, compactItinerary, parseGuide, MAX_REQUEST_BYTES, finalizeTrip, normalizeRequest } from '../frontend/tour-engine.js';
import { createMailer } from '../scripts/email.mjs';
const request = normalizeRequest({ destination: 'Đà Nẵng', days: 3, people: 2, budget: 8000000, transport: 'Ô tô', interests: ['Thiên nhiên'] });
const wf = JSON.parse(await readFile(new URL('../workflows/AI Tourism v3.json', import.meta.url), 'utf8'));
const get = prefix => wf.nodes.find(n => n.name.startsWith(prefix));
const run = (prefix, data, state = {}) => new Function('$json', '$', '$input', get(prefix).parameters.jsCode)(data, name => ({first: () => ({json: state[name]})}), {})[0].json;

test('14-day Vietnamese tours exceeding the old byte limit fit compact guide context', () => {
  const trip = makeDemo({...request, days: 14});
  trip.itinerary.days.forEach(d => d.activities.forEach(a => a.description = 'đ'.repeat(500)));
  const body = {mode: 'edit', question: 'Thêm thời gian nghỉ', request: trip.request, itinerary: trip.itinerary};
  assert.ok(jsonBytes(body) > 64000); assert.ok(jsonBytes(body) < MAX_REQUEST_BYTES);
  assert.equal(jsonBytes(body), Buffer.byteLength(JSON.stringify(body)));
  const base = guidePrompt(body);
  assert.ok(Buffer.byteLength(base.prompt) < 128 * 1024);
  const reply = parseGuide(JSON.stringify({answer: 'Giữ hoạt động', itinerary: compactItinerary(trip.itinerary)}), base);
  assert.equal(reply.proposal.itinerary.days[0].activities[0].description, 'đ'.repeat(500));
  assert.throws(() => guidePrompt({...body, unused: 'đ'.repeat(MAX_REQUEST_BYTES)}), /512 KiB/);
});

test('balancing removes costly experiences without inventing cheaper prices or mutating original', () => {
  const trip = makeDemo(request);
  trip.itinerary.days[0].activities[0].cost = 6000000;
  const snapshot = JSON.stringify(trip), result = balanceTrip(trip);
  assert.equal(result.status, 'proposal'); assert.ok(validTrip(result.proposal));
  assert.equal(result.proposal.budgetAudit.overBudget, false);
  assert.deepEqual(result.proposal.request, trip.request);
  assert.equal(result.proposal.emailSent, false); assert.equal(result.proposal.revision, 1);
  assert.equal(JSON.stringify(trip), snapshot);
  assert.ok(result.changes.some(c => c.originalName === trip.itinerary.days[0].activities[0].name));
  for (const c of result.changes) assert.equal(result.proposal.itinerary.days[c.day - 1].activities[c.index].cost, 0);
  assert.equal(result.proposal.budgetAudit.total, finalizeTrip(normalizeRequest(request), trip.itinerary).budgetAudit.total - result.saved);
});

test('fixed-cost shortfalls are explained without silently changing rates or reserve', () => {
  const trip = makeDemo({...request, budget: 500000});
  const result = balanceTrip(trip);
  assert.equal(result.status, 'not_feasible'); assert.ok(result.shortfall > 0); assert.equal(result.proposal, undefined);
  assert.equal(balanceTrip(makeDemo({...request, budget: 50000000})).status, 'within_budget');
});

test('email branch bypasses every AI node and renders the edited itinerary', () => {
  const trip = makeDemo(request); trip.itinerary.title = 'Bản chỉnh <mới>';
  trip.itinerary.days[1].activities[0].description = 'Nội dung đã chỉnh, không tạo lại';
  let data = run('03', run('02', {body: {...trip.request, action: 'email', email: 'test@example.com', sendEmail: true, itinerary: trip.itinerary, revision: 4}}));
  assert.equal(data.valid, true);
  assert.equal(run('03', run('02', {body: {action:'email'}})).code, 'INVALID_EMAIL_INPUT');
  const targets = wf.connections[get('30').name].main;
  assert.equal(targets[0][0].node, get('14').name); assert.equal(targets[1][0].node, get('06').name);
  const visited = new Set();
  const walk = name => { if (visited.has(name)) return; visited.add(name); for (const branch of wf.connections[name]?.main || []) for (const edge of branch) walk(edge.node); };
  walk(get('14').name);
  assert.ok(![...visited].some(name => /^(09|10|27)/.test(name)));
  data = run('17', run('16', run('15', run('14', data))));
  assert.match(data.html, /Nội dung đã chỉnh, không tạo lại/); assert.match(data.html, /Bản chỉnh &lt;mới&gt;/);
  data = run('20', {id:'mock-gmail-id'}, {[get('17').name]:data});
  const result = run('22', data);
  assert.equal(result.action, 'email'); assert.equal(result.revision, 4); assert.equal(result.emailSent, true);
  assert.deepEqual(result.itinerary, finalizeTrip(normalizeRequest(trip.request), trip.itinerary).itinerary);
});

test('concurrent and repeated identical email sends coalesce by recipient and content', async () => {
  const calls = []; const trip = {...makeDemo(request), demo:false};
  const mail = createMailer(async body => {
    calls.push(body);
    if (!body.itinerary) return {status:400,data:{code:'INVALID_EMAIL_INPUT'}};
    await new Promise(resolve => setTimeout(resolve, 15));
    return {status:200,data:{action:'email',emailSent:true,emailStatus:'sent'}};
  });
  const payload = {email:'test@example.com',trip};
  const results = await Promise.all([mail(payload),mail(payload)]);
  assert.ok(results.every(r => r.data.emailSent)); assert.equal(calls.length,2);
  await mail({...payload,trip:{...trip,revision:77}}); assert.equal(calls.length,2);
  const {totalEstimatedCost, ...content} = trip.itinerary;
  assert.deepEqual(calls[1].itinerary, content); assert.equal(calls[1].action, 'email');
  await mail({...payload,email:'another@example.com'}); assert.equal(calls.length,4);
  const changed = structuredClone(trip); changed.itinerary.title = 'Bản khác';
  await mail({...payload,trip:changed}); assert.equal(calls.length,6);
});

test('old deployed workflows are probed safely and never receive the full email request', async () => {
  const calls = [];
  const mail = createMailer(async body => {calls.push(body);return {status:400,data:{code:'INVALID_INPUT'}};});
  assert.equal((await mail({email:'test@example.com',trip:{...makeDemo(request),demo:false}})).status,409);
  assert.deepEqual(calls,[{action:'email'}]);
  assert.equal((await mail({email:'bad',trip:makeDemo(request)})).status,400);
});

test('ambiguous sends stay cached and cannot be retried into duplicate delivery', async () => {
  let sends = 0;
  const mail = createMailer(async body => {
    if (!body.itinerary) return {status:400,data:{code:'INVALID_EMAIL_INPUT'}};
    sends++; throw new Error('network timeout after Gmail acceptance');
  });
  const payload={email:'test@example.com',trip:{...makeDemo(request),demo:false}};
  assert.equal((await mail(payload)).data.emailStatus,'unknown');
  assert.equal((await mail(payload)).data.emailStatus,'unknown'); assert.equal(sends,1);
});
