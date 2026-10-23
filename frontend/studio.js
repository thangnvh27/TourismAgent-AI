import {presets,parseIdea,safeDraft} from './studio-utils.js';
const $=id=>document.getElementById(id),form=$('trip-form'),key='vietjourney-planner-draft-v1';
const money=n=>new Intl.NumberFormat('vi-VN').format(Number(n))+' đ';
function summary(){
  $('summary-destination').textContent=$('destination').value;
  $('summary-duration').textContent=`${$('days').value} ngày · ${$('people').value} người`;
  $('summary-budget').textContent='Ngân sách '+money($('budget').value);
  $('budget-value').textContent=money($('budget').value);
}
function patchForm(patch){
  if($('generate-btn').disabled)return false;
  for(const [k,v]of Object.entries(patch)){
    if(k==='interests'){document.querySelectorAll('input[name="interests"]').forEach(i=>i.checked=v.includes(i.value));continue;}
    const el=$(k);if(!el)continue;
    if(el.type==='checkbox')el.checked=v===true;
    else if(el.tagName==='SELECT'){
      if(!Array.from(el.options).some(o=>o.value===String(v))){
        if((k==='days'&&v>=1&&v<=14)||(k==='people'&&v>=1&&v<=20))el.append(new Option(`${v} ${k==='days'?'ngày':'người'}`,v));else continue;
      }
      el.value=v;
    }else if(el.type==='number'||el.type==='range'){
      if(!Number.isFinite(Number(v))||Number(v)<Number(el.min||0)||Number(v)>Number(el.max||1e9))continue;if(k==='budget')el.step='1000';el.value=v;
    }else el.value=v;
  }
  form.dispatchEvent(new Event('input',{bubbles:true}));summary();return true;
}
let pendingDraft=null,draftTimer,storageAvailable=true;
try{pendingDraft=safeDraft(JSON.parse(localStorage.getItem(key)||'null'));}catch{storageAvailable=false;}
if(pendingDraft){$('restore-draft').hidden=false;$('draft-status').textContent='Có bản nháp trước đó';}
if(!storageAvailable)$('draft-status').textContent='Trình duyệt chưa cho phép lưu nháp';
function captureDraft(){const d={};for(const el of form.elements){if(!el.name||['email','sendEmail','interests'].includes(el.name))continue;d[el.name]=el.type==='checkbox'?el.checked:el.value;}d.interests=[...form.querySelectorAll('input[name="interests"]:checked')].map(i=>i.value);return safeDraft(d);}
function saveDraft(){try{localStorage.setItem(key,JSON.stringify(captureDraft()));$('draft-status').textContent='Đã lưu lựa chọn · không lưu email';}catch{$('draft-status').textContent='Không lưu được nháp trên trình duyệt';}}
function onFormChange(){summary();clearTimeout(draftTimer);draftTimer=setTimeout(saveDraft,350);document.querySelectorAll('[data-preset]').forEach(b=>b.classList.remove('selected'));}
form.addEventListener('input',onFormChange);form.addEventListener('change',onFormChange);
$('restore-draft').onclick=()=>{if(pendingDraft&&patchForm(pendingDraft)){$('restore-draft').hidden=true;$('draft-status').textContent='Đã khôi phục lựa chọn';pendingDraft=null;}};
$('clear-draft').onclick=()=>{clearTimeout(draftTimer);try{localStorage.removeItem(key);pendingDraft=null;$('restore-draft').hidden=true;$('draft-status').textContent='Đã xóa nháp · thay đổi tiếp theo sẽ được lưu';}catch{$('draft-status').textContent='Không thể truy cập bộ nhớ trình duyệt';}};
document.querySelectorAll('[data-preset]').forEach(button=>button.onclick=()=>{if(patchForm(presets[button.dataset.preset])){button.classList.add('selected');$('planner-feedback').hidden=true;if(button.classList.contains('province-card'))$('planner').scrollIntoView({behavior:'smooth',block:'start'});}});
$('hero-preset').onclick=()=>{if(patchForm(presets.weekend))$('planner').scrollIntoView({behavior:'smooth',block:'start'});};
$('mobile-guide').onclick=()=>$('guide-fab').click();
document.querySelectorAll('[data-destination]').forEach(button=>button.addEventListener('click',()=>queueMicrotask(onFormChange)));
const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;let mic=null,listening=false;
if(Recognition){
  mic=new Recognition();mic.lang='vi-VN';mic.interimResults=false;mic.continuous=false;
  mic.onstart=()=>{listening=true;$('planner-mic').setAttribute('aria-pressed','true');$('planner-mic').setAttribute('aria-label','Dừng nghe ý tưởng');$('voice-review').open=true;$('planner-voice-note').textContent='Đang nghe… nói điểm đến, số ngày, số người và ngân sách.';};
  mic.onresult=event=>{$('planner-transcript').value=event.results[0][0].transcript.slice(0,1000);$('planner-voice-note').textContent='Đã nhận nội dung. Kiểm tra và sửa trước khi áp dụng.';};
  mic.onend=()=>{listening=false;$('planner-mic').setAttribute('aria-pressed','false');$('planner-mic').setAttribute('aria-label','Nhập ý tưởng chuyến đi bằng giọng nói');};
  mic.onerror=event=>{$('planner-voice-note').textContent=event.error==='not-allowed'?'Micro chưa được cấp quyền. Bạn có thể nhập ý tưởng trực tiếp.':'Chưa nhận được giọng nói. Thử lại hoặc nhập ý tưởng trực tiếp.';};
  $('planner-mic').onclick=()=>{if(listening)return mic.stop();$('voice-review').open=true;try{window.speechSynthesis?.cancel();$('stop-speech').click();if($('mic-btn').classList.contains('listening'))$('mic-btn').click();mic.start();}catch{$('planner-voice-note').textContent='Micro đang bận. Hãy thử lại.';}};
  $('mic-btn').addEventListener('click',()=>{if(listening)mic.abort();});
}else{$('planner-mic').disabled=true;$('planner-mic').title='Trình duyệt chưa hỗ trợ. Nhập ý tưởng trong mục bên dưới.';$('planner-voice-note').textContent='Trình duyệt chưa hỗ trợ nhận dạng giọng nói. Bạn vẫn có thể nhập ý tưởng trực tiếp.';}
$('apply-voice').onclick=()=>{
  const patch=parseIdea($('planner-transcript').value);if(!Object.keys(patch).length){$('planner-voice-note').textContent='Chưa nhận được thông tin. Thử: “Đi Hội An 3 ngày, 2 người, ngân sách 8 triệu”.';return;}
  if(!patchForm(patch)){$('planner-voice-note').textContent='Đợi tạo lịch trình hiện tại hoàn thành.';return;}
  const names={destination:'điểm đến',days:'số ngày',people:'số người',budget:'ngân sách'};
  $('planner-voice-note').textContent='Đã điền '+Object.keys(patch).map(k=>names[k]).join(', ')+'. Kiểm tra các ô; ngày đi và các yêu cầu khác cần chọn trong form.';
};
form.addEventListener('submit',()=>{$('planner-feedback').hidden=true;if(listening)mic.stop();});
new MutationObserver(()=>{const message=$('toast').textContent;if(!$('toast').hidden&&message){$('planner-feedback').textContent=message;$('planner-feedback').hidden=false;}}).observe($('toast'),{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
new MutationObserver(summary).observe($('trip-result'),{childList:true});
window.addEventListener('pagehide',()=>{if(listening)mic.abort();clearTimeout(draftTimer);});
summary();
