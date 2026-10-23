import { catalog } from './catalog.js';
import { normalizeRequest, finalizeTrip, getContext, validateRequest, validateItinerary } from './tour-engine.js';
export const money = n => Number(n || 0).toLocaleString('vi-VN') + ' đ';
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const destinations = {
  'Đà Nẵng': { subtitle: 'Từ biển xanh đến phố cổ', places: ['Biển Mỹ Khê', 'Bán đảo Sơn Trà', 'Ngũ Hành Sơn', 'Phố cổ Hội An', 'Chợ Hàn', 'Cầu Rồng'], food: 'mì Quảng, bánh tráng cuốn thịt heo và bún chả cá', detail: 'Dành thời gian nhìn biển, thưởng thức món địa phương và khám phá nhịp sống miền Trung.', note: 'Hội An cách Đà Nẵng khoảng 30 km; dành thời gian di chuyển.' },
  'Ninh Bình': { subtitle: 'Một cuộc hẹn giữa non xanh', places: ['Tràng An', 'Hang Múa', 'Cố đô Hoa Lư', 'Tam Cốc', 'Chùa Bích Động', 'Đầm Vân Long'], food: 'cơm cháy, thịt dê và miến lươn', detail: 'Đi thuyền giữa núi đá vôi, đi bộ khám phá di sản và tận hưởng làng quê.', note: 'Mang giày có độ bám tốt khi leo bậc đá; kiểm tra điều kiện đi thuyền.' },
  'Đà Lạt': { subtitle: 'Những ngày xanh trên cao nguyên', places: ['Hồ Xuân Hương', 'Đồi chè Cầu Đất', 'Thiền viện Trúc Lâm', 'Hồ Tuyền Lâm', 'Chợ Đà Lạt', 'Dinh Bảo Đại'], food: 'bánh căn, bánh ướt lòng gà và sữa đậu nành', detail: 'Khám phá đồi chè, ghé quán cà phê và tận hưởng không khí vùng cao.', note: 'Đồi chè nằm xa trung tâm; nên dành một buổi riêng. Mang áo khoác.' },
  'Phú Quốc': { subtitle: 'Theo nắng về miền biển đảo', places: ['Bãi Sao', 'Làng chài Hàm Ninh', 'Dương Đông', 'Bãi Trường', 'Chợ đêm Phú Quốc', 'Dinh Cậu'], food: 'bún quậy, gỏi cá trích và hải sản địa phương', detail: 'Thư giãn bên bờ biển và tìm hiểu đời sống làng chài.', note: 'Kiểm tra thời tiết thực tế trước hoạt động biển; dùng kem chống nắng.' },
  'Hạ Long': { subtitle: 'Giữa những kỳ quan trên mặt nước', places: ['Bãi Cháy', 'Vịnh Hạ Long', 'Bảo tàng Quảng Ninh', 'Chợ Hạ Long', 'Cầu Bãi Cháy', 'Bờ biển Hòn Gai'], food: 'chả mực, bún hải sản và bánh cuốn', detail: 'Khám phá cảnh quan vịnh, văn hóa địa phương và những góc biển yên bình.', note: 'Tuyến tàu phụ thuộc điều kiện thời tiết; xác minh vé và giờ chạy trước khi đi.' },
  'Hội An': { subtitle: 'Chậm một nhịp giữa phố vàng', places: ['Phố cổ Hội An', 'Làng gốm Thanh Hà', 'Biển An Bàng', 'Làng rau Trà Quế', 'Chợ Hội An', 'Bờ sông Hoài'], food: 'cao lầu, cơm gà và bánh mì Hội An', detail: 'Tản bộ trong phố cổ, ghé làng nghề và khám phá ẩm thực.', note: 'Chọn đi bộ trong phố cổ; hỏi rõ vé tham quan và giờ mở cửa.' }
};
for (const [name, entry] of Object.entries(catalog)) if (entry.demo) destinations[name] = entry.demo;
export function makeDemo(request) {
  const city = typeof request.destination === 'object' ? request.destination.name : request.destination, data = destinations[city] || destinations['Đà Nẵng'];
  const budget = Number(request.budget), people = Number(request.people), count = Number(request.days);
  const shares = { food: .24, transport: .17, accommodation: .29, activities: .17 };
  const cost = category => Math.floor(budget * shares[category] / count / 1000) * 1000;
  const days = Array.from({ length: count }, (_, index) => {
    const first = data.places[(index * 2) % data.places.length], second = data.places[(index * 2 + 1) % data.places.length];
    return { day: index + 1, title: index === 0 ? 'Chạm vào nhịp sống địa phương' : index === count - 1 ? 'Chậm lại và mang ký ức về' : 'Thêm một ngày, thêm một khám phá', activities: [
      { time: '08:00', name: first, description: `Khám phá ${first}, dành thời gian ngắm cảnh và chụp ảnh. ${request.pace === 'Thư thả' ? 'Bạn có thể nghỉ lâu hơn giữa các điểm.' : 'Ưu tiên di chuyển thuận tiện, tránh ghép quá nhiều điểm xa.'}`, category: 'activities', cost: cost('activities'), location: first + ', ' + city },
      { time: '12:00', name: 'Thưởng thức hương vị bản địa', description: `Gợi ý ${data.food}. Khoản này gồm dự trù các bữa ăn trong ngày cho ${people} người.`, category: 'food', cost: cost('food'), location: 'Nhà hàng địa phương, ' + city },
      { time: '14:30', name: second, description: `Ghé ${second} vào buổi chiều. Dự trù di chuyển trong ngày bằng ${request.transport.toLowerCase()}; xác minh quãng đường trước khi đi.`, category: 'transport', cost: cost('transport'), location: second + ', ' + city },
      { time: '19:00', name: index === count - 1 ? 'Khép lại hành trình' : 'Nghỉ ngơi và khám phá buổi tối', description: index === count - 1 ? 'Tự do mua quà và chuẩn bị trở về; không tính thêm đêm lưu trú cuối.' : 'Nhận phòng và nghỉ ngơi. Tiền phòng nằm trong bảng ngân sách riêng.', category: 'accommodation', cost: cost('accommodation'), location: 'Khu trung tâm, ' + city }
    ] };
  });
  const breakdown = Object.fromEntries(Object.keys(shares).map(k => [k, cost(k) * count]));
  const total = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const itinerary = { title: `${city} · ${data.subtitle}`, summary: `${count} ngày dành cho ${people} người. ${data.detail} Sở thích: ${request.interests.join(', ') || 'Khám phá địa phương'}. Đây là lịch trình mẫu để trải nghiệm giao diện, không phải kết quả AI.`, days, totalEstimatedCost: total, tips: [data.note, 'Xác minh giờ mở cửa, giá vé và đặt phòng trước chuyến đi.', 'Ngân sách chưa tính vé máy bay hoặc tàu đến điểm khởi hành.'] };
  const r = normalizeRequest(request), context = getContext(city);
  for (const d of itinerary.days) for (const a of d.activities) a.placeId = context.places.find(p => p.name === a.name)?.id || '';
  itinerary.tips = itinerary.tips.filter(t => !t.includes('Ngân sách chưa tính'));
  return finalizeTrip(r, itinerary, { demo: true, requestId: 'demo-' + Date.now(), revision: 0, emailStatus: 'demo', packing: ['Giấy tờ tùy thân', 'Giày đi bộ', 'Sạc và pin dự phòng', 'Kem chống nắng', 'Áo khoác nhẹ / áo mưa'] });
}
export function demoAnswer(question, trip) {
  const city = trip.destination, data = destinations[city] || destinations['Đà Nẵng'];
  if (/ăn|món|ẩm thực/i.test(question)) return `Ở ${city}, bạn có thể thử ${data.food}. Ưu tiên quán có giá niêm yết và hỏi rõ khẩu phần cho cả nhóm. Đây là gợi ý demo; bạn nên kiểm tra địa điểm thực tế trước khi ghé.`;
  if (/mang|chuẩn bị|hành lý/i.test(question)) return `Bạn nên mang ${trip.packing.join(', ').toLowerCase()}. ${data.note} Hãy xem dự báo thời tiết gần ngày khởi hành.`;
  if (/giá|chi phí|ngân sách/i.test(question)) return `Tổng dự toán mẫu gồm dự phòng là ${money(trip.itinerary.totalEstimatedCost)} cho cả nhóm ${trip.request.people} người. ${trip.budgetAudit.overBudget ? 'Vượt' : 'Còn'} ${money(Math.abs(trip.budgetAudit.remaining))} so với ngân sách. Các đơn giá là giả định lập kế hoạch, chưa phải báo giá thực tế.`;
  if (/thời tiết|mưa|nắng/i.test(question)) return 'Mình chưa có dữ liệu thời tiết trực tiếp. Bạn hãy kiểm tra dự báo từ nguồn khí tượng gần ngày đi, rồi điều chỉnh các hoạt động ngoài trời.';
  if (/giới thiệu|lịch trình|hành trình|tour/i.test(question)) return trip.narration;
  return `Mình đang ở chế độ demo và chỉ có một số gợi ý mẫu. Với hành trình ${city}, hãy dành thời gian cho ${data.places.slice(0, 2).join(' và ')}. ${data.note} Chuyển sang kết nối n8n để nhận câu trả lời AI theo câu hỏi của bạn.`;
}
export function validTrip(t) {
  try {
    if (!t || typeof t.destination !== 'string' || !t.request || !t.budgetAudit || !t.itinerary) return false;
    if (![t.packing, t.warnings, t.itinerary.tips || []].every(values => Array.isArray(values) && values.every(v => typeof v === 'string'))) return false;
    const audit = t.budgetAudit;
    if (![audit.budget,audit.total,audit.remaining,t.itinerary.totalEstimatedCost].every(Number.isFinite) || audit.budget < 500000 || audit.total < 0 || audit.total !== t.itinerary.totalEstimatedCost || !audit.breakdown || !Object.values(audit.breakdown).every(n => Number.isFinite(n) && n >= 0)) return false;
    const request = normalizeRequest({ ...t.request, destination: t.destination, sendEmail: false });
    if (validateRequest(request).length) return false;
    if (t.schemaVersion === 3 && (!t.request.costSettings || !Number.isInteger(audit.nights) || !Number.isInteger(audit.rooms) || !Number.isFinite(audit.perPerson))) return false;
    validateItinerary(t.itinerary, request);
    return true;
  } catch { return false; }
}
