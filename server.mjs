import {n8nForward} from './backend/n8n-client.mjs';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,relative,extname,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {parseEnv} from './scripts/env.mjs';
import {firebaseStore} from './backend/store.mjs';
import {createService,ApiError} from './backend/service.mjs';
import {authFailure} from './backend/auth-error.mjs';
const root=dirname(fileURLToPath(import.meta.url));
export async function createApp({env=process.env,store,verifyToken,forward}={}){
  const firebaseConfig={projectId:env.FIREBASE_PROJECT_ID||'',apiKey:env.FIREBASE_WEB_API_KEY||'',authDomain:env.FIREBASE_AUTH_DOMAIN||'',appId:env.FIREBASE_WEB_APP_ID||''};
  const configured=!!store||!!(firebaseConfig.projectId&&firebaseConfig.apiKey&&firebaseConfig.authDomain&&(env.GOOGLE_APPLICATION_CREDENTIALS||env.FIREBASE_USE_ADC==='true'));
  if(configured&&!store)store=await firebaseStore(firebaseConfig.projectId);
  verifyToken??=store?.verifyToken;
  const n8nReady=Boolean(env.N8N_TRIP_URL&&env.N8N_GUIDE_URL);
  const proxy=forward||n8nForward(env);
  const requestedGenerateLimit=Number(env.DAILY_GENERATE_LIMIT||3);
  const generateLimit=Number.isSafeInteger(requestedGenerateLimit)&&requestedGenerateLimit>0?requestedGenerateLimit:3;
  const service=store?createService({store,forward:proxy,limits:{generate:generateLimit,guide:20,email:3}}):null;if(service)service.schedule();
  const rate=new Map(),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png'};
  const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
  const server=http.createServer(async(req,res)=>{
    try{
      const url=new URL(req.url,'http://localhost'),path=url.pathname;
      if(path==='/api/config'&&req.method==='GET')return json(res,200,{configured:configured&&n8nReady,backendReady:configured,authRequired:true,firebaseConfig:configured?firebaseConfig:null,n8nConfigured:n8nReady});
      if(path==='/api/health'&&req.method==='GET')return json(res,200,{ok:true,storage:store?.kind||'not-configured'});
      if(path.startsWith('/api/')){
        if(!service)return json(res,503,{code:'FIREBASE_SETUP_REQUIRED',error:'Chưa cấu hình Firebase. Chế độ demo vẫn hoạt động.'});
        const address=req.socket.remoteAddress||'unknown',now=Date.now();for(const [k,v]of rate)if(v.until<=now)rate.delete(k);const count=rate.get(address)||{n:0,until:now+60000};if(++count.n>120)return json(res,429,{code:'RATE_LIMIT',error:'Quá nhiều yêu cầu. Thử lại sau một phút.'});rate.set(address,count);
        if(req.headers.origin){let origin;try{origin=new URL(req.headers.origin);}catch{return json(res,403,{code:'INVALID_ORIGIN',error:'Origin không hợp lệ.'});}if(origin.host!==req.headers.host)return json(res,403,{code:'INVALID_ORIGIN',error:'Origin không hợp lệ.'});}
        const match=String(req.headers.authorization||'').match(/^Bearer (\S+)$/);if(!match)return json(res,401,{code:'AUTH_REQUIRED',error:'Đăng nhập để dùng AI và lưu tour.'});let user;try{user=await verifyToken(match[1]);if(!/^[a-zA-Z0-9_:@.-]{1,128}$/.test(user.uid||''))throw Error();}catch(e){const failure=authFailure(e);return json(res,failure.status,{code:failure.code,error:failure.error});}
        const uid=user.uid;let body={};if(['POST','PATCH','DELETE'].includes(req.method)){
          if(!String(req.headers['content-type']||'').startsWith('application/json'))return json(res,415,{error:'Cần gửi JSON.'});let bytes=0,chunks=[];for await(const c of req){bytes+=c.length;if(bytes<=512*1024)chunks.push(c);}if(bytes>512*1024)return json(res,413,{error:'Yêu cầu vượt 512 KiB.'});try{body=JSON.parse(Buffer.concat(chunks).toString()||'{}');if(!body||typeof body!=='object'||Array.isArray(body))throw Error();}catch{return json(res,400,{error:'JSON không hợp lệ.'});}
        }
        const key=String(req.headers['idempotency-key']||'');let result,status=200;
        if(path==='/api/me'&&['GET','PATCH'].includes(req.method))result=await service.profile(uid,req.method==='PATCH'?body:null);
        else if(path==='/api/trips'&&req.method==='GET')result=await service.list(uid,url.searchParams.get('cursor'));
        else if(['/api/trip','/api/trips'].includes(path)&&req.method==='POST'){result=await service.start(uid,'generate',body,key);status=202;}
        else if(path==='/api/trips/import'&&req.method==='POST'){if(!/^[a-zA-Z0-9_-]{8,100}$/.test(key))throw new ApiError(400,'IDEMPOTENCY_REQUIRED','Thiếu khóa chống trùng.');result=await service.importTrip(uid,body.trip,key);}
        else if(path==='/api/guide'&&req.method==='POST'){result=await service.start(uid,'guide',{tripId:body.tripId,mode:body.mode,question:body.question,desiredChanges:body.desiredChanges||{}},key);status=202;}
        else if(path==='/api/email'&&req.method==='POST')result=await service.email(uid,body.tripId,body.expectedRevision,body.email);
        else {const parts=path.split('/').filter(Boolean);
          if(parts[1]==='jobs'&&parts.length===3&&req.method==='GET')result=await service.getJob(uid,parts[2]);
          else if(parts[1]==='trips'&&parts.length>=3){const t=parts[2];
            if(parts.length===3&&req.method==='GET')result=await service.trip(uid,t);
            else if(parts.length===3&&req.method==='DELETE')result=await service.remove(uid,t);
            else if(parts.length===4&&parts[3]==='messages'&&req.method==='GET')result=await service.messages(uid,t);
            else if(parts.length===4&&parts[3]==='guide'&&req.method==='POST'){result=await service.start(uid,'guide',{...body,tripId:t},key);status=202;}
            else if(parts.length===4&&parts[3]==='undo'&&req.method==='POST')result=await service.undo(uid,t,body.expectedRevision);
            else if(parts.length===4&&parts[3]==='budget'&&req.method==='POST')result=await service.budgetProposal(uid,t,body.expectedRevision,body.costSettings);
            else if(parts.length===4&&parts[3]==='balance'&&req.method==='POST')result=await service.balance(uid,t,body.expectedRevision);
            else if(parts.length===4&&parts[3]==='email'&&req.method==='POST')result=await service.email(uid,t,body.expectedRevision,body.email);
            else if(parts.length===6&&parts[3]==='proposals'&&parts[5]==='approve'&&req.method==='POST')result=await service.apply(uid,t,parts[4],body.expectedRevision,body.confirmed);
          }
        }
        if(!result)return json(res,404,{code:'API_NOT_FOUND',error:'API không tồn tại.'});return json(res,result.error?result.status||409:status,result);
      }
      if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Method không hỗ trợ.'});const publicRoot=resolve(root,'frontend'),file=resolve(publicRoot,'.'+decodeURIComponent(path==='/'?'/index.html':path)),rel=relative(publicRoot,file);if(rel.startsWith('..')||!rel)return json(res,403,{error:'Forbidden'});const content=await readFile(file);res.writeHead(200,{'Content-Type':(mime[extname(file)]||'application/octet-stream')+'; charset=utf-8','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});res.end(req.method==='HEAD'?undefined:content);
    }catch(e){if(e.code===9&&/requires an index/i.test(String(e.message||'')))return json(res,503,{code:'FIRESTORE_INDEX_REQUIRED',error:'Firestore thiếu chỉ mục cho truy vấn này. Tạo chỉ mục trong Firebase Console → Firestore Database → Indexes rồi thử lại sau khi trạng thái Enabled.'});if(e.code==='ENOENT')return json(res,404,{error:'Không tìm thấy trang.'});return json(res,e.status||503,{code:e.code||'SERVICE_UNAVAILABLE',error:e.status?e.message:'Dịch vụ tạm thời không khả dụng.'});}
  });
  server.requestTimeout=30000;server.headersTimeout=15000;server.on('close',()=>service?.close());return {server,service};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{for(const [k,v]of Object.entries(parseEnv(await readFile(resolve(root,'.env'),'utf8'))))if(!process.env[k])process.env[k]=v;}catch(e){if(e.code!=='ENOENT')throw e;}
  const {server,service}=await createApp();server.listen(Number(process.env.PORT||3000),'127.0.0.1',()=>console.log(`Vietjourney: http://localhost:${server.address().port} · Firebase ${service?'configured':'setup pending'}`));
}
