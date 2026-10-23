import test from 'node:test';import assert from 'node:assert/strict';
import {normalizeRequest,planBudget} from '../frontend/tour-engine.js';import {makeDemo} from '../frontend/core.js';import {memoryStore} from '../backend/store.mjs';import {createService} from '../backend/service.mjs';
const request={destination:'Đà Nẵng',days:3,people:2,budget:15000000,transport:'Ô tô',pace:'Cân bằng',interests:[],costSettings:{arrivalPerPerson:1500000,activitiesPerPersonDay:150000}};
test('round-trip costs scale by people and ticket envelope never double-counts itemized tickets',()=>{
  const r=normalizeRequest(request),a=planBudget(r,0),b=planBudget(r,500000),c=planBudget(r,1200000);
  assert.equal(a.breakdown.arrival,3000000);assert.equal(a.breakdown.activities,900000);assert.equal(b.breakdown.activities,900000);assert.equal(b.activityBuffer,400000);assert.equal(c.breakdown.activities,1200000);assert.equal(c.activityBuffer,0);
  const old=normalizeRequest({...request,costSettings:{arrivalPerPerson:0}});assert.equal(planBudget(old).breakdown.activities,0);
});
test('server preserves planning envelope when original n8n v3 drops new fields',async()=>{
  const store=memoryStore();const service=createService({store,forward:async(kind,b)=>{const legacy=structuredClone(b);delete legacy.costSettings.activitiesPerPersonDay;const t=makeDemo(legacy);for(const d of t.itinerary.days)for(const a of d.activities)a.cost=0;return {status:200,data:t};}});
  const j=await service.start('alice','generate',request,'ticket-generation-key');await service.waitIdle();const result=await service.getJob('alice',j.jobId);assert.equal(result.state,'succeeded');assert.equal(result.result.budgetAudit.breakdown.activities,900000);assert.equal(result.result.budgetAudit.activityBuffer,900000);
  await assert.rejects(service.email('alice',result.result.tripId,0,'test@example.com'),e=>e.code==='UNALLOCATED_TICKET_ESTIMATE');service.close();
});
test('ticket edits are ownership/revision protected proposals and do not change room rates',async()=>{
  const store=memoryStore(),service=createService({store,forward:async()=>{throw Error('No AI expected');}});
  const tour=await service.importTrip('alice',makeDemo({...request,costSettings:{arrivalPerPerson:0}}),'ticket-import-key');
  const p=await service.budgetProposal('alice',tour.tripId,0,{arrivalPerPerson:2000000,arrivalKnown:true,activitiesPerPersonDay:200000});
  assert.equal((await service.trip('alice',tour.tripId)).budgetAudit.breakdown.arrival,0);
  assert.equal(p.proposal.request.costSettings.roomPerNight,tour.request.costSettings.roomPerNight);
  await assert.rejects(service.budgetProposal('bob',tour.tripId,0,{arrivalPerPerson:1}),e=>e.status===404);
  await assert.rejects(service.budgetProposal('alice',tour.tripId,0,{roomPerNight:0}),e=>e.status===400);
  await assert.rejects(service.budgetProposal('alice',tour.tripId,0,{activitiesPerPersonDay:-1}),e=>e.status===400);
  await service.apply('alice',tour.tripId,p.proposalId,0,true);const changed=await service.trip('alice',tour.tripId);assert.equal(changed.budgetAudit.breakdown.arrival,4000000);
  await assert.rejects(service.budgetProposal('alice',tour.tripId,0,{arrivalPerPerson:1}),e=>e.status===409);await service.undo('alice',tour.tripId,1);assert.equal((await service.trip('alice',tour.tripId)).budgetAudit.breakdown.arrival,0);service.close();
});
