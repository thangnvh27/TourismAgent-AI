import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDemo} from '../frontend/core.js';
import {finalizeTrip,normalizeRequest} from '../frontend/tour-engine.js';
import {guideEditSummary,tripChanges,compactAnswer} from '../frontend/guide-tools.js';
import {memoryStore} from '../backend/store.mjs';
import {createService} from '../backend/service.mjs';

function fixture() {
  const request=normalizeRequest({destination:'Đà Nẵng',days:3,people:2,budget:8000000,transport:'Ô tô',interests:['Thiên nhiên'],costSettings:{arrivalKnown:true,arrivalPerPerson:1500000,activitiesPerPersonDay:150000}});
  const itinerary=makeDemo(request).itinerary;
  for(const day of itinerary.days)for(const activity of day.activities)activity.cost=0;
  return finalizeTrip(request,itinerary,{schemaVersion:3,revision:0});
}
test('edit summary leads with recomputed shortfall and distinguishes description edits from route changes',()=>{
  const before=fixture(),request=normalizeRequest({...before.request,budget:7000000});
  const itinerary=structuredClone(before.itinerary);itinerary.days[0].activities[0].description+=' Mang nước uống.';
  const proposal=finalizeTrip(request,itinerary,{schemaVersion:3,revision:1});
  assert.equal(proposal.budgetAudit.total,7900000);
  const summary=guideEditSummary(before,proposal),preview=compactAnswer(summary).preview;
  assert.match(preview,/Chưa đạt ngân sách/);assert.match(preview,/900\.000/);assert.match(preview,/7\.900\.000/);
  assert.match(summary,/chưa thể gửi email/);assert.match(summary,/Giữ nguyên các đơn giá/);
  assert(tripChanges(before,proposal).some(x=>x.includes('giữ nguyên điểm đến, giờ và chi phí')));
  assert.equal(before.request.budget,8000000);
});
test('in-budget and fixed-cost cases describe feasibility without promising verified prices',()=>{
  const before=fixture();
  const under=finalizeTrip(normalizeRequest({...before.request,budget:12000000}),before.itinerary,{schemaVersion:3});
  assert.match(guideEditSummary(before,under),/^Trong ngân sách dự kiến/);
  const low=finalizeTrip(normalizeRequest({...before.request,budget:5000000}),before.itinerary,{schemaVersion:3});
  assert.match(guideEditSummary(before,low),/Chỉ bỏ hoạt động chưa đủ/);
});
test('guide stores and returns factual edit summary instead of misleading model claims, without applying it',async()=>{
  const store=memoryStore();
  const service=createService({store,forward:async(kind,body)=>({status:200,data:{answer:'Đã đổi các điểm tham quan và đủ ngân sách!',proposal:{request:{...body.request,budget:7000000},itinerary:body.itinerary}}})});
  try {
    const before=await service.importTrip('alice',fixture(),'guide-summary-import');
    const job=await service.start('alice','guide',{tripId:before.tripId,mode:'edit',question:'Giảm ngân sách 1 triệu',desiredChanges:{budget:7000000}},'guide-summary-job');
    await service.waitIdle();const result=await service.getJob('alice',job.jobId);
    assert.equal(result.state,'succeeded');assert.equal(result.result.proposal.budgetAudit.total,7900000);
    assert.match(result.result.answer,/Chưa đạt ngân sách/);assert(!result.result.answer.includes('Đã đổi các điểm tham quan'));
    const messages=await service.messages('alice',before.tripId);
    assert.equal(messages.messages.at(-1).text,result.result.answer);
    assert.deepEqual(await service.trip('alice',before.tripId),before);
    assert.equal(result.result.proposal.emailSent,false);
  } finally { service.close(); }
});
