import { backendApi, currentUser, onAccountChange, accountConfig } from './account.js';
import { money, escapeHtml as e, makeDemo, demoAnswer, validTrip } from './core.js';
import { finalizeTrip, normalizeRequest, validateRequest, planBudget, getContext, makeDemoProposal, balanceTrip, jsonBytes, MAX_REQUEST_BYTES } from './tour-engine.js';
import {guideQuestions,tripChanges,voicePreferences,compactAnswer} from './guide-tools.js';
const $ = id => document.getElementById(id);
let current = null, chatHistory = [], chatBusy = false, generation = 0, speakingToken = 0, saved = [], recognition, voiceList = [], liveConfigured = false;
let previousTrip = null, pendingProposal = null;
let emailBusy = false;
const budgetNames = { arrival: 'Vé khứ hồi', accommodation: 'Lưu trú', food: 'Ăn uống', transport: 'Di chuyển tại chỗ', activities: 'Vé / trải nghiệm', reserve: 'Dự phòng' };
function readRequest() {
  const f = new FormData($('trip-form'));
  const costSettings = Object.fromEntries(['activitiesPerPersonDay','arrivalPerPerson','roomPerNight','peoplePerRoom','foodPerPersonDay','localTransportPerDay','reservePercent'].map(k => [k, Number($(k).value)]));
  costSettings.arrivalKnown = f.has('arrivalKnown'); costSettings.accommodationIncluded = f.has('accommodationIncluded');
  return { destination: { name: f.get('destination') }, days: Number(f.get('days')), people: Number(f.get('people')), budget: Number(f.get('budget')), transport: f.get('transport'), interests: f.getAll('interests'), startDate: f.get('startDate'), pace: f.get('pace'), origin: f.get('origin'), costSettings, sendEmail: f.has('sendEmail'), email: f.get('email') || '' };
}
function previewBudget() {
  const r = normalizeRequest(readRequest()), audit = planBudget(r), errors = validateRequest({ ...r, sendEmail: false });
  $('roomPerNight').disabled = r.costSettings.accommodationIncluded;
  $('budget-preview').textContent = errors.length ? errors[0] : `${audit.rooms} phòng × ${audit.nights} đêm · Dự toán gồm vé, trải nghiệm và dự phòng: ${money(audit.total)}. ${audit.overBudget ? 'Đã vượt ngân sách ' + money(-audit.remaining) : 'Còn tối đa ' + money(audit.remaining) + ' cho vé / trải nghiệm'}. ${audit.complete ? '' : 'Chưa xác nhận vé khứ hồi.'}`;
}
$('trip-form').addEventListener('input', previewBudget);
$('trip-form').addEventListener('change', previewBudget);
previewBudget();
try { saved = JSON.parse(localStorage.getItem('vietjourney-trips') || '[]'); if (!Array.isArray(saved)) saved = []; saved = saved.filter(validTrip).slice(0, 10); } catch { saved = []; }
const toast = message => { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('toast').hidden = true, 4500); };
const updateCount = () => $('saved-count').textContent = saved.length;
updateCount();
$('budget').addEventListener('input', () => $('budget-value').textContent = money($('budget').value));
$('sendEmail').addEventListener('change', () => { $('email-field').hidden = !$('sendEmail').checked; $('email').required = $('sendEmail').checked; });
const now = new Date(); now.setDate(now.getDate() + 7); $('startDate').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
try {
  const config = await accountConfig(); liveConfigured = config.configured === true;
  $('demo-mode').checked = !liveConfigured;
  $('connection-status').textContent = liveConfigured ? 'Đã cấu hình URL n8n' : 'Firebase cần cấu hình · Demo sẵn sàng';
} catch { $('connection-status').textContent = 'Chạy npm start để kết nối n8n'; }

