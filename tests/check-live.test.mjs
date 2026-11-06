import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
import {memoryStore} from '../backend/store.mjs';
import {makeDemo} from '../frontend/core.js';
import {checkLive} from '../scripts/check-live.mjs';

test('live checker follows authenticated async jobs and validates edit proposals without sending email',async()=>{
  const calls=[];
  const app=await createApp({store:memoryStore(),env:{N8N_TRIP_URL:'configured',N8N_GUIDE_URL:'configured'},verifyToken:async token=>{assert.equal(token,'test-token');return {uid:'live-check'};},forward:async(kind,body)=>{
    calls.push({kind,body});
    if(kind==='trip')return {status:200,data:makeDemo(body)};
    return {status:200,data:{answer:'Đã giảm ngân sách.',sources:[],proposal:makeDemo({...body.request,budget:7000000})}};
  }});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+app.server.address().port;
  try {
    const logs=[];
    await assert.rejects(checkLive({base,ai:true,log:()=>{}}),/FIREBASE_ID_TOKEN/);
    assert.equal(calls.length,0);
    await checkLive({base,ai:true,token:'test-token',wait:()=>new Promise(r=>setTimeout(r,5)),log:x=>logs.push(JSON.parse(x))});
    assert.deepEqual(logs.map(x=>x.check),['server','AI generation','AI editing']);
    assert.equal(calls.length,2);
    assert.equal(calls[0].body.sendEmail,false);
    assert.equal(calls[1].body.mode,'edit');
    assert.equal(logs[2].budget,7000000);
  } finally {await new Promise(r=>app.server.close(r));}
});

test('live checker stops on uncertain jobs without retrying generation',async()=>{
  let posts=0;
  await assert.rejects(checkLive({ai:true,token:'test',log:()=>{},fetchImpl:async(url,options)=>{
    if(url.endsWith('/api/config'))return Response.json({backendReady:true,n8nConfigured:true});
    if(url.endsWith('/api/health'))return Response.json({ok:true});
    if(url.endsWith('/api/trips'))return Response.json({trips:[]});
    if(options.method==='POST'){posts++;return Response.json({jobId:'test-job'},{status:202});}
    return Response.json({state:'unknown',code:'N8N_GATEWAY_ERROR',error:'Check execution'});
  }}),/unknown.*N8N_GATEWAY_ERROR/);
  assert.equal(posts,1);
});
