import {initAccount,accountConfig,currentUser,onAccountChange,signInGoogle,signInEmail,signOut,backendApi} from './account.js';
import {validTrip} from './core.js';
const $=id=>document.getElementById(id);
function showError(e){$('account-feedback').textContent=e.code?.includes('auth/')?'Đăng nhập không thành công. Kiểm tra email/mật khẩu hoặc cấu hình Firebase.':e.message||'Chưa kết nối được Firebase.';}
$('account-button').onclick=async()=>{$('account-dialog').showModal();$('account-feedback').textContent='';try{const c=await accountConfig();if(!c.backendReady)$('account-feedback').textContent='Chưa cấu hình Firebase. Bạn vẫn có thể dùng demo.';}catch(e){showError(e);}};
$('close-account').onclick=()=>$('account-dialog').close();
$('google-login').onclick=async()=>{try{await signInGoogle();$('account-dialog').close();}catch(e){showError(e);}};
$('account-form').onsubmit=async event=>{event.preventDefault();const button=$('email-login');button.disabled=true;try{await signInEmail($('login-email').value.trim(),$('login-password').value,$('register-account').checked);$('login-password').value='';$('account-dialog').close();}catch(e){showError(e);}finally{button.disabled=false;}};
$('logout-button').onclick=async()=>{try{await signOut();$('account-dialog').close();}catch(e){showError(e);}};