async function api(path, body) { if (body !== undefined && jsonBytes(body) > MAX_REQUEST_BYTES) throw new Error('Yêu cầu vượt giới hạn 512 KiB.'); return backendApi(path,body); }
$('trip-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!$('trip-form').reportValidity()) return;
  const demo = $('demo-mode').checked;
  if (!demo && !liveConfigured) return toast('Chưa kết nối n8n. Cấu hình .env, khởi động lại server hoặc chọn demo.');
  if (chatBusy || emailBusy) return toast('Đợi yêu cầu hiện tại hoàn thành trước khi tạo chuyến đi khác.');
  if (!demo && !currentUser()) { $('account-button').click(); return toast('Đăng nhập trước khi tạo tour AI.'); }
  const request = readRequest(), errors = validateRequest(normalizeRequest(request));
  if (errors.length) return toast(errors[0]);
  const token = ++generation; stopSpeech();
  $('generate-btn').disabled = true; $('result-panel').setAttribute('aria-busy', 'true'); $('empty-state').hidden = true; $('trip-result').hidden = true; $('loading-state').hidden = false;
  const messages = ['Kết nối những điểm đến phù hợp', 'Cân đối ngân sách cho cả nhóm', 'Sắp xếp lịch trình và câu chuyện hành trình']; let step = 0;
  const interval = setInterval(() => $('loading-label').textContent = messages[++step % messages.length], 3500);
  if (innerWidth < 780) $('result-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  try {
    const result = demo ? (await new Promise(resolve => setTimeout(resolve, 900)), makeDemo(request)) : await api('/api/trip', request);
    if (!validTrip(result)) throw new Error('Dữ liệu lịch trình chưa đúng định dạng. Kiểm tra workflow n8n v2.');
    if (token !== generation) return; current = { ...result, demo }; previousTrip = null; resetChat(); renderTrip();
    toast(demo ? 'Đã tạo lịch trình mẫu. Demo không gọi AI hoặc gửi email.' : 'Lịch trình AI của bạn đã sẵn sàng.');
  } catch (error) {
    toast(error.message);
    if (current) { $('trip-result').hidden = false; } else { $('empty-state').hidden = false; }
  } finally {
    clearInterval(interval); if (token === generation) { $('generate-btn').disabled = false; $('loading-state').hidden = true; $('result-panel').setAttribute('aria-busy', 'false'); }
  }
});
function dayHtml(day, print = false) {
  const sources = getContext(current.destination).sources;
  return `<section class="${print ? 'print-day' : ''}"><h4 class="day-title">Ngày ${e(day.day)} · ${e(day.title)}</h4><ol class="timeline">${day.activities.map(a => `<li><span class="activity-time">${e(a.time)}</span><div class="activity-heading"><h4>${e(a.name)}</h4><span>${current.schemaVersion === 3 && a.category !== 'activities' ? 'Trong bảng ngân sách' : a.cost===0?'Chưa có giá vé':money(a.cost)}</span></div><p>${e(a.description)}</p><a class="map-link" target="_blank" rel="noopener noreferrer" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((a.location || a.name) + ' ' + current.destination)}">⌖ Xem trên bản đồ ↗</a>${current.schemaVersion === 3 ? `<div class="activity-sources">${sources.filter(s => (a.sourceIds || []).includes(s.id)).map(s => `<a href="${e(s.url)}" target="_blank" rel="noopener noreferrer">Nguồn: ${e(s.title)} ↗</a>`).join('') || (a.category === 'activities' ? '<span>Chưa đối chiếu nguồn cho hoạt động này</span>' : '')}</div>` : ''}</li>`).join('')}</ol></section>`;
}
function renderTrip(day = 0) { refreshGuide();
  const t = current, it = t.itinerary, audit = t.budgetAudit;
  $('empty-state').hidden = true; $('loading-state').hidden = true; $('trip-result').hidden = false;
  const labels = { accommodation: 'Lưu trú', food: 'Ăn uống', transport: 'Di chuyển', activities: 'Trải nghiệm' };
  const emailLabels = { requires_ticket_allocation:'Dự trù vé chưa phân bổ. Tải lịch trình để giữ đúng tổng dự toán.', sent: '✓ Đã gửi lịch trình qua email.', failed: 'Không gửi được email. Bạn có thể tải lịch trình.', not_requested: 'Bạn chưa yêu cầu gửi email.', demo: 'Demo không gửi email.', unknown: 'Tour đã lưu; chưa xác nhận được kết quả email. Kiểm tra hộp thư và execution n8n.' };
  $('trip-result').innerHTML = `<div class="result-content"><div class="result-topline"><span class="eyebrow">HÀNH TRÌNH CỦA BẠN</span><span class="result-badge">${t.demo ? 'DEMO MINH HỌA' : t.origin==='imported'?'TOUR NHẬP TỪ THIẾT BỊ':'✦ TẠO BẰNG AI'}</span></div><h3>${e(it.title)}</h3><p class="result-summary">${e(it.summary)}</p><div class="trip-meta"><span>⌖ ${e(t.destination)}</span><span>◷ ${it.days.length} ngày</span><span>♧ ${e(t.request.people)} người</span><span>${e(t.request.transport)}</span>${t.request.startDate ? `<span>${e(t.request.startDate.split('-').reverse().join('/'))}</span>` : ''}</div><div class="result-actions"><button class="primary" id="read-trip">♫ Nghe An giới thiệu</button><button id="save-trip">♡ Lưu chuyến đi</button><button id="download-trip">↓ Tải lịch trình</button><button id="print-trip">▣ In / PDF</button></div><div class="cost-box ${audit.overBudget ? 'over' : ''}"><div class="cost-box-top"><span>Tổng ước tính · cả nhóm</span><strong>${money(it.totalEstimatedCost)}</strong></div><div class="cost-track"><div style="width:${Math.max(0, Math.min(100, Number(audit.total) / Number(audit.budget) * 100 || 0))}%"></div></div><div class="cost-note">${audit.overBudget ? 'Vượt ngân sách ' + money(-audit.remaining) : 'Còn ' + money(audit.remaining) + ' trong ngân sách ' + money(audit.budget)}</div><div class="breakdown">${Object.entries(audit.breakdown || {}).map(([key, value]) => `<span>${e(labels[key] || key)}: ${money(value)}</span>`).join('')}</div></div><div class="day-tabs" role="tablist" aria-label="Các ngày trong lịch trình">${it.days.map((d, i) => `<button type="button" role="tab" aria-selected="${i === day}" aria-controls="day-content" id="day-tab-${i}" tabindex="${i === day ? 0 : -1}" data-day="${i}" class="${i === day ? 'active' : ''}">Ngày ${d.day}</button>`).join('')}</div><div id="day-content" role="tabpanel" aria-labelledby="day-tab-${day}">${dayHtml(it.days[day])}</div><div class="extras"><div><h4>✦ Ghi chú từ An</h4><ul>${(it.tips || []).map(tip => `<li>${e(tip)}</li>`).join('')}</ul></div><div><h4>✓ Hành lý gợi ý</h4><ul>${t.packing.map(p => `<li>${e(p)}</li>`).join('')}</ul></div></div><div class="warning-note">${t.warnings.map(e).join('<br>')}</div><div class="email-status">${e(emailLabels[t.emailStatus] || 'Chưa có trạng thái gửi email.')}</div></div>`;
  if (t.schemaVersion === 3) {
    const s = t.request.costSettings, formulas = { arrival: `${money(s.arrivalPerPerson)} × ${t.request.people} người`, accommodation: s.accommodationIncluded ? 'Đã có chỗ ở' : `${money(s.roomPerNight)} × ${audit.rooms} phòng × ${audit.nights} đêm`, food: `${money(s.foodPerPersonDay)} × ${t.request.people} người × ${t.request.days} ngày`, transport: `${money(s.localTransportPerDay)} × ${t.request.days} ngày`, activities: audit.activityBuffer>0?`Vé ${money(audit.activityTickets)} + dự trù chưa phân bổ ${money(audit.activityBuffer)}`:'Tổng vé / trải nghiệm trong lịch trình', reserve: `${s.reservePercent}% ngân sách · khoản để dành` };
    $('trip-result').querySelector('.cost-box').innerHTML = `<div class="cost-box-top"><span>Tổng dự toán gồm dự phòng · ${audit.complete ? 'Đã tính vé khứ hồi' : 'Chưa xác nhận vé khứ hồi'}</span><strong>${money(audit.total)}</strong></div><table class="budget-table"><thead><tr><th>Khoản chi</th><th>Cách tính</th><th>Cả nhóm</th></tr></thead><tbody>${Object.entries(audit.breakdown).map(([k,v]) => `<tr><td>${e(budgetNames[k])}</td><td>${e(formulas[k])}</td><td>${k==='arrival'&&v===0&&!s.arrivalKnown?'Chưa nhập':k==='activities'&&v===0?'Chưa dự trù':money(v)}</td></tr>`).join('')}</tbody></table><div class="cost-note">${audit.overBudget ? 'Vượt ' + money(-audit.remaining) : 'Còn ' + money(audit.remaining)} · ${money(audit.perPerson)}/người · dự toán, chưa phải báo giá.</div>`;
    $('trip-result').querySelector('.cost-box').insertAdjacentHTML('beforeend','<button type="button" id="edit-tickets">Chỉnh dự toán vé</button>');$('edit-tickets').onclick=openTicketEditor;
    $('trip-result').querySelector('.extras').insertAdjacentHTML('afterend', sourcePanel(t));
    $('trip-result').querySelector('.result-actions').insertAdjacentHTML('beforeend', `<button id="edit-trip">✦ Chỉnh qua chat</button>${(previousTrip || t.canUndo) ? '<button id="undo-trip">↶ Hoàn tác</button>' : ''}`);
    $('edit-trip').onclick = () => { openGuide(); $('chat-mode').value = 'edit';$('chat-mode').onchange(); $('chat-input').placeholder = 'Ví dụ: Giảm ngân sách 1 triệu…'; };
    if ($('undo-trip')) $('undo-trip').onclick = async () => { if (chatBusy || emailBusy) return toast('Đợi yêu cầu hiện tại hoàn thành.'); try { current = current.tripId && !current.demo ? await api('/api/trips/'+current.tripId+'/undo',{expectedRevision:current.revision}) : previousTrip; previousTrip = null; generation++; stopSpeech(); resetChat(); renderTrip(); syncForm(current); toast('Đã hoàn tác về bản trước.'); } catch(error) { toast(error.message); } };
    $('trip-result').querySelector('.result-actions').insertAdjacentHTML('beforeend', '<button id="email-current">✉ Gửi email bản này</button>');
    $('email-current').disabled = emailBusy || t.demo || audit.activityBuffer>0;if(audit.activityBuffer>0)$('email-current').title='Dự trù vé chưa phân bổ: tải lịch trình để giữ đúng tổng dự toán.';
    $('email-current').onclick = openEmailDialog;
    const balanced = balanceTrip(t);
    if (balanced.status !== 'within_budget') {
      const panel = document.createElement('section'); panel.className = 'balance-panel';
      panel.innerHTML = `<h4>Cân đối ngân sách</h4><p>${e(balanced.message)}</p>${balanced.proposal ? `<p>Tiết kiệm dự toán ${money(balanced.saved)} · Tổng mới ${money(balanced.proposal.budgetAudit.total)}</p><button type="button">Xem và áp dụng phương án</button>` : '<p>Các đơn giá, số ngày và số người chưa bị thay đổi.</p>'}`;
      if (balanced.proposal) panel.querySelector('button').onclick = async () => { if (chatBusy || emailBusy) return toast('Đợi yêu cầu hiện tại hoàn thành.'); try { const p = current.tripId && !current.demo ? await api('/api/trips/'+current.tripId+'/balance',{expectedRevision:current.revision}) : {proposal:balanced.proposal};openGuide();addBubble('assistant',balanced.message);showProposal({...p.proposal,proposalId:p.proposalId,expectedRevision:p.expectedRevision},generation); }catch(error){toast(error.message);} };
      $('trip-result').querySelector('.cost-box').after(panel);
    }
  } else {
    $('trip-result').querySelector('.cost-box').insertAdjacentHTML('afterend', '<p class="warning-note">Workflow hiện tại là v2. Import và kết nối v3 để dùng ngân sách đầy đủ, nguồn đối chiếu và chỉnh tour qua chat.</p>');
  }
  document.querySelectorAll('[data-day]').forEach(button => {
    button.onclick = () => { renderTrip(Number(button.dataset.day)); $(`day-tab-${button.dataset.day}`).focus({ preventScroll: true }); };
    button.onkeydown = ev => { if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(ev.key)) return; ev.preventDefault(); const target = ev.key === 'Home' ? 0 : ev.key === 'End' ? it.days.length - 1 : (day + (ev.key === 'ArrowRight' ? 1 : -1) + it.days.length) % it.days.length; renderTrip(target); $(`day-tab-${target}`).focus({ preventScroll: true }); };
  });
  $('read-trip').onclick = () => { openGuide(); speak(t.narration || it.summary); };
  $('save-trip').onclick = saveTrip;
  $('download-trip').onclick = downloadTrip;
  $('print-trip').onclick = () => { const old = $('day-content').innerHTML; $('day-content').innerHTML = it.days.map(d => dayHtml(d, true)).join(''); window.print(); $('day-content').innerHTML = old; };
}
async function saveTrip() {
  if (current.tripId && !current.demo) return toast('Đã lưu trong tài khoản. Mở Chuyến đi đã lưu để xem.');
  if (!current.demo && currentUser()) { const token=generation,uid=currentUser().uid;try { const imported=await api('/api/trips/import',{trip:current});if(token!==generation||currentUser()?.uid!==uid)return;current=imported;renderTrip();return toast('Đã nhập tour vào tài khoản. Tour nhập chưa được xác minh để gửi email.'); } catch(error){return toast(error.message);} }
  const copy = structuredClone(current); delete copy.html; delete copy.request.email; delete copy.request.sendEmail;
  const next = [copy, ...saved.filter(t => t.requestId !== copy.requestId)].slice(0, 10);
  try { localStorage.setItem('vietjourney-trips', JSON.stringify(next)); saved = next; updateCount();window.dispatchEvent(new Event('vietjourney:saved-changed')); toast('Đã lưu trên thiết bị. Bạn có thể đồng bộ trong Chuyến đi đã lưu.'); } catch { toast('Không thể lưu. Bộ nhớ trình duyệt có thể đã đầy hoặc bị tắt.'); }
}
function openEmailDialog() {
  if (emailBusy || chatBusy || $('generate-btn').disabled) return toast('Đợi yêu cầu hiện tại hoàn thành.');
  if (!current || current.demo) return toast('Demo không gửi email.');
  if (!current.tripId) return toast('Cần nhập hoặc tạo tour trên Firebase trước.');
  $('email-recipient').value = $('email').value || '';
  $('email-preview').textContent = `Bản ${current.revision || 0} · ${current.itinerary.title} · ${money(current.budgetAudit.total)}. Gửi nguyên lịch trình đang hiển thị, không tạo lại bằng AI.`;
  $('email-feedback').textContent = '';
  $('email-dialog').showModal(); $('email-recipient').focus();
}
$('close-email').onclick = () => { if (!emailBusy) $('email-dialog').close(); };
$('email-dialog').addEventListener('cancel', event => { if (emailBusy) event.preventDefault(); });
$('email-current-form').onsubmit = async event => {
  event.preventDefault();
  if (emailBusy || !$('email-current-form').reportValidity()) return;
  const trip = current, token = generation;
  emailBusy = true; $('confirm-email').disabled = true; $('close-email').disabled = true;
  $('email-feedback').textContent = 'Đang gửi bản hiện tại…';
  try {
    const result = await api('/api/email', { email: $('email-recipient').value.trim(), tripId:trip.tripId, expectedRevision:trip.revision || 0 });
    if (result.emailSent !== true) throw new Error('Chưa xác nhận được email đã gửi.');
    if (current === trip && generation === token) { current.emailSent = true; current.emailStatus = 'sent'; renderTrip(); }
    $('email-dialog').close(); toast('Đã gửi đúng bản lịch trình hiện tại.');
  } catch (error) { $('email-feedback').textContent = error.name === 'TimeoutError' ? 'Chưa xác nhận kết quả. Kiểm tra hộp thư và execution n8n trước khi gửi lại.' : error.message; }
  finally { emailBusy = false; $('confirm-email').disabled = false; $('close-email').disabled = false; if ($('email-current')) $('email-current').disabled = current?.demo === true; }
};
function sourcePanel(trip) {
  const context = getContext(trip.destination);
  return `<section class="source-panel"><h4>⌖ Dữ liệu điểm đến có nguồn</h4><p>Nguồn xác nhận thông tin nền về điểm đến. Giá vé, giờ mở cửa, quãng đường và đơn giá dự toán cần kiểm tra riêng.</p><div>${context.sources.map(s => `<a href="${e(s.url)}" target="_blank" rel="noopener noreferrer">${e(s.title)} ↗ <small>Kiểm tra ${e(s.checkedAt.split('-').reverse().join('/'))}</small></a>`).join('')}</div><details><summary>Xem thông tin đã đối chiếu</summary>${context.places.map(p => `<p><strong>${e(p.name)}</strong> · ${e(p.summary)}</p>`).join('')}</details></section>`;
}
function syncForm(trip) {
  const r = trip.request;
  for (const k of ['days','people','budget','transport','pace','startDate','origin']) if ($(k) && r[k] !== undefined) {
    if ($(k).tagName === 'SELECT' && !Array.from($(k).options).some(o => o.value === String(r[k]))) $(k).append(new Option(String(r[k]), String(r[k])));
    if (k === 'budget') { $('budget').min = Math.min(500000, r.budget); $('budget').max = Math.max(50000000, r.budget); }
    $(k).value = r[k];
  }
  $('destination').value = trip.destination;
  for (const interest of r.interests || []) if (!Array.from(document.querySelectorAll('input[name="interests"]')).some(i => i.value === interest)) {
    const label = document.createElement('label'), input = document.createElement('input'), span = document.createElement('span');
    input.type = 'checkbox'; input.name = 'interests'; input.value = interest; span.textContent = interest; label.append(input, span); document.querySelector('.interest-chips').append(label);
  }
  document.querySelectorAll('input[name="interests"]').forEach(i => i.checked = (r.interests || []).includes(i.value));
  if (r.costSettings) for (const [k,v] of Object.entries(r.costSettings)) if ($(k)) { if (typeof v === 'boolean') $(k).checked = v; else $(k).value = v; }
  $('budget-value').textContent = money(r.budget); previewBudget();
}
function downloadTrip() {
  const t = current, it = t.itinerary;
  const text = `${t.demo ? '[DEMO MINH HỌA]\n' : ''}${it.title}\n${it.summary}\n\n${it.days.map(d => `NGÀY ${d.day}: ${d.title}\n${d.activities.map(a => `${a.time} · ${a.name}\n${a.description}\n${t.schemaVersion === 3 && a.category !== 'activities' ? 'Chi phí tính trong bảng ngân sách' : (a.cost>0?'Vé / trải nghiệm cả nhóm: '+money(a.cost):'Vé / trải nghiệm: chưa có giá xác nhận')}`).join('\n\n')}`).join('\n\n')}\n\nTỔNG DỰ TOÁN: ${money(it.totalEstimatedCost)}\n${Object.entries(t.budgetAudit.breakdown).map(([k,v]) => `${budgetNames[k] || k}: ${money(v)}`).join('\n')}\n\nLƯU Ý\n${t.warnings.join('\n')}\n\nHÀNH LÝ\n${t.packing.join('\n')}\n\nNGUỒN ĐIỂM ĐẾN\n${getContext(t.destination).sources.map(s => `${s.title}: ${s.url} (kiểm tra ${s.checkedAt})`).join('\n')}`;
  const url = URL.createObjectURL(new Blob(['\ufeff' + text], { type: 'text/plain;charset=utf-8' })); const link = document.createElement('a'); link.href = url; link.download = 'Vietjourney-lich-trinh.txt'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$('saved-btn').onclick = () => window.dispatchEvent(new Event('vietjourney:show-saved'));
window.addEventListener('vietjourney:saved-changed',()=>{try{saved=JSON.parse(localStorage.getItem('vietjourney-trips')||'[]').filter(validTrip);updateCount();}catch{}});

document.querySelectorAll('[data-destination]').forEach(b => b.onclick = () => { $('destination').value = b.dataset.destination; previewBudget(); $('planner').scrollIntoView({ behavior: 'smooth' }); toast(`Đã chọn ${b.dataset.destination}. Điều chỉnh sở thích rồi tạo lịch trình.`); });


function download(name,type,text){const url=URL.createObjectURL(new Blob([text],{type}));const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
let historyLoading=false,historyLoaded=null,lastAnswer='',historyRequest=0;
let preferences;try{preferences=voicePreferences(localStorage.getItem('vietjourney-an-voice'));}catch{preferences=voicePreferences();}
$('voice-note').insertAdjacentHTML('beforebegin','<div class="voice-extra"><label for="voice-rate">Tốc độ</label><select id="voice-rate"><option value="0.8">Chậm</option><option value="0.95">Tự nhiên</option><option value="1.15">Nhanh</option></select><button type="button" id="pause-voice">Tạm dừng</button><button type="button" id="replay-voice">Nghe lại</button></div>');
$('chat-messages').insertAdjacentHTML('beforebegin','<div id="guide-context" class="guide-context"></div><div class="guide-actions"><button type="button" id="guide-day-summary">Lịch ngày</button><button type="button" id="guide-packing">Hành lý</button><button type="button" id="guide-budget">Ngân sách</button></div><div class="guide-tools"><span>Hội thoại theo từng tour</span><button type="button" id="export-chat">Tải hội thoại</button></div><p id="guide-history-note" class="guide-history-note" role="status"></p>');
const guideOptions=document.createElement('details');guideOptions.className='guide-options';const optionsTitle=document.createElement('summary');optionsTitle.textContent='Tùy chọn';guideOptions.append(optionsTitle);document.querySelector('.guide-top').after(guideOptions);for(const element of [document.querySelector('.voice-controls'),document.querySelector('.voice-extra'),$('voice-note'),document.querySelector('.guide-tools')])guideOptions.append(element);document.querySelector('.guide-tools span').remove();
$('voice-rate').value=String(preferences.rate);$('auto-speak').checked=preferences.autoSpeak;
function saveVoice(){preferences={rate:Number($('voice-rate').value),autoSpeak:$('auto-speak').checked,voiceURI:$('voice-select').value};try{localStorage.setItem('vietjourney-an-voice',JSON.stringify(preferences));}catch{}}
$('voice-rate').onchange=saveVoice;$('voice-select').onchange=saveVoice;
$('pause-voice').onclick=()=>{if(!('speechSynthesis'in window))return toast('Thiết bị chưa hỗ trợ giọng đọc.');if(speechSynthesis.paused){speechSynthesis.resume();$('pause-voice').textContent='Tạm dừng';}else if(speechSynthesis.speaking){speechSynthesis.pause();$('pause-voice').textContent='Tiếp tục';}};
$('replay-voice').onclick=()=>lastAnswer?speak(lastAnswer):toast('Chưa có câu trả lời để nghe lại.');
function selectedGuideDay(){return Number($('guide-day')?.value||1);}
function refreshGuide(){
  const box=$('guide-context');if(!box)return;
  const selected=selectedGuideDay();box.replaceChildren();
  if(!current){box.textContent='Tạo hoặc mở một tour để An đồng hành cùng bạn.';document.querySelector('.quick-questions').replaceChildren();return;}
  const title=document.createElement('strong');title.textContent=current.destination+' · '+current.request.days+' ngày';
  const info=document.createElement('span');info.className='guide-context-meta';info.textContent=current.demo?'Demo':'Tour của bạn';
  const label=document.createElement('label');label.textContent='Theo ngày';const select=document.createElement('select');select.id='guide-day';
  for(const day of current.itinerary.days)select.append(new Option('Ngày '+day.day,String(day.day)));
  if([...select.options].some(o=>Number(o.value)===selected))select.value=String(selected);
  select.onchange=refreshQuestions;label.append(select);box.append(title,info,label);refreshQuestions();
}
function refreshQuestions(){const container=document.querySelector('.quick-questions');container.replaceChildren();for(const item of guideQuestions(current,selectedGuideDay(),$('chat-mode')?.value==='edit')){const b=document.createElement('button');b.type='button';b.textContent=item.label;b.onclick=()=>ask(item.question);container.append(b);}}
function localGuideAnswer(question,answer){if(!current)return toast('Tạo hoặc mở tour trước.');if(chatBusy||historyLoading)return toast('Đợi An hoàn thành yêu cầu hiện tại.');stopSpeech();addBubble('user',question);addBubble('assistant',answer);chatHistory.push({role:'user',content:question},{role:'assistant',content:answer});chatHistory=chatHistory.slice(-40);if($('auto-speak').checked)speak(compactAnswer(answer).preview);}
$('guide-day-summary').onclick=()=>{if(!current)return toast('Tạo hoặc mở tour trước.');const day=current.itinerary.days.find(d=>d.day===selectedGuideDay());if(!day)return;localGuideAnswer('Tóm tắt lịch ngày '+day.day,'Ngày '+day.day+' · '+day.title+'\n'+day.activities.map(a=>a.time+' · '+a.name+'\n'+a.description+'\nĐịa điểm: '+a.location).join('\n\n')+'\n\nThông tin lấy từ lịch trình hiện tại; giờ và chi phí là dự kiến.');};
$('guide-packing').onclick=()=>current?localGuideAnswer('Danh sách hành lý của tour',current.packing.map(x=>'• '+x).join('\n')+'\nKiểm tra dự báo thời tiết gần ngày đi trước khi bổ sung hành lý.'):toast('Tạo hoặc mở tour trước.');
$('guide-budget').onclick=()=>current?localGuideAnswer('Tóm tắt ngân sách',Object.entries(current.budgetAudit.breakdown).map(([k,v])=>(budgetNames[k]||k)+': '+money(v)).join('\n')+'\nTổng dự toán: '+money(current.budgetAudit.total)+'\n'+(current.budgetAudit.overBudget?'Vượt ngân sách: ':'Còn trong ngân sách: ')+money(Math.abs(current.budgetAudit.remaining))+'\nCác đơn giá là giả định lập kế hoạch, cần xác minh.'):toast('Tạo hoặc mở tour trước.');
$('export-chat').onclick=()=>{if(!chatHistory.length)return toast('Chưa có hội thoại để tải.');download('hoi-thoai-an.txt','text/plain;charset=utf-8',(current?.itinerary.title||'An')+'\n\n'+chatHistory.map(m=>(m.role==='user'?'Bạn':'An')+': '+m.content).join('\n\n'));};
async function loadGuideHistory(){
  if(!current?.tripId||current.demo||historyLoading)return;
  const key=current.tripId+':'+current.revision;if(historyLoaded===key)return;
  const token=generation,tripId=current.tripId,request=++historyRequest;historyLoading=true;$('guide-history-note').hidden=false;$('guide-history-note').textContent='Đang tải…';
  try{const data=await api('/api/trips/'+encodeURIComponent(tripId)+'/messages');if(token!==generation||request!==historyRequest)return;
    if(data.messages.length&&!pendingProposal&&!chatHistory.length){$('chat-messages').replaceChildren();chatHistory=data.messages.map(m=>({role:m.role,content:m.text}));for(const m of chatHistory)addBubble(m.role,m.content);}
    historyLoaded=key;$('guide-history-note').textContent='Đã tải '+data.messages.length;$('guide-history-note').hidden=true;
  }catch(error){if(token===generation&&request===historyRequest){$('guide-history-note').hidden=false;$('guide-history-note').textContent='Chưa tải được hội thoại: '+error.message;}}
  finally{if(request===historyRequest)historyLoading=false;}
}

function addBubble(role, text, error = false) {
  const bubble = document.createElement('div'); bubble.className = 'bubble ' + (role === 'user' ? 'user' : '') + (error ? ' error' : '');
  const label = document.createElement('div'); label.className = 'bubble-label'; label.textContent = role === 'user' ? 'Bạn' : 'An';
  const answer=role==='assistant'&&!error?compactAnswer(text):{preview:text,full:text,collapsed:false};const content=document.createElement('div');content.className='bubble-content';content.textContent=answer.preview;bubble.append(label,content);if(answer.collapsed){const more=document.createElement('button');more.className='answer-more';more.type='button';more.textContent='Xem thêm';more.setAttribute('aria-expanded','false');more.onclick=()=>{const expanded=more.getAttribute('aria-expanded')==='true';content.textContent=expanded?answer.preview:answer.full;more.textContent=expanded?'Xem thêm':'Thu gọn';more.setAttribute('aria-expanded',String(!expanded));};bubble.append(more);}
  if(role==='assistant'&&!error){lastAnswer=answer.preview;const actions=document.createElement('div');actions.className='bubble-actions';const read=document.createElement('button');read.type='button';read.textContent='♫ Nghe';read.onclick=()=>speak(answer.preview);const copy=document.createElement('button');copy.type='button';copy.textContent='Sao chép';copy.onclick=async()=>{try{await navigator.clipboard.writeText(text);toast('Đã sao chép câu trả lời.');}catch{toast('Chưa sao chép được. Bạn có thể chọn và sao chép nội dung.');}};actions.append(read,copy);bubble.append(actions);} $('chat-messages').append(bubble); $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
}
function resetChat() { historyRequest++;historyLoading=false;historyLoaded=null;lastAnswer='';refreshGuide();if($('guide-history-note')){$('guide-history-note').textContent='';$('guide-history-note').hidden=true;}document.querySelectorAll('.edit-fields input,.edit-fields select').forEach(el=>el.value='');chatHistory = []; pendingProposal = null; $('chat-messages').replaceChildren(); addBubble('assistant', current ? `Mình là An. Bạn muốn khám phá gì ở ${current.destination}?${current.demo ? ' Đây là tour demo.' : ''}` : 'Chào bạn, mình là An. Tạo hoặc mở tour để bắt đầu nhé.'); }
$('chat-form').insertAdjacentHTML('beforebegin', '<div class="chat-mode-row"><label for="chat-mode">Bạn muốn</label><select id="chat-mode"><option value="ask">Hỏi An về chuyến đi</option><option value="edit">Chỉnh tour · xem đề xuất trước</option></select></div>');
$('chat-mode').onchange = () => { $('chat-input').placeholder = $('chat-mode').value === 'edit' ? 'Giảm ngân sách 1 triệu, thay điểm ngày 2…' : 'Hỏi An về chuyến đi…';if(document.querySelector('.edit-fields'))document.querySelector('.edit-fields').hidden=$('chat-mode').value!=='edit';refreshQuestions(); };
resetChat();
function openGuide() { refreshGuide();loadGuideHistory();$('guide-panel').hidden = false; $('guide-fab').setAttribute('aria-expanded', 'true'); $('chat-input').focus({ preventScroll: true }); }
$('guide-fab').onclick = () => $('guide-panel').hidden ? openGuide() : closeGuide();
$('banner-guide').onclick = openGuide;
function closeGuide() { $('guide-panel').hidden = true; $('guide-fab').setAttribute('aria-expanded', 'false'); stopSpeech(); if (recognition) recognition.abort(); $('guide-fab').focus({ preventScroll: true }); }
$('close-guide').onclick = closeGuide;
document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !$('guide-panel').hidden) closeGuide(); });
async function ask(question) {
  if (!current) { toast('Hãy tạo lịch trình trước khi trò chuyện với An.'); return; }
  if ($('generate-btn').disabled) return toast('Vui lòng đợi tạo lịch trình xong.');
  if (emailBusy) return toast('Đợi gửi email hoàn thành.');
  if (!current.demo && !current.tripId) return toast('Bấm Lưu chuyến đi để nhập tour vào Firebase trước khi chỉnh sửa.');
  if(historyLoading)return toast('Đợi tải hội thoại trước khi gửi câu hỏi.');if (chatBusy || !question.trim()) return;
  const mode = $('chat-mode').value;
  if (mode === 'edit' && current.schemaVersion !== 3) return toast('Cần tạo lịch trình bằng workflow v3 hoặc demo mới để chỉnh qua chat.');
  let desiredChanges={};try{if(mode==='edit')desiredChanges=readEditChanges();}catch(error){return toast(error.message);}stopSpeech(); const q = question.trim().slice(0, 1000), trip = current, token = generation;
  addBubble('user', q); $('chat-input').value = ''; chatBusy = true; $('chat-send').disabled = true; $('guide-status').textContent = 'An đang chuẩn bị câu trả lời…';
  try {
    const response = trip.demo ? (await new Promise(resolve => setTimeout(resolve, 450)), mode === 'edit' ? demoEdit(q,trip,desiredChanges) : { answer: demoAnswer(q, trip) }) : await api('/api/guide', { mode, question: q, tripId:trip.tripId, desiredChanges });
    if (mode === 'edit' && !validTrip(response.proposal)) throw new Error('Workflow chưa trả bản đề xuất v3 hợp lệ. Kiểm tra đã import và publish v3.');
    const answer = response.answer;
    if (typeof answer !== 'string' || !answer.trim()) throw new Error('Câu trả lời chưa hợp lệ. Hãy thử lại.');
    if (token !== generation) return;
    addBubble('assistant', answer); chatHistory.push({ role: 'user', content: q }, { role: 'assistant', content: answer }); chatHistory = chatHistory.slice(-40);
    if (mode === 'edit') showProposal({ ...response.proposal, demo: trip.demo, proposalId:response.proposalId, expectedRevision:response.expectedRevision }, token);
    if (Array.isArray(response.sources)) {
      const ids = new Set(response.sources.map(s => s.id)); const trusted = getContext(trip.destination).sources.filter(s => ids.has(s.id));
      if (trusted.length) $('chat-messages').insertAdjacentHTML('beforeend', `<div class="chat-citations">${trusted.map(s => `<a href="${e(s.url)}" target="_blank" rel="noopener noreferrer">${e(s.title)} ↗</a>`).join('')}</div>`);
    }
    if ($('auto-speak').checked && !$('guide-panel').hidden) speak(compactAnswer(answer).preview);
  } catch (error) { if (token === generation) addBubble('assistant', error.message, true); }
  finally { chatBusy = false; $('chat-send').disabled = false; if (!('speechSynthesis' in window) || !speechSynthesis.speaking) $('guide-status').textContent = 'Bạn đồng hành của bạn'; }
}
function showProposal(proposal, token) {
  pendingProposal = proposal;
  $('chat-messages').querySelectorAll('.proposal-card').forEach(card => card.remove());
  const old = current.budgetAudit.total, delta = proposal.budgetAudit.total - old;
  const card = document.createElement('div'); card.className = 'proposal-card';
  card.innerHTML = `<strong>Bản đề xuất · chưa áp dụng</strong><p>${e(proposal.itinerary.title)}</p><ul class="proposal-diff">${tripChanges(current,proposal).map(line=>'<li>'+e(line)+'</li>').join('')}</ul><div>${money(old)} → <b>${money(proposal.budgetAudit.total)}</b></div><small>${delta > 0 ? 'Tăng ' : delta < 0 ? 'Giảm ' : 'Không đổi '}${delta ? money(Math.abs(delta)) : 'tổng dự toán'} · Ngân sách mới ${money(proposal.request.budget)}</small><p>${e(proposal.warnings.join(' '))}</p><details><summary>Xem lịch trình đề xuất</summary>${proposal.itinerary.days.map(d => `<p><strong>Ngày ${d.day} · ${e(d.title)}</strong><br>${d.activities.map(a => e(a.time) + ' · ' + e(a.name)).join('<br>')}</p>`).join('')}</details><div class="proposal-actions"><button data-apply>Áp dụng bản này</button><button data-cancel>Giữ bản hiện tại</button></div>`;
  card.querySelector('[data-apply]').onclick = async () => {
    if (chatBusy || emailBusy || token !== generation || pendingProposal !== proposal) return toast('Đề xuất này đã cũ hoặc đang có yêu cầu chưa hoàn thành.');
    const applyButton=card.querySelector('[data-apply]');applyButton.disabled=true;
    try { const applied = current.tripId && !current.demo ? await api('/api/trips/'+current.tripId+'/proposals/'+proposal.proposalId+'/approve',{confirmed:true,expectedRevision:proposal.expectedRevision ?? current.revision}) : proposal; previousTrip=structuredClone(current); current=applied;pendingProposal=null;generation++;stopSpeech();refreshGuide();renderTrip();syncForm(current);historyLoaded=current.tripId+':'+current.revision; } catch(error){applyButton.disabled=false;return toast(error.message);}
    card.querySelector('.proposal-actions').replaceChildren(document.createTextNode('✓ Đã áp dụng · chưa gửi email cho bản chỉnh sửa'));
    toast('Đã áp dụng. Bạn có thể hoàn tác hoặc lưu bản mới.');
  };
  card.querySelector('[data-cancel]').onclick = () => { if (pendingProposal === proposal) pendingProposal = null; card.remove(); toast('Giữ nguyên lịch trình hiện tại.'); };
  $('chat-messages').append(card); $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
}
$('chat-form').onsubmit = event => { event.preventDefault(); ask($('chat-input').value); };
document.querySelectorAll('[data-question]').forEach(b => b.onclick = () => { $('chat-mode').value = 'ask'; $('chat-mode').onchange(); ask(b.dataset.question); });

