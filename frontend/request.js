const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function requestJSON(path,options={},settings={}){
 const fetchImpl=settings.fetchImpl||fetch,wait=settings.wait||pause;
 const reading=!options.method||options.method==='GET';
 const retries=reading?2:0;
 for(let attempt=0;;attempt++){
   let response;
   try{response=await fetchImpl(path,options);}catch(cause){
     const timeout=cause.name==='TimeoutError'||cause.name==='AbortError';
     if(reading&&!timeout&&attempt<retries){await wait(600*(attempt+1));continue;}
     const message=reading?'Mất kết nối tới server localhost. Kiểm tra server đang chạy rồi thử mở lại. Nếu tour đang tạo, tác vụ có thể vẫn tiếp tục.':'Không nhận được phản hồi từ server localhost. Yêu cầu tạo tour có thể đã được gửi; kiểm tra Chuyến đi đã lưu trước khi thử lại.';
     throw Object.assign(new Error(timeout?'Hết thời gian chờ phản hồi từ server. Kiểm tra Chuyến đi đã lưu trước khi thử lại.':message),{code:timeout?'BACKEND_TIMEOUT':'BACKEND_UNREACHABLE',cause});
   }
   let data;try{data=await response.json();}catch(cause){throw Object.assign(new Error('Server trả phản hồi không đúng JSON. Kiểm tra server tại http://localhost:3000.'),{code:'BACKEND_INVALID_RESPONSE',status:response.status,cause});}
   return {response,data};
 }
}
