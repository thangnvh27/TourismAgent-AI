export function guideQuestions(trip, day=1, edit=false) {
  if(!trip)return [];
  if(edit)return [
    {label:`Đổi điểm ngày ${day}`,question:`Thay điểm ngày ${day}, ưu tiên các sở thích của tôi và giữ chi phí cố định.`},
    {label:'Thêm thời gian nghỉ',question:'Thêm thời gian nghỉ cho trẻ nhỏ, giữ nguyên số ngày, số người và ngân sách.'},
    {label:'Giảm ngân sách',question:'Giảm ngân sách 1 triệu, giải thích phần có thể tiết kiệm và phần chi phí cố định.'}
  ];
  return [
    {label:'Ăn uống',question:`Gợi ý món ăn địa phương ở ${trip.destination}, cách chọn quán và dự trù cho ${trip.request.people} người trong ngân sách tour?`},
    {label:'Di chuyển',question:`Tư vấn di chuyển ngày ${day} bằng ${trip.request.transport}, lưu ý quãng đường và cách xác minh thời gian?`},
    {label:'Khi trời mưa',question:`Nếu trời mưa ngày ${day}, gợi ý hoạt động trong nhà phù hợp sở thích ${trip.request.interests.join(', ')}. Không dùng dự báo thời tiết chưa xác minh.`},
    {label:'Điểm đến',question:`Giới thiệu văn hóa và điểm tham quan ngày ${day} trong lịch trình ${trip.destination}, kèm nguồn đối chiếu nếu có.`}
  ];
}
export function tripChanges(before, after) {
  const labels={days:'Số ngày',people:'Số người',budget:'Ngân sách',pace:'Nhịp độ',transport:'Phương tiện',interests:'Sở thích'};
  const format=x=>Array.isArray(x)?x.join(', '):String(x);
  const changes=Object.keys(labels).filter(k=>JSON.stringify(before.request[k])!==JSON.stringify(after.request[k])).map(k=>`${labels[k]}: ${format(before.request[k])} → ${format(after.request[k])}`);
  for(const [k,label]of Object.entries({arrivalPerPerson:'Vé khứ hồi/người',activitiesPerPersonDay:'Dự trù trải nghiệm/người/ngày',arrivalKnown:'Vé đã xác nhận'}))if(before.request.costSettings?.[k]!==after.request.costSettings?.[k])changes.push(label+': '+String(before.request.costSettings?.[k]??0)+' → '+String(after.request.costSettings?.[k]??0));
  const length=Math.max(before.itinerary.days.length,after.itinerary.days.length);
  for(let i=0;i<length;i++){
    const a=before.itinerary.days[i],b=after.itinerary.days[i];
    if(!a)changes.push(`Thêm ngày ${i+1}: ${b.title}`);
    else if(!b)changes.push(`Bỏ ngày ${i+1}: ${a.title}`);
    else if(JSON.stringify(a)!==JSON.stringify(b)){
      const route=d=>d.activities.map(({description,...activity})=>activity);
      changes.push(JSON.stringify(route(a))===JSON.stringify(route(b))
        ? `Ngày ${i+1}: cập nhật tiêu đề hoặc mô tả; giữ nguyên điểm đến, giờ và chi phí.`
        : `Ngày ${i+1}: ${b.activities.map(x=>x.name).join(' → ')}`);
    }
  }
  return changes;
}
const guideMoney=value=>Number(value).toLocaleString('vi-VN')+' đ';
export function proposalBudgetStatus(trip) {
  const gap=trip.budgetAudit.total-trip.request.budget;
  return gap>0
    ? `Chưa đạt ngân sách: còn vượt ${guideMoney(gap)}. Tổng dự toán ${guideMoney(trip.budgetAudit.total)} / ngân sách ${guideMoney(trip.request.budget)}.`
    : `Trong ngân sách dự kiến: tổng ${guideMoney(trip.budgetAudit.total)} / ${guideMoney(trip.request.budget)}${gap<0?`, còn ${guideMoney(-gap)}`:''}.`;
}
// Base edit claims on the validated proposal, rather than model promises.
export function guideEditSummary(before, proposal) {
  const audit=proposal.budgetAudit, delta=audit.total-before.budgetAudit.total;
  const lines=[proposalBudgetStatus(proposal),delta<0?`Dự toán giảm ${guideMoney(-delta)} so với bản hiện tại.`:delta>0?`Dự toán tăng ${guideMoney(delta)} so với bản hiện tại.`:'Tổng dự toán không đổi.'];
  const changes=tripChanges(before,proposal);
  lines.push(changes.length?'Thay đổi thực tế:\n'+changes.map(x=>'• '+x).join('\n'):'Lịch trình và thông tin chuyến đi không đổi.');
  const b=audit.breakdown;
  const fixed=b.arrival+b.accommodation+b.food+b.transport+b.reserve;
  if(audit.total>proposal.request.budget)lines.push(fixed>proposal.request.budget
    ? `Riêng vé khứ hồi, phòng, ăn uống, di chuyển và dự phòng đã là ${guideMoney(fixed)}. Chỉ bỏ hoạt động chưa đủ; hãy chỉnh số ngày, số người hoặc xem lại đơn giá trong form.`
    : 'Để giảm tiếp, xem các trải nghiệm trả phí hoặc điều chỉnh số ngày, số người và dự toán trong form.');
  if(audit.activityBuffer>0)lines.push(`Còn ${guideMoney(audit.activityBuffer)} dự trù vé / trải nghiệm chưa phân bổ; chưa thể gửi email bản này. Mở phần chỉnh dự toán vé để kiểm tra.`);
  if(JSON.stringify(before.request.costSettings)===JSON.stringify(proposal.request.costSettings))lines.push('Giữ nguyên các đơn giá đã nhập.');
  lines.push('Đây là đề xuất chưa áp dụng. Các chi phí là dự toán, cần xác minh trước khi đặt.');
  return lines.join('\n\n');
}
export function voicePreferences(raw) {
  let p={};try{p=JSON.parse(raw||'{}')||{};}catch{}
  return {rate:[0.8,0.95,1.15].includes(Number(p.rate))?Number(p.rate):0.95,autoSpeak:typeof p.autoSpeak==='boolean'?p.autoSpeak:true,voiceURI:typeof p.voiceURI==='string'?p.voiceURI:''};
}

export function compactAnswer(text, limit=360) {
  const clean=String(text).replace(/^#{1,6}\s+/gm,'').replace(/\*\*([^*]+)\*\*/g,'$1').trim();
  if(clean.length<=limit)return {preview:clean,full:clean,collapsed:false};
  const chunk=clean.slice(0,limit);
  const sentence=Math.max(chunk.lastIndexOf('. '),chunk.lastIndexOf('! '),chunk.lastIndexOf('? '),chunk.lastIndexOf('\n'));
  const end=sentence>=limit*0.5?sentence+1:chunk.lastIndexOf(' ');
  return {preview:chunk.slice(0,end>0?end:limit).trim()+'…',full:clean,collapsed:true};
}