function loadVoices() {
  if (!('speechSynthesis' in window)) { $('voice-note').textContent = 'Trình duyệt này chưa hỗ trợ đọc giọng nói.'; return; }
  const selected = $('voice-select').value||preferences.voiceURI; voiceList = speechSynthesis.getVoices();
  const vietnamese = voiceList.filter(v => v.lang.toLowerCase().startsWith('vi'));
  const options = vietnamese.length ? vietnamese : voiceList;
  $('voice-select').replaceChildren(new Option('Giọng mặc định thiết bị', ''));
  options.forEach(v => $('voice-select').append(new Option(v.name + ' (' + v.lang + ')', v.voiceURI)));
  if (options.some(v => v.voiceURI === selected)) $('voice-select').value = selected;
  else if (vietnamese.length) $('voice-select').value = vietnamese[0].voiceURI;
  $('voice-note').textContent = vietnamese.length ? 'Giọng Việt có sẵn trên thiết bị · Không thu âm khi đọc.' : 'Chưa thấy giọng Việt. Thiết bị sẽ chọn giọng mặc định; có thể phát âm chưa chuẩn.';
}
loadVoices(); if ('speechSynthesis' in window) speechSynthesis.addEventListener('voiceschanged', loadVoices);
function stopSpeech() { if($('pause-voice'))$('pause-voice').textContent='Tạm dừng';speakingToken++; if ('speechSynthesis' in window) speechSynthesis.cancel(); $('guide-status').textContent = 'Bạn đồng hành của bạn'; }
function speak(text) {
  if (!('speechSynthesis' in window)) return toast('Thiết bị chưa hỗ trợ đọc giọng nói.');
  stopSpeech(); const token = speakingToken;
  const chunks = String(text).slice(0, 14000).match(/[^.!?\n]+[.!?\n]?/g)?.flatMap(s => s.match(/.{1,220}(?:\s|$)|.{1,220}/g) || []) || [];
  if (!chunks.length) return;
  const voice = voiceList.find(v => v.voiceURI === $('voice-select').value); let index = 0;
  function next() {
    if (token !== speakingToken) return;
    if (index >= chunks.length) { $('guide-status').textContent = 'Bạn đồng hành của bạn'; return; }
    const utterance = new SpeechSynthesisUtterance(chunks[index++]); utterance.lang = 'vi-VN'; if (voice) utterance.voice = voice; utterance.rate = Number($('voice-rate').value);
    utterance.onend = next; utterance.onerror = event => { if (token !== speakingToken || event.error === 'interrupted' || event.error === 'canceled') return; $('guide-status').textContent = 'Không phát được giọng đọc'; toast('Không phát được giọng đọc. Hãy chọn giọng khác trên thiết bị.'); };
    $('guide-status').textContent = '♫ An đang giới thiệu…'; speechSynthesis.speak(utterance);
  }
  next();
}
$('stop-speech').onclick = stopSpeech;
$('auto-speak').onchange = () => { saveVoice();if (!$('auto-speak').checked) stopSpeech(); };
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (!Recognition) { $('mic-btn').disabled = true; $('mic-btn').title = 'Trình duyệt chưa hỗ trợ nhận dạng giọng nói. Hãy nhập câu hỏi.'; }
else {
  recognition = new Recognition(); recognition.lang = 'vi-VN'; recognition.interimResults = false; recognition.continuous = false;
  recognition.onstart = () => { $('mic-btn').setAttribute('aria-pressed','true');$('mic-btn').classList.add('listening'); $('mic-btn').setAttribute('aria-label', 'Dừng nghe'); $('guide-status').textContent = 'Đang nghe… Hãy nói câu hỏi của bạn'; };
  recognition.onresult = event => { $('chat-input').value = event.results[0][0].transcript.slice(0, 1000); toast('Đã nhận giọng nói. Kiểm tra câu hỏi rồi nhấn gửi.'); };
  recognition.onend = () => { $('mic-btn').setAttribute('aria-pressed','false');$('mic-btn').classList.remove('listening'); $('mic-btn').setAttribute('aria-label', 'Nhập câu hỏi bằng giọng nói'); $('guide-status').textContent = 'Bạn đồng hành của bạn'; };
  recognition.onerror = event => { toast(event.error === 'not-allowed' ? 'Micro chưa được cấp quyền. Bạn có thể nhập câu hỏi bằng bàn phím.' : event.error === 'no-speech' ? 'Chưa nghe rõ. Hãy thử lại hoặc nhập câu hỏi.' : 'Không nhận được giọng nói. Kiểm tra micro và kết nối mạng.'); };
  $('mic-btn').onclick = () => { if (chatBusy) return toast('Vui lòng đợi An trả lời xong.'); if ($('mic-btn').classList.contains('listening')) return recognition.stop(); stopSpeech(); try { recognition.start(); } catch { toast('Micro đang bận. Hãy thử lại sau.'); } };
}
window.addEventListener('pagehide', () => { stopSpeech(); if (recognition) recognition.abort(); });


