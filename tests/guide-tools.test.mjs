import test from 'node:test';import assert from 'node:assert/strict';
import {guideQuestions,tripChanges,voicePreferences} from '../frontend/guide-tools.js';
import {makeDemo} from '../frontend/core.js';
import {memoryStore} from '../backend/store.mjs';import {createService} from '../backend/service.mjs';import {createApp} from '../server.mjs';
const request={destination:'Đà Nẵng',days:3,people:2,budget:8000000,interests:['Ẩm thực'],transport:'Ô tô'};
test('guide questions adapt to day/mode and preview lists only actual changes',()=>{
  const t=makeDemo(request),p=structuredClone(t);p.request.people=4;p.itinerary.days[1].activities[0].name='Điểm khác';
  assert(guideQuestions(t,2).some(q=>q.question.includes('ngày 2')));
  assert(guideQuestions(t,2,true).some(q=>q.question.includes('Thay điểm ngày 2')));
  const changes=tripChanges(t,p);assert(changes.some(c=>c.includes('Số người: 2 → 4')));assert(changes.some(c=>c.includes('Điểm khác')));assert(!changes.some(c=>c.startsWith('Ngày 1')));
  assert.deepEqual(voicePreferences('null'),{rate:0.95,autoSpeak:true,voiceURI:''});assert.equal(voicePreferences('{"rate":100}').rate,0.95);
});
test('stored conversation restores chronological latest 40 and enforces ownership over HTTP',async()=>{
  const store=memoryStore(),service=createService({store,forward:async()=>{throw Error('No AI needed');}});
  const tour=await service.importTrip('alice',makeDemo(request),'conversation-import');
  await store.transaction(async tx=>{for(let i=0;i<46;i++)tx.set(`trips/${tour.tripId}/messages/m${String(i).padStart(2,'0')}`,{role:i%2?'assistant':'user',text:'Message '+i,createdAt:new Date(1700000000000+i*1000).toISOString(),privateField:'must not leak'});});
  const restored=await service.messages('alice',tour.tripId);assert.equal(restored.messages.length,40);assert.equal(restored.messages[0].text,'Message 6');assert.equal(restored.messages.at(-1).text,'Message 45');assert(!JSON.stringify(restored).includes('must not leak'));
  await assert.rejects(service.messages('bob',tour.tripId),e=>e.status===404);
  const app=await createApp({store,verifyToken:async token=>({uid:token}),env:{}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${app.server.address().port}/api/trips/${tour.tripId}/messages`;
  try{assert.equal((await fetch(base)).status,401);assert.equal((await fetch(base,{headers:{Authorization:'Bearer bob'}})).status,404);const r=await fetch(base,{headers:{Authorization:'Bearer alice'}});assert.equal(r.status,200);assert.equal((await r.json()).messages.length,40);}
  finally{service.close();await new Promise(r=>app.server.close(r));}
});
test('structured guide edits pass exact normalized values to n8n and remain proposals',async()=>{
  const store=memoryStore(),service=createService({store,forward:async(kind,b)=>{
    assert.match(b.question,/"people":4/);assert.match(b.question,/"pace":"Thư thả"/);
    const p=makeDemo({...b.request,people:4,pace:'Thư thả',transport:'Xe máy',interests:['Thiên nhiên']});return {status:200,data:{answer:'Đề xuất',proposal:p}};
  }});
  const tour=await service.importTrip('alice',makeDemo(request),'structured-import');
  const job=await service.start('alice','guide',{tripId:tour.tripId,mode:'edit',question:'Chỉnh theo các giá trị tôi đã chọn',desiredChanges:{people:4,pace:'Thư thả',transport:'Xe máy',interests:['Thiên nhiên']}},'structured-guide-key');await service.waitIdle();
  const result=await service.getJob('alice',job.jobId);assert.equal(result.state,'succeeded');assert.equal(result.result.proposal.request.people,4);assert.equal((await service.trip('alice',tour.tripId)).request.people,2);service.close();
});
