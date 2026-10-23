import {requestJSON} from './request.js';
let config=null,auth=null,sdk=null,user=null,initial=null;
const listeners=new Set();
export async function accountConfig(){if(!config){const {response,data}=await requestJSON('/api/config');if(!response.ok)throw Error(data.error||'Không đọc được cấu hình server.');config=data;}return config;}
export async function initAccount(){
  if(initial)return initial;
  initial=(async()=>{const c=await accountConfig();if(!c.backendReady)return null;
    let appModule,authModule;try{[appModule,authModule]=await Promise.all([import('https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js'),import('https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js')]);}catch(cause){throw Object.assign(Error('Không tải được thư viện đăng nhập Firebase. Kiểm tra mạng hoặc chặn truy cập www.gstatic.com.'),{code:'FIREBASE_SDK_UNREACHABLE',cause});}
    sdk=authModule;auth=sdk.getAuth(appModule.initializeApp(c.firebaseConfig));
    await new Promise(resolve=>{let first=true;sdk.onAuthStateChanged(auth,next=>{user=next;for(const fn of listeners)fn(next);if(first){first=false;resolve();}});});return auth;})();
  try{return await initial;}catch(e){initial=null;throw e;}
}
export function onAccountChange(fn){listeners.add(fn);return ()=>listeners.delete(fn);}
export function currentUser(){return user;}
export async function authHeaders(){await initAccount();if(!user)throw Error('Đăng nhập để dùng AI và lưu tour trên Firebase.');try{return {Authorization:'Bearer '+await user.getIdToken()};}catch(cause){if(cause.code==='auth/network-request-failed')throw Object.assign(Error('Không kết nối được Firebase để xác nhận đăng nhập. Kiểm tra mạng trước khi tạo lịch trình.'),{code:'FIREBASE_AUTH_UNREACHABLE',cause});throw cause;}}
export async function signInGoogle(){await initAccount();if(!auth)throw Error('Chưa cấu hình Firebase. Xem hướng dẫn cài đặt backend.');return sdk.signInWithPopup(auth,new sdk.GoogleAuthProvider());}
export async function signInEmail(email,password,register=false){await initAccount();if(!auth)throw Error('Chưa cấu hình Firebase.');const result=await (register?sdk.createUserWithEmailAndPassword(auth,email,password):sdk.signInWithEmailAndPassword(auth,email,password));if(register)try{await sdk.sendEmailVerification(result.user);}catch{/* Account created; user can request verification again. */}return result;}
export async function signOut(){if(auth)await sdk.signOut(auth);}
export async function backendApi(path,body,options={}){
  const headers=await authHeaders();headers['Content-Type']='application/json';
  const isJob=body&&(['/api/trip','/api/trips','/api/guide'].includes(path)||path.endsWith('/guide'));
  let pending=null,storageKey=null;
  if(isJob){storageKey='vietjourney-job:'+user.uid+':'+path;const bytes=new TextEncoder().encode(JSON.stringify(body));const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');try{const old=JSON.parse(localStorage.getItem(storageKey)||'null');if(old?.hash===digest)pending=old;}catch{}pending??={key:crypto.randomUUID(),hash:digest};try{localStorage.setItem(storageKey,JSON.stringify(pending));}catch{}}
  if(options.key||body)headers['Idempotency-Key']=options.key||pending?.key||crypto.randomUUID();
  const forget=()=>{if(storageKey)try{localStorage.removeItem(storageKey);}catch{}};
  const resuming=Boolean(isJob&&pending?.jobId);
  let {response:r,data}=await requestJSON(resuming?'/api/jobs/'+encodeURIComponent(pending.jobId):path,resuming?{headers,signal:AbortSignal.timeout(15000)}:{method:options.method|| (body?'POST':'GET'),headers,...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(135000)});
  if(!r.ok){if(r.status<500)forget();throw Object.assign(Error(data.error||'Không hoàn thành được yêu cầu.'),{code:data.code,status:r.status});}
  if((r.status===202||resuming)&&data.jobId){const jobId=data.jobId;if(pending)try{localStorage.setItem(storageKey,JSON.stringify({...pending,jobId}));}catch{}let delay=1800;const until=Date.now()+155000;while(Date.now()<until){await new Promise(resolve=>setTimeout(resolve,delay));({response:r,data}=await requestJSON('/api/jobs/'+encodeURIComponent(jobId),{headers:await authHeaders(),signal:AbortSignal.timeout(15000)}));if(!r.ok||['failed','unknown'].includes(data.state)){if(data.state==='failed')forget();throw Object.assign(Error(data.error||'Công việc bị gián đoạn.'),{code:data.code,status:data.status,state:data.state});}if(data.state==='succeeded'){const result=data.result;forget();if(data.emailRequested&&result?.tripId&&body?.email){try{const delivery=await backendApi('/api/email',{tripId:result.tripId,expectedRevision:result.revision,email:body.email});result.emailStatus=delivery.emailStatus;}catch(e){result.emailStatus=e.code==='UNALLOCATED_TICKET_ESTIMATE'?'requires_ticket_allocation':'unknown';result.emailError=e.message;}}return result;}delay=Math.min(6000,delay+800);}throw Error('Công việc vẫn đang xử lý. Mở tour đã lưu để kiểm tra, không tạo lại ngay.');}
  if(data.error)throw Error(data.error);return data;
}
