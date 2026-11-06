import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {validTrip} from '../frontend/core.js';

export async function checkLive({base='http://localhost:3000',ai=false,token='',fetchImpl=fetch,wait=ms=>new Promise(r=>setTimeout(r,ms)),log=console.log}={}) {
  async function request(path,body) {
    const res=await fetchImpl(base+path,{headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json','Idempotency-Key':randomUUID()}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});
    const data=await res.json();
    if(!res.ok)throw Error(path+': HTTP '+res.status+' · '+(data.code||'REQUEST_FAILED')+' · '+(data.error||'Invalid response'));
    return data;
  }
  async function job(path,body) {
    const pending=await request(path,body);
    if(!pending.jobId)throw Error('Backend did not return a jobId.');
    const deadline=Date.now()+180000;
    while(Date.now()<deadline) {
      const result=await request('/api/jobs/'+encodeURIComponent(pending.jobId));
      if(result.state==='succeeded')return result.result;
      if(['failed','unknown','cancelled'].includes(result.state))throw Error('Job '+result.state+' · '+(result.code||'JOB_FAILED')+' · '+(result.error||'Check saved trips and n8n Executions before retrying.'));
      await wait(2000);
    }
    throw Error('Job is still pending. Check saved trips before retrying; do not start another AI check yet.');
  }
  const config=await request('/api/config'),health=await request('/api/health');
  if(!config.backendReady)throw Error('Firebase backend not configured. Demo remains available.');
  if(!config.n8nConfigured)throw Error('n8n webhook URLs not configured.');
  if(!health.ok)throw Error('Backend health check failed.');
  log(JSON.stringify({check:'server',storage:health.storage,configured:config.configured}));
  if(!ai)return;
  if(!token)throw Error('Set FIREBASE_ID_TOKEN to a signed-in Firebase user ID token for --ai. This check saves one tour and uses account AI quota; no email is sent.');
  await request('/api/trips');
  const trip=await job('/api/trip',{destination:{name:'Đà Nẵng'},days:2,people:2,budget:8000000,transport:'Ô tô',interests:['Thiên nhiên'],pace:'Cân bằng',sendEmail:false,costSettings:{arrivalKnown:true,arrivalPerPerson:1000000}});
  if(!validTrip(trip)||trip.schemaVersion!==3||trip.emailSent||!trip.tripId)throw Error('Invalid v3 itinerary or unexpected email status');
  log(JSON.stringify({check:'AI generation',schemaVersion:trip.schemaVersion,days:trip.itinerary.days.length,total:trip.budgetAudit.total,emailSent:trip.emailSent}));
  const edit=await job('/api/guide',{tripId:trip.tripId,mode:'edit',question:'Giảm ngân sách 1 triệu đồng, giữ số ngày và số người. Ưu tiên hoạt động rẻ hơn nếu cần.',desiredChanges:{budget:trip.request.budget-1000000}});
  if(!validTrip(edit.proposal)||edit.proposal.request.budget!==trip.request.budget-1000000||edit.proposal.emailSent||!edit.proposalId)throw Error('Invalid editing proposal');
  log(JSON.stringify({check:'AI editing',budget:edit.proposal.request.budget,total:edit.proposal.budgetAudit.total,emailSent:edit.proposal.emailSent}));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try{await checkLive({base:process.env.CHECK_BASE_URL||'http://localhost:3000',ai:process.argv.includes('--ai'),token:process.env.FIREBASE_ID_TOKEN||''});}
  catch(e){console.error(e.message);process.exitCode=1;}
}