function readEditChanges(){const patch={};for(const k of ['days','people','budget']){const el=$('edit-'+k);if(el.value.trim())patch[k]=Number(el.value);}for(const k of ['pace','transport'])if($('edit-'+k).value)patch[k]=$('edit-'+k).value;if($('edit-interests').value.trim()){patch.interests=$('edit-interests').value.split(',').map(s=>s.trim()).filter(Boolean);if(patch.interests.length>8||patch.interests.some(s=>s.length>50))throw Error('Chọn tối đa 8 sở thích, mỗi sở thích tối đa 50 ký tự.');}const errors=validateRequest(normalizeRequest({...current.request,...patch}));if(errors.length)throw Error(errors[0]);return patch;}
function demoEdit(question,trip,patch){if(!Object.keys(patch).length)return makeDemoProposal(question,trip);const proposal=makeDemo({...trip.request,...patch});proposal.revision=(trip.revision||0)+1;return {answer:'Bản demo mới theo thông tin đã chọn; hoạt động được tạo lại từ dữ liệu mẫu. Hãy xem và duyệt trước khi áp dụng.',proposal};}
const editFields=document.createElement('details');editFields.className='edit-fields';editFields.hidden=true;editFields.innerHTML='<summary>Chọn thông tin muốn thay đổi</summary><div class="form-grid"><div><label for="edit-days">Số ngày mới</label><input id="edit-days" type="number" min="1" max="14"></div><div><label for="edit-people">Số người mới</label><input id="edit-people" type="number" min="1" max="20"></div></div><label for="edit-budget">Ngân sách mới · đ</label><input id="edit-budget" type="number" min="500000" max="1000000000"><div class="form-grid"><div><label for="edit-pace">Nhịp độ mới</label><select id="edit-pace"><option value="">Giữ nguyên</option><option>Thư thả</option><option>Cân bằng</option><option>Năng động</option></select></div><div><label for="edit-transport">Phương tiện mới</label><select id="edit-transport"><option value="">Giữ nguyên</option><option>Ô tô</option><option>Xe máy</option><option>Taxi / xe công nghệ</option><option>Phương tiện công cộng</option></select></div></div><label for="edit-interests">Sở thích mới · phân cách bằng dấu phẩy</label><input id="edit-interests" maxlength="300" placeholder="Ẩm thực, Thiên nhiên"><p>Để trống để giữ thông tin hiện tại. Viết yêu cầu rồi gửi; lịch trình chỉ đổi sau khi bạn duyệt.</p>';$('chat-form').before(editFields);
window.addEventListener('vietjourney:open-trip',event=>{if(chatBusy||emailBusy||$('generate-btn').disabled){event.preventDefault();return toast('Đợi yêu cầu hiện tại hoàn thành.');}current=event.detail;previousTrip=null;generation++;stopSpeech();resetChat();renderTrip();syncForm(current);$('result-panel').scrollIntoView({behavior:'smooth'});});
let accountUid=currentUser()?.uid;
onAccountChange(user=>{if(accountUid&&accountUid!==user?.uid){generation++;$('ticket-dialog')?.close();previousTrip=null;pendingProposal=null;stopSpeech();resetChat();$('generate-btn').disabled=false;$('loading-state').hidden=true;$('result-panel').setAttribute('aria-busy','false');if(current?.tripId){current=null;resetChat();$('trip-result').hidden=true;$('empty-state').hidden=false;}closeGuide();}accountUid=user?.uid;});

