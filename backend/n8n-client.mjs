import {ApiError} from './service.mjs';
// A gateway failure does not establish whether the workflow already ran.
function uncertain(status,code,message){const e=new ApiError(status,code,message);e.uncertain=true;return e;}
export function n8nForward(env,fetchImpl=fetch){return async(kind,body)=>{
 const url=kind==='guide'?env.N8N_GUIDE_URL:env.N8N_TRIP_URL;
 if(!url)throw new ApiError(503,'N8N_NOT_CONFIGURED','Chưa cấu hình n8n.');
 const response=await fetchImpl(url,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json',...(env.N8N_WEBHOOK_SECRET?{'X-Tourism-Key':env.N8N_WEBHOOK_SECRET}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(115000)});
 const text=await response.text();let data;
 try{data=JSON.parse(text);}catch{
   if([502,503,504].includes(response.status))throw uncertain(response.status,'N8N_GATEWAY_ERROR','n8n Cloud trả lỗi '+response.status+' (gateway), chưa xác nhận được kết quả tạo tour. Mở n8n → Executions để kiểm tra; không gửi lại ngay.');
   throw uncertain(502,'N8N_INVALID_RESPONSE','n8n trả phản hồi rỗng hoặc không đúng JSON. Kiểm tra execution và node Respond to Webhook trước khi tạo lại.');
 }
 if(!data||typeof data!=='object'||Array.isArray(data))throw uncertain(502,'N8N_INVALID_RESPONSE','n8n trả dữ liệu không hợp lệ. Kiểm tra execution trước khi tạo lại.');
 if(response.status===404&&typeof data.message==='string'&&/requested webhook.+is not registered/i.test(data.message))return {status:404,data:{code:'N8N_WEBHOOK_NOT_REGISTERED',error:'Webhook n8n chưa được đăng ký. Mở n8n, kết nối credential cần thiết và Publish workflow. Kiểm tra URL production trong cấu hình backend khớp đường dẫn Webhook; yêu cầu này chưa chạy workflow.'}};
 // n8n sometimes returns its own error in message, rather than error.
 if(response.status>=400&&!data.error)data={code:data.code||'N8N_EXECUTION_ERROR',error:'n8n trả lỗi HTTP '+response.status+'. Mở Executions để xem node bị lỗi.'};
 return {status:response.status,data};
};}
