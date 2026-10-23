import {test} from 'node:test';import assert from 'node:assert/strict';
import {n8nForward} from '../backend/n8n-client.mjs';
import {createService} from '../backend/service.mjs';import {memoryStore} from '../backend/store.mjs';
const env={N8N_TRIP_URL:'https://example.test/webhook/trip'};
test('HTML gateway failure has a precise safe message and uncertain outcome',async()=>{
 await assert.rejects(n8nForward(env,async()=>new Response('<html>private gateway diagnostics</html>',{status:502}))('trip',{}),e=>e.status===502&&e.code==='N8N_GATEWAY_ERROR'&&e.uncertain===true&&e.message.includes('502')&&!e.message.includes('private'));
});
test('valid JSON errors survive; empty successful replies stay uncertain',async()=>{
 assert.deepEqual(await n8nForward(env,async()=>Response.json({error:'Invalid input',code:'INVALID_INPUT'},{status:400}))('trip',{}),{status:400,data:{error:'Invalid input',code:'INVALID_INPUT'}});
 await assert.rejects(n8nForward(env,async()=>new Response(''))('trip',{}),e=>e.code==='N8N_INVALID_RESPONSE'&&e.uncertain);
 const r=await n8nForward(env,async()=>Response.json({message:'secret internal details'},{status:500}))('trip',{});assert.equal(r.data.code,'N8N_EXECUTION_ERROR');assert(!r.data.error.includes('secret'));
});
test('gateway failure remains unknown and the same idempotency key never retries n8n',async()=>{
 const store=memoryStore();let calls=0;
 const service=createService({store,forward:n8nForward(env,async()=>{calls++;return new Response('<html>502</html>',{status:502});})});
 try{const body={destination:'Đà Lạt',days:1,people:1,budget:3000000};const first=await service.start('alice','generate',body,'gateway-test-key');let job;
 for(let i=0;i<100;i++){job=await service.getJob('alice',first.jobId);if(job.state==='unknown')break;await new Promise(r=>setTimeout(r,5));}
 assert.equal(job.state,'unknown');assert.equal(job.code,'N8N_GATEWAY_ERROR');assert.equal(job.status,502);
 assert.equal((await service.start('alice','generate',body,'gateway-test-key')).state,'unknown');assert.equal(calls,1);
 }finally{service.close();}
});
