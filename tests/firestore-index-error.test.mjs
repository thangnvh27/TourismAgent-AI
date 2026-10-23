import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
import {memoryStore} from '../backend/store.mjs';
test('missing Firestore composite index returns actionable safe error',async()=>{
  const store=memoryStore();
  const query=store.query;
  store.query=async(c,o)=>{
    if(c==='trips')throw Object.assign(new Error('9 FAILED_PRECONDITION: The query requires an index. Internal URL must stay private.'),{code:9});
    return query(c,o);
  };
  const {server}=await createApp({store,verifyToken:async()=>({uid:'alice'}),env:{}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/trips`,{headers:{Authorization:'Bearer test'}});
    const body=await response.json();
    assert.equal(response.status,503);
    assert.equal(body.code,'FIRESTORE_INDEX_REQUIRED');
    assert.match(body.error,/Firestore.*chỉ mục/);
    assert(!JSON.stringify(body).includes('Internal URL'));
  }finally{await new Promise(r=>server.close(r));}
});