let ticketToken=null;
function openTicketEditor(){if(chatBusy||emailBusy||$('generate-btn').disabled)return toast('Đợi yêu cầu hiện tại hoàn thành.');ticketToken=generation;const s=current.request.costSettings;$('ticket-arrival').value=s.arrivalPerPerson;$('ticket-known').checked=s.arrivalKnown;$('ticket-activities').value=s.activitiesPerPersonDay||0;$('ticket-feedback').textContent='';$('ticket-dialog').showModal();}
$('close-ticket').onclick=()=>$('ticket-dialog').close();
$('ticket-form').onsubmit=async event=>{event.preventDefault();if(ticketToken!==generation)return $('ticket-feedback').textContent='Tour đã thay đổi. Đóng và mở lại để chỉnh.';if(chatBusy||emailBusy||$('generate-btn').disabled)return;const token=generation,trip=current;const settings={arrivalPerPerson:Number($('ticket-arrival').value),arrivalKnown:$('ticket-known').checked,activitiesPerPersonDay:Number($('ticket-activities').value)};const request=normalizeRequest({...trip.request,costSettings:{...trip.request.costSettings,...settings}}),errors=validateRequest(request);if(errors.length)return $('ticket-feedback').textContent=errors[0];$('ticket-preview').disabled=true;try{const result=trip.tripId&&!trip.demo?await api('/api/trips/'+trip.tripId+'/budget',{expectedRevision:trip.revision,costSettings:settings}):{proposal:finalizeTrip(request,trip.itinerary,{demo:trip.demo,revision:trip.revision+1,packing:trip.packing,emailStatus:trip.demo?'demo':'not_requested'})};if(token!==generation)return;$('ticket-dialog').close();openGuide();addBubble('assistant','Dự toán mới. Kiểm tra tổng chi phí rồi áp dụng.');showProposal({...result.proposal,proposalId:result.proposalId,expectedRevision:result.expectedRevision},token);}catch(error){if(token===generation)$('ticket-feedback').textContent=error.message;}finally{$('ticket-preview').disabled=false;}};
