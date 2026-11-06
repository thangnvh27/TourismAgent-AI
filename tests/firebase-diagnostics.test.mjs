import test from 'node:test';
import assert from 'node:assert/strict';
import {checkFirebaseQueries} from '../scripts/firebase-diagnostics.mjs';

test('Firebase readiness includes every recovery query and reports missing indexes without leaking internal errors',async()=>{
  const calls=[];
  const report=await checkFirebaseQueries({query:async(c,o)=>{calls.push({c,o});if(c!=='trips')throw Object.assign(Error('The query requires an index. Private URL'),{code:9});return [];}});
  assert.equal(report.ready,false);
  assert.equal(calls.length,4);
  assert.equal(calls[0].o.orderBy,'updatedAt');
  assert.equal(calls[1].o.where[0][2],'queued');
  assert.equal(calls[2].o.desc,false);
  assert.equal(calls[3].c,'mailJobs');
  assert.equal(report.checks.filter(c=>c.code==='FIRESTORE_INDEX_REQUIRED').length,3);
  assert(!JSON.stringify(report).includes('Private URL'));
  assert.equal((await checkFirebaseQueries({query:async()=>[]})).ready,true);
});
