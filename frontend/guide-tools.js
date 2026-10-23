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
    else if(JSON.stringify(a)!==JSON.stringify(b))changes.push(`Ngày ${i+1}: ${b.activities.map(x=>x.name).join(' → ')}`);
  }
  return changes;
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
