import { validTrip } from '../frontend/core.js';
const base = 'http://localhost:3000';
const post = async (path, body) => {
  const res = await fetch(base + path, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body), signal:AbortSignal.timeout(120000) });
  const data = await res.json();
  if (!res.ok) throw new Error(path + ': HTTP ' + res.status + ' · ' + (data.error || data.message || 'Invalid response'));
  return data;
};
const config = await (await fetch(base + '/api/config')).json();
if (!config.configured) throw new Error('Webhook URLs not configured');
if (!process.argv.includes('--ai')) { console.log('Server configured. Pass --ai to test generation and editing (no email).'); process.exit(0); }
const trip = await post('/api/trip', {destination:{name:'Đà Nẵng'},days:2,people:2,budget:8000000,transport:'Ô tô',interests:['Thiên nhiên'],pace:'Cân bằng',sendEmail:false,costSettings:{arrivalKnown:true,arrivalPerPerson:1000000}});
if (!validTrip(trip) || trip.schemaVersion !== 3 || trip.emailSent) throw new Error('Invalid v3 itinerary or unexpected email status');
console.log(JSON.stringify({check:'AI generation',schemaVersion:trip.schemaVersion,days:trip.itinerary.days.length,total:trip.budgetAudit.total,emailSent:trip.emailSent}));
const edit = await post('/api/guide',{mode:'edit',question:'Giảm ngân sách đúng 1 triệu đồng, giữ số ngày và số người. Ưu tiên hoạt động rẻ hơn nếu cần.',request:trip.request,itinerary:trip.itinerary,revision:trip.revision||0});
if (!validTrip(edit.proposal) || edit.proposal.request.budget !== trip.request.budget-1000000 || edit.proposal.emailSent) throw new Error('Invalid editing proposal');
console.log(JSON.stringify({check:'AI editing',budget:edit.proposal.request.budget,total:edit.proposal.budgetAudit.total,emailSent:edit.proposal.emailSent}));
