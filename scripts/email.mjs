import { createHash } from 'node:crypto';
import { normalizeRequest, validateRequest, validateItinerary } from '../frontend/tour-engine.js';

// Coalesce identical sends for ten minutes, including uncertain network outcomes.
// This local cache is not durable across server restarts.
export function createMailer(forward) {
  const cache = new Map();
  return async function sendEmail(body) {
    let request, itinerary;
    try {
      if (!body?.trip || body.trip.schemaVersion !== 3 || body.trip.demo) throw new Error('Chỉ gửi email cho tour AI v3.');
      request = normalizeRequest({ ...body.trip.request, email: body.email, sendEmail: true });
      const errors = validateRequest(request);
      if (errors.length) throw new Error(errors.join(' '));
      itinerary = validateItinerary(body.trip.itinerary, request);
    } catch (e) { return { status: 400, data: { error: e.message, code: 'INVALID_EMAIL_INPUT' } }; }
    const key = createHash('sha256').update(JSON.stringify({ request, itinerary })).digest('hex');
    for (const [k, value] of cache) if (value.expires < Date.now()) cache.delete(k);
    if (cache.has(key)) return cache.get(key).promise;
    if (cache.size >= 200) return { status: 429, data: { error: 'Quá nhiều yêu cầu gửi email. Vui lòng đợi.' } };
    const promise = (async () => {
      // Older workflows reject this empty probe without AI or Gmail. Require the
      // new validation code before sending a complete, potentially billable tour.
      const probe = await forward({ action: 'email' });
      if (probe.data?.code !== 'INVALID_EMAIL_INPUT') return { status: 409, data: { code: 'EMAIL_WORKFLOW_UPDATE_REQUIRED', error: 'Cần cập nhật và Publish workflow v3 có node 30 trước khi gửi bản đã chỉnh.' } };
      try {
        const result = await forward({ ...request, action: 'email', itinerary, revision: Math.max(0, Math.min(1000, Number(body.trip.revision) || 0)) });
        if (result.data?.action === 'email' && result.data.emailSent === true && result.data.emailStatus === 'sent') return { status: 200, data: { emailSent: true, emailStatus: 'sent', revision: body.trip.revision || 0 } };
        if (result.data?.action === 'email' && result.data.emailStatus === 'failed') return { status: 502, data: { emailSent: false, emailStatus: 'failed', error: 'Gmail báo gửi thất bại. Kiểm tra credential và execution n8n.' } };
      } catch { /* The message may already have been accepted by Gmail. */ }
      return { status: 503, data: { emailStatus: 'unknown', error: 'Chưa xác nhận được kết quả gửi. Kiểm tra hộp thư và execution n8n; hệ thống tạm chặn gửi lặp cùng bản trong 10 phút.' } };
    })();
    cache.set(key, { expires: Date.now() + 600000, promise });
    try { return await promise; } catch (e) { cache.delete(key); throw e; }
  };
}
