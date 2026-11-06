import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
import {memoryStore} from '../backend/store.mjs';
import {makeDemo} from '../frontend/core.js';

test('configured daily limit allows 30 requests, preserves existing usage and blocks request 31',async()=>{
  const store=memoryStore();
  const day=new Date().toISOString().slice(0,10);
  await store.transaction(async tx=>tx.set(`users/test-user/usage/${day}`,{generate:3,guide:7,email:1}));
  const app=await createApp({env:{DAILY_GENERATE_LIMIT:'30'},store,verifyToken:async()=>({uid:'test-user'}),forward:async(kind,body)=>({status:200,data:makeDemo(body)})});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+app.server.address().port;
  const request={destination:'Đà Nẵng',days:2,people:2,budget:8000000};
  try {
    for(let n=4;n<=31;n++){
      const res=await fetch(base+'/api/trip',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer test','Idempotency-Key':'quota-request-'+n},body:JSON.stringify(request)});
      assert.equal(res.status,n<=30?202:429,'request '+n);
      if(n===31)assert.equal((await res.json()).code,'DAILY_LIMIT');
      await app.service.waitIdle();
    }
    const usage=await store.get(`users/test-user/usage/${day}`);
    assert.equal(usage.generate,30);assert.equal(usage.guide,7);assert.equal(usage.email,1);
    assert.equal((await app.service.start('test-user','generate',request,'quota-request-30')).state,'succeeded');
  } finally {await new Promise(r=>app.server.close(r));}
});

test('missing or invalid daily generation configuration keeps the default limit',async()=>{
  for(const value of [undefined,'invalid','0','-1','1.5']){
    const app=await createApp({env:{DAILY_GENERATE_LIMIT:value},store:memoryStore(),forward:async(kind,body)=>({status:200,data:makeDemo(body)})});
    try {
      for(let n=0;n<3;n++)await app.service.start('test-user','generate',{destination:'Đà Nẵng',days:2,people:2,budget:8000000},'default-quota-'+n);
      await assert.rejects(app.service.start('test-user','generate',{},'default-quota-next'),e=>e.code==='DAILY_LIMIT');
      await app.service.waitIdle();
    } finally {app.service.close();}
  }
});
