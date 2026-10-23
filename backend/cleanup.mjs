import {readFile} from 'node:fs/promises';import {resolve} from 'node:path';
import {parseEnv} from '../scripts/env.mjs';import {firebaseStore} from './store.mjs';
try{for(const [k,v]of Object.entries(parseEnv(await readFile(resolve('.env'),'utf8'))))if(!process.env[k])process.env[k]=v;}catch(e){if(e.code!=='ENOENT')throw e;}
if(!process.env.FIREBASE_PROJECT_ID)throw Error('Set FIREBASE_PROJECT_ID first.');
const {db}=await firebaseStore(process.env.FIREBASE_PROJECT_ID),apply=process.argv.includes('--apply');
const limit=Math.min(500,Math.max(1,Number(process.env.CLEANUP_BATCH_LIMIT)||100)),cutoff=days=>new Date(Date.now()-days*86400000).toISOString();let inspected=0,changed=0;
// Bounded passes; run again later for backlogs. Dry-run by default. No TTL/billing required.
const proposals=await db.collectionGroup('proposals').where('snapshotState','==','full').where('createdAt','<',cutoff(1)).limit(limit).get();
for(const d of proposals.docs){inspected++;changed++;if(apply)await db.runTransaction(async tx=>{const s=await tx.get(d.ref),p=s.data();if(!p||p.createdAt>=cutoff(1))return;delete p.candidate;delete p.before;p.snapshotState='receipt';if(p.status==='pending')p.status='expired';tx.set(d.ref,p);});}
const messages=await db.collectionGroup('messages').where('createdAt','<',cutoff(7)).limit(limit).get();
for(const d of messages.docs){inspected++;changed++;if(apply)await d.ref.delete();}
const jobs=await db.collection('jobs').where('requestRetained','==',true).where('createdAt','<',cutoff(7)).limit(limit).get();
for(const d of jobs.docs){inspected++;const j=d.data();if(['queued','running'].includes(j.state))continue;changed++;if(apply)await d.ref.update({request:{},requestRetained:false});}
const receipts=await db.collection('jobs').where('createdAt','<',cutoff(30)).limit(limit).get();
for(const d of receipts.docs){inspected++;if(['queued','running'].includes(d.data().state))continue;changed++;if(apply)await d.ref.delete();}
const mails=await db.collection('mailJobs').where('createdAt','<',cutoff(30)).limit(limit).get();
for(const d of mails.docs){inspected++;if(d.data().status==='sending')continue;changed++;if(apply)await d.ref.delete();}
// Tours are user data: retain unless user chooses deletion. This pass reports old tours only.
const oldTours=await db.collection('trips').where('updatedAt','<',cutoff(30)).limit(limit).get();
console.log(JSON.stringify({dryRun:!apply,inspected,changes:changed,oldToursRetained:oldTours.size,limit,notice:'Tour deletion is explicit via API; storage still grows with retained tours. Each pass uses reads/deletes/writes.'}));
