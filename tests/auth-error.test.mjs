import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server.mjs';
import {memoryStore} from '../backend/store.mjs';

test('Firebase verification outages return 503 while expired and invalid tokens remain 401', async () => {
  let failure;
  const app = await createApp({env:{}, store:memoryStore(), verifyToken:async()=>{throw failure;}});
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  try {
    for (const [code,message,status] of [
      ['auth/argument-error','Error while making request: getaddrinfo EACCES private-host',503],
      ['app/network-error','private credential detail',503],
      ['auth/internal-error','private server detail',503],
      ['auth/id-token-expired','expired token secret',401],
      ['auth/id-token-revoked','revoked token secret',401],
      ['auth/argument-error','Invalid token signature secret',401]
    ]) {
      failure=Object.assign(new Error(message),{code});
      const response=await fetch(`http://127.0.0.1:${app.server.address().port}/api/me`,{headers:{Authorization:'Bearer test-token'}});
      const body=await response.json();
      assert.equal(response.status,status);
      assert.equal(body.code,status===503?'AUTH_SERVICE_UNAVAILABLE':'AUTH_INVALID');
      assert(!JSON.stringify(body).includes(message));
      assert(!JSON.stringify(body).includes('test-token'));
    }
  } finally { await new Promise(resolve=>app.server.close(resolve)); }
});
