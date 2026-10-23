import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeRequest, validateRequest, planBudget, finalizeTrip, applyRequestPatch, guidePrompt, parseGuide, makeDemoProposal } from '../frontend/tour-engine.js';
import { makeDemo } from '../frontend/core.js';
import { catalog } from '../frontend/catalog.js';
const request = normalizeRequest({ destination: 'Đà Nẵng', days: 3, people: 3, budget: 12000000, transport: 'Ô tô', costSettings: { arrivalKnown: true, arrivalPerPerson: 1500000, roomPerNight: 600000, peoplePerRoom: 2, foodPerPersonDay: 200000, localTransportPerDay: 300000, reservePercent: 10 } });
const wf = JSON.parse(await readFile(new URL('../workflows/AI Tourism v3.json', import.meta.url), 'utf8'));
const get = n => wf.nodes.find(node => node.name.startsWith(n));
const run = (n, json, state = {}) => new Function('$json','$','$input', get(n).parameters.jsCode)(json, name => ({first:()=>({json:state[name]})}), {first:()=>({json})})[0].json;

test('complete budget counts rooms, nights, round-trip tickets and reserve once', () => {
  const a = planBudget(request, 600000);
  assert.equal(a.rooms, 2); assert.equal(a.nights, 2);
  assert.deepEqual(a.breakdown, { arrival:4500000, accommodation:2400000, food:1800000, transport:900000, activities:600000, reserve:1200000 });
  assert.equal(a.total, 11400000); assert.equal(a.remaining, 600000); assert.equal(a.complete,true);
  assert.equal(planBudget({...request, days:1}).breakdown.accommodation, 0);
  assert.equal(planBudget({...request, costSettings:{...request.costSettings, accommodationIncluded:true}}).breakdown.accommodation,0);
});
test('missing arrival cost is explicit; zero lodging needs exemption', () => {
  const r=normalizeRequest({...request,costSettings:{...request.costSettings,arrivalKnown:false,roomPerNight:0}});
  assert.ok(validateRequest(r).length);
  r.costSettings.accommodationIncluded=true; assert.equal(validateRequest(r).length,0);
  const t=finalizeTrip(r,makeDemo(request).itinerary); assert.equal(t.budgetAudit.complete,false); assert.ok(t.warnings.some(w=>w.includes('vé khứ hồi')));
});
test('AI cannot double count fixed costs or forge citations', () => {
  const it=makeDemo(request).itinerary;
  const a=it.days[0].activities[0]; a.name='Địa điểm bịa'; a.placeId='my-khe'; a.sourceIds=['vn-danang'];
  it.days[0].activities.find(a=>a.category==='food').cost=999999999;
  const t=finalizeTrip(request,it);
  assert.deepEqual(t.itinerary.days[0].activities[0].sourceIds,[]);
  assert.equal(t.itinerary.days[0].activities.find(a=>a.category==='food').cost,0);
  assert.equal(t.budgetAudit.breakdown.food,1800000);
});
test('edits preserve user rates, block email and reject invalid changes', () => {
  const r=applyRequestPatch(request,{budget:10000000,costSettings:{roomPerNight:0},email:'malicious@example.com',sendEmail:true,destination:'Hội An'});
  assert.equal(r.budget,10000000); assert.deepEqual(r.costSettings,request.costSettings); assert.equal(r.destination,'Đà Nẵng'); assert.equal(r.sendEmail,false); assert.equal(r.email,'');
  assert.throws(()=>applyRequestPatch(request,{days:0}));
});
test('guide edit proposal validates complete itinerary and recalculates all costs', () => {
  const original=makeDemo(request),base=guidePrompt({mode:'edit',question:'Giảm ngân sách 1 triệu',request:original.request,itinerary:original.itinerary,revision:2});
  const result=parseGuide(JSON.stringify({answer:'Đề xuất giảm ngân sách',requestPatch:{budget:11000000},itinerary:original.itinerary}),base);
  assert.equal(result.proposal.revision,3); assert.equal(result.proposal.request.budget,11000000); assert.equal(result.proposal.emailSent,false); assert.equal(original.request.budget,12000000);
  const bad=structuredClone(original.itinerary); bad.days.pop();
  assert.throws(()=>parseGuide(JSON.stringify({answer:'x',itinerary:bad}),base));
});
test('demo edits support budget, family and day replacement without mutating original', () => {
  const t=makeDemo(request),snapshot=JSON.stringify(t);
  const a=makeDemoProposal('Giảm ngân sách 1 triệu',t); assert.equal(a.proposal.request.budget,11000000);
  const b=makeDemoProposal('Thêm thời gian nghỉ cho trẻ nhỏ',t); assert.ok(b.proposal.request.interests.includes('Gia đình có trẻ nhỏ'));
  const c=makeDemoProposal('Thay điểm ngày 2',t); assert.notEqual(c.proposal.itinerary.days[1].activities[0].name,t.itinerary.days[1].activities[0].name);
  assert.equal(JSON.stringify(t),snapshot);
  assert.throws(()=>makeDemoProposal('Thay điểm ngày 20',t));
});
test('catalog covers all 21 destinations with HTTPS primary sources and review dates', () => {
  assert.equal(Object.keys(catalog).length,21);
  for(const context of Object.values(catalog)) {
    const ids=new Set(context.sources.map(s=>s.id));
    for(const s of context.sources) { const u=new URL(s.url); assert.equal(u.protocol,'https:'); assert.ok(['vietnam.travel','www.vietnam.travel','whc.unesco.org','vpub.gialai.gov.vn','dulich.tayninh.gov.vn'].includes(u.hostname)); assert.equal(s.checkedAt,'2026-10-10'); }
    for(const p of context.places) assert.ok(p.sourceIds.every(id=>ids.has(id)));
  }
});
test('v3 workflow keeps 30 connected nodes and separate webhook paths', () => {
  assert.equal(wf.nodes.length,30); assert.equal(get('01').parameters.path,'generate-trip-v3'); assert.equal(get('24').parameters.path,'virtual-guide-v3');
  for(const n of wf.nodes.filter(n=>n.type.endsWith('.code'))) new Function('$json','$','$input',n.parameters.jsCode);
  for(const branches of Object.values(wf.connections)) for(const edges of Object.values(branches)) for(const edge of edges.flat()) assert.ok(wf.nodes.some(n=>n.name===edge.node));
});
test('v3 node execution covers generation, safe email and conversational revision', () => {
  let data=run('02',{body:request}); data=run('03',data); assert.equal(data.valid,true);
  data=run('06',data);data=run('07',data);data=run('08',data);assert.ok(!data.prompt.includes('email'));
  const state={ [get('08').name]:data };
  data=run('11',{text:JSON.stringify(makeDemo(request).itinerary)},state);assert.equal(data.valid,true);
  data=run('14',data);data=run('15',data);data=run('16',data);data=run('17',data);assert.ok(data.html.includes('Vé khứ hồi'));assert.ok(data.html.includes('UNESCO'));
  data=run('21',data);const t=run('22',data);assert.equal(t.schemaVersion,3);assert.equal(t.request.email,undefined);assert.equal(t.budgetAudit.nights,2);
  const base=run('25',{body:{mode:'edit',question:'Thay điểm ngày 2',request:t.request,itinerary:t.itinerary}});assert.equal(base.valid,true);
  const reply=run('28',{text:JSON.stringify({answer:'Đề xuất mới',requestPatch:{budget:11000000},itinerary:t.itinerary})},{[get('25').name]:base});assert.equal(reply.status,200);assert.equal(reply.proposal.request.budget,11000000);
  const error=run('28',{text:'not JSON'},{[get('25').name]:base});assert.equal(error.status,422);
});