let cursor=null,cloudTrips=[],loadVersion=0;
const localKey='vietjourney-trips';
function localTrips(){try{const rows=JSON.parse(localStorage.getItem(localKey)||'[]');return Array.isArray(rows)?rows.filter(validTrip).slice(0,10):[];}catch{return [];}}
function removeLocal(trip){const next=localTrips().filter(t=>!(t.requestId===trip.requestId&&JSON.stringify(t.itinerary)===JSON.stringify(trip.itinerary)));localStorage.setItem(localKey,JSON.stringify(next));window.dispatchEvent(new Event('vietjourney:saved-changed'));}
function openSavedTrip(trip){const accepted=window.dispatchEvent(new CustomEvent('vietjourney:open-trip',{detail:trip,cancelable:true}));if(accepted)$('cloud-dialog').close();}
function renderUnified(){
  const list=$('cloud-list');list.replaceChildren();const cloudIds=new Set(cloudTrips.map(t=>t.requestId).filter(Boolean));
  for(const t of cloudTrips)row(t,false);
  for(const t of localTrips())if(!cloudIds.has(t.requestId))row(t,true);
  function row(t,local){
    const uid=currentUser()?.uid;
    const wrapper=document.createElement('div');wrapper.className='cloud-item';wrapper.dataset.source=local?'local':'cloud';
    const content=document.createElement('div'),title=document.createElement('strong'),info=document.createElement('small'),badge=document.createElement('span');
    title.textContent=local?t.itinerary.title:t.title;info.textContent=`${t.destination} · ${local?t.request.days:t.days} ngày · ${local?t.request.people:t.people} người`;
    badge.className='saved-source';badge.textContent=local?(t.demo?'Thiết bị · Demo':'Thiết bị'):'Tài khoản';content.append(badge,title,info);
    const open=document.createElement('button');open.type='button';open.textContent='Mở';open.onclick=async()=>{if(local)return openSavedTrip(structuredClone(t));open.disabled=true;try{const trip=await backendApi('/api/trips/'+encodeURIComponent(t.id));if(currentUser()?.uid!==uid)return;openSavedTrip(trip);}catch(e){if(currentUser()?.uid===uid)$('cloud-feedback').textContent=e.message;}finally{open.disabled=false;}};
    const del=document.createElement('button');del.type='button';del.textContent='Xóa';del.onclick=async()=>{if(!confirm(local?'Xóa bản lưu trên thiết bị?':'Xóa tour và lịch sử trong tài khoản?'))return;del.disabled=true;try{if(local)removeLocal(t);else{await backendApi('/api/trips/'+encodeURIComponent(t.id),{},{method:'DELETE'});if(currentUser()?.uid!==uid)return;cloudTrips=cloudTrips.filter(x=>x.id!==t.id);}renderUnified();}catch(e){if(local||currentUser()?.uid===uid)$('cloud-feedback').textContent=e.message;}finally{del.disabled=false;}};
    wrapper.append(content,open);
    if(local){const sync=document.createElement('button');sync.type='button';sync.textContent='Đồng bộ';sync.disabled=!uid;sync.title=uid?'Lưu vào tài khoản, chuyển khỏi bản thiết bị':'Đăng nhập để đồng bộ';sync.onclick=async()=>{sync.disabled=true;open.disabled=true;del.disabled=true;try{
      const clean=structuredClone(t);delete clean.html;delete clean.request.email;delete clean.request.sendEmail;
      const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([clean.requestId,clean.request,clean.itinerary])));const key='sync-'+[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('');
      await backendApi('/api/trips/import',{trip:clean},{key});if(currentUser()?.uid!==uid)return;
      removeLocal(t);await loadSaved(true);
    }catch(e){if(currentUser()?.uid===uid)$('cloud-feedback').textContent=e.message;}finally{sync.disabled=!currentUser();open.disabled=false;del.disabled=false;}};wrapper.append(sync);}
    wrapper.append(del);list.append(wrapper);
  }
  if(!list.children.length){const empty=document.createElement('p');empty.className='saved-empty';empty.textContent='Chưa có chuyến đi. Tạo tour và chọn lưu để bắt đầu.';list.append(empty);}
}
async function loadSaved(reset=false){
  const version=++loadVersion,uid=currentUser()?.uid;if(reset){cursor=null;cloudTrips=[];renderUnified();}
  $('cloud-more').hidden=true;
  if(!uid){$('cloud-feedback').textContent='Tour trên thiết bị. Đăng nhập để xem và đồng bộ tour trong tài khoản.';renderUnified();return;}
  $('cloud-feedback').textContent='Đang tải…';
  try{const result=await backendApi('/api/trips'+(cursor?'?cursor='+encodeURIComponent(cursor):''));if(version!==loadVersion||uid!==currentUser()?.uid)return;
    cloudTrips=[...cloudTrips,...result.trips.filter(t=>!cloudTrips.some(old=>old.id===t.id))];cursor=result.nextCursor;renderUnified();$('cloud-more').hidden=!cursor;$('cloud-feedback').textContent='Tour tài khoản và thiết bị được quản lý tại đây.';
  }catch(e){if(version===loadVersion&&uid===currentUser()?.uid){$('cloud-feedback').textContent='Chưa tải được tour tài khoản: '+e.message;renderUnified();}}
}
$('close-cloud').onclick=()=>$('cloud-dialog').close();
onAccountChange(user=>{loadVersion++;cloudTrips=[];cursor=null;$('account-button').textContent=user?'Tài khoản':'Đăng nhập';$('account-status').textContent=user?'Đã đăng nhập · '+(user.displayName||user.email||'Người dùng'):'Đăng nhập để lưu và đồng bộ tour';$('logout-button').hidden=!user;$('cloud-button').hidden=true;$('account-form').hidden=!!user;$('google-login').hidden=!!user;$('cloud-more').hidden=true;renderUnified();if($('cloud-dialog').open)loadSaved(true);});
function showSaved(){$('cloud-dialog').showModal();loadSaved(true);}
window.addEventListener('vietjourney:show-saved',showSaved);
window.addEventListener('vietjourney:saved-changed',()=>{if($('cloud-dialog').open)renderUnified();});
window.addEventListener('storage',event=>{if(event.key===localKey&&$('cloud-dialog').open)renderUnified();});
$('cloud-button').onclick=showSaved;$('cloud-more').onclick=()=>loadSaved();
initAccount().catch(e=>{$('account-status').textContent='Chưa kết nối được đăng nhập';showError(e);});
