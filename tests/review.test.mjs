import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRequest, validateRequest, getContext, auditTrip, makeNarration, guidePrompt } from '../frontend/tour-engine.js';
import { makeDemo, validTrip } from '../frontend/core.js';
const request={destination:'Đà Nẵng',days:3,people:2,budget:8000000,transport:'Ô tô',interests:['Thiên nhiên']};
test('malformed requests and inherited object keys are rejected safely',()=>{
  for(const value of [null,[],42]) assert.ok(validateRequest(normalizeRequest(value)).length);
  for(const destination of ['__proto__','constructor','toString']) {
    assert.ok(validateRequest(normalizeRequest({...request,destination})).length);
    assert.deepEqual(getContext(destination),{sources:[],places:[]});
  }
});
test('unconfirmed arrival cost is described consistently with its inclusion in total',()=>{
  const r=normalizeRequest({...request,costSettings:{arrivalPerPerson:1000000,arrivalKnown:false}});
  const t=makeDemo(r),a=auditTrip(t.itinerary,r);
  assert.equal(a.budgetAudit.breakdown.arrival,2000000);
  assert.ok(a.warnings.some(w=>w.includes('mức tạm nhập')));
  assert.ok(!a.warnings.some(w=>w.includes('chưa bao gồm khoản này')));
  assert.match(makeNarration(a.itinerary,a.budgetAudit),/mức tạm nhập/);
});
test('saved and incoming trips with corrupt structure fail validation without throwing',()=>{
  const trip=makeDemo(request);assert.equal(validTrip(trip),true);
  for(const patch of [t=>t.packing=[{}],t=>t.budgetAudit.breakdown=null,t=>t.itinerary.days[0]=null,t=>t.itinerary.days[0].day='<img src=x>',t=>t.itinerary.days[0].activities=[null],t=>t.request.costSettings=null,t=>t.budgetAudit.total=NaN]){
    const copy=structuredClone(trip);patch(copy);assert.equal(validTrip(copy),false);
  }
});
test('guide history tolerates empty entries and requires object requests',()=>{
  const t=makeDemo(request);
  assert.ok(guidePrompt({mode:'ask',question:'Ăn gì?',request:t.request,itinerary:t.itinerary,history:[null,{role:'user',content:'hello'}]}).prompt);
  assert.throws(()=>guidePrompt(null),/đối tượng JSON/);
});
test('edit prompt has one valid outer JSON schema and preserves the requested day count',()=>{
  const t=makeDemo(request),prompt=guidePrompt({mode:'edit',question:'Đổi thành 4 ngày',request:t.request,itinerary:t.itinerary}).prompt;
  assert.equal(prompt.split('Trả duy nhất JSON theo mẫu').length-1,1);
  const example=JSON.parse(prompt.split('Trả duy nhất JSON theo mẫu ')[1].split('. Tạo BẢN')[0]);
  assert.ok(example.answer);assert.ok(example.itinerary.days);assert.deepEqual(example.requestPatch,{});
  assert.ok(prompt.includes('requestPatch.days'));
});
