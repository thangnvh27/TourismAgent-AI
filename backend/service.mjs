import { randomUUID, createHash } from 'node:crypto';
import {
  normalizeRequest,
  validateRequest,
  validateItinerary,
  finalizeTrip,
  getContext,
  balanceTrip,
} from '../frontend/tour-engine.js';

/* ==========================================================================
   Tiện ích dùng chung
   ========================================================================== */

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Ném ApiError (dùng như một lệnh "throw" ngắn gọn).
const error = (status, code, message) => {
  throw new ApiError(status, code, message);
};

const MAX_DOC_BYTES = 256 * 1024;
const PROPOSAL_TTL_MS = 30 * 60 * 1000;
const JOB_LEASE_MS = 5 * 60 * 1000;
const VN_OFFSET_MS = 7 * 3600 * 1000;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const clean = (value) => JSON.parse(JSON.stringify(value));
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

// Kiểm tra mã dữ liệu (tripId, jobId, proposalId...) trước khi ghép vào đường dẫn.
const id = (value) => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) {
    error(400, 'INVALID_ID', 'Mã dữ liệu không hợp lệ.');
  }
  return value;
};

// Chặn tài liệu quá lớn trước khi ghi vào database.
const sized = (value) => {
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_DOC_BYTES) {
    error(413, 'DOCUMENT_TOO_LARGE', 'Dữ liệu quá lớn để lưu. Rút ngắn lịch trình.');
  }
  return clean(value);
};

const statePath = (tripId) => `trips/${id(tripId)}/state/current`;

/* ==========================================================================
   Chuẩn hóa dữ liệu chuyến đi
   ========================================================================== */

// Chuyển dữ liệu tour bất kỳ thành dạng chuẩn, đã kiểm tra hợp lệ.
function canonical(trip, extra = {}) {
  if (!trip || !trip.request || !trip.itinerary) {
    error(400, 'INVALID_TRIP', 'Thiếu dữ liệu chuyến đi.');
  }

  const request = normalizeRequest({ ...trip.request, sendEmail: false, email: '' });
  const errors = validateRequest(request);
  if (errors.length) error(422, 'INVALID_TRIP', errors[0]);

  const itinerary = validateItinerary(trip.itinerary, request);
  const result = finalizeTrip(request, itinerary, {
    schemaVersion: 3,
    requestId: trip.requestId || randomUUID(),
    revision: trip.revision || 0,
    emailStatus: 'not_requested',
    ...extra,
  });

  delete result.html;
  delete result.request.email;
  delete result.request.sendEmail;
  return sized(result);
}

// Đọc các thay đổi người dùng yêu cầu rõ ràng (từ form hoặc từ câu hỏi).
function explicitChanges(question, base, raw = {}) {
  const allowed = ['days', 'people', 'budget', 'pace', 'transport', 'interests'];
  const patch = {};

  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const key of allowed) {
      if (raw[key] !== undefined) patch[key] = raw[key];
    }
  }

  // Bỏ dấu tiếng Việt để dễ so khớp.
  const q = question
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLowerCase();

  const days = q.match(/(?:doi|thanh|con|tang len|giam con)\s*(\d{1,2})\s*ngay/);
  const people = q.match(/(?:doi|thanh|con|cho)\s*(\d{1,2})\s*nguoi/);
  if (days && !('days' in patch)) patch.days = Number(days[1]);
  if (people && !('people' in patch)) patch.people = Number(people[1]);

  const isMillion = (unit) => unit === 'trieu' || unit === 'tr';

  // "giảm / tăng ngân sách 1 triệu"
  const amount = q.match(/(giam|tang)(?:\s+ngan sach)?\s+(\d+(?:[.,]\d+)?)\s*(trieu|tr|nghin|ngan|k)/);
  if (amount && !('budget' in patch)) {
    const sign = amount[1] === 'giam' ? -1 : 1;
    const value = Number(amount[2].replace(',', '.')) * (isMillion(amount[3]) ? 1e6 : 1000);
    patch.budget = base.request.budget + sign * value;
  }

  // "ngân sách là 10 triệu"
  const absolute = q.match(/ngan sach\s*(?:la|thanh|con)?\s*(\d+(?:[.,]\d+)?)\s*(trieu|tr|nghin|ngan|k)/);
  if (absolute && !amount && !('budget' in patch)) {
    patch.budget = Number(absolute[1].replace(',', '.')) * (isMillion(absolute[2]) ? 1e6 : 1000);
  }

  return patch;
}

/* ==========================================================================
   Service chính
   ========================================================================== */

// Giới hạn mặc định cao hơn để thoải mái test. Hãy đặt lại thấp trước khi chạy thật.
export function createService({
  store,
  forward,
  clock = () => Date.now(),
  concurrency = 2,
  limits = { generate: 30, guide: 100, email: 10 },
}) {
  const stamp = () => new Date(clock()).toISOString();
  // Ngày dùng để đếm hạn mức, tính theo giờ Việt Nam (UTC+7).
  const day = () => new Date(clock() + VN_OFFSET_MS).toISOString().slice(0, 10);

  const queue = [];
  const timers = new Set();
  let running = 0;
  let closed = false;

  // Dữ liệu tóm tắt của một tour (lưu ở trips/{tripId}).
  const meta = (uid, t, extra = {}) => ({
    ownerId: uid,
    requestId: t.requestId,
    title: t.itinerary.title,
    destination: t.destination,
    startDate: t.request.startDate || '',
    days: t.request.days,
    people: t.request.people,
    budget: t.request.budget,
    estimatedCost: t.budgetAudit.total,
    revision: t.revision,
    status: 'ready',
    updatedAt: stamp(),
    ...extra,
  });

  /* ---------- Đọc dữ liệu ---------- */

  // Lấy tour và kiểm tra thuộc về người dùng.
  async function owned(uid, tripId, tx = store) {
    const m = await tx.get(`trips/${id(tripId)}`);
    if (!m || m.ownerId !== uid || m.status === 'deleting') {
      error(404, 'TRIP_NOT_FOUND', 'Không tìm thấy chuyến đi của bạn.');
    }
    return m;
  }

  async function trip(uid, tripId) {
    const m = await owned(uid, tripId);
    const t = await store.get(statePath(tripId));
    if (!t) error(503, 'TRIP_STATE_MISSING', 'Chuyến đi chưa sẵn sàng.');
    return { ...t, tripId, revision: m.revision, canUndo: !!m.canUndo, origin: m.origin };
  }

  /* ---------- Hàng đợi công việc ---------- */

  function enqueue(jobId) {
    if (!queue.includes(jobId)) queue.push(jobId);
    drain();
  }

  function drain() {
    while (!closed && running < concurrency && queue.length) {
      running++;
      run(queue.shift())
        .catch(() => {})
        .finally(() => {
          running--;
          drain();
        });
    }
  }

  // Nhận yêu cầu tạo tour / hỏi An: kiểm tra hạn mức, tạo job rồi đưa vào hàng đợi.
  async function start(uid, operation, body, key) {
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(key || '')) {
      error(400, 'IDEMPOTENCY_REQUIRED', 'Thiếu khóa chống trùng hợp lệ.');
    }

    const request = sized(body);
    const requestHash = hash(request);
    const jobId = hash([uid, operation, key]);
    const path = `jobs/${jobId}`;
    const usage = `users/${uid}/usage/${day()}`;

    const result = await store.transaction(async (tx) => {
      // Cùng khóa + cùng nội dung: trả lại job cũ, không tính thêm lượt.
      const old = await tx.get(path);
      if (old) {
        if (old.ownerId !== uid || old.operation !== operation || old.requestHash !== requestHash) {
          error(409, 'IDEMPOTENCY_CONFLICT', 'Khóa đã dùng cho nội dung khác.');
        }
        return old;
      }

      // Kiểm tra hạn mức theo ngày.
      const count = (await tx.get(usage)) || {};
      const bucket = operation === 'generate' ? 'generate' : 'guide';
      if ((count[bucket] || 0) >= (limits[bucket] || 20)) {
        error(429, 'DAILY_LIMIT', 'Đã đạt giới hạn sử dụng hôm nay.');
      }

      const job = {
        ownerId: uid,
        operation,
        tripId: operation === 'generate' ? 'trip-' + jobId.slice(0, 32) : request.tripId || '',
        requestHash,
        request,
        requestRetained: true,
        state: 'queued',
        usagePath: usage, // dùng để hoàn lượt nếu job lỗi
        createdAt: stamp(),
        updatedAt: stamp(),
      };

      tx.set(path, job);
      tx.set(usage, {
        ...count,
        [bucket]: (count[bucket] || 0) + 1,
        createdAt: count.createdAt || stamp(),
        updatedAt: stamp(),
      });
      return job;
    });

    if (result.state === 'queued') enqueue(jobId);
    return { ok: true, status: 202, jobId, state: result.state };
  }

  // Chạy một job: queued -> running -> succeeded | failed | unknown.
  async function run(jobId) {
    const path = `jobs/${jobId}`;

    // Nhận job (chỉ khi đang queued).
    const job = await store.transaction(async (tx) => {
      const j = await tx.get(path);
      if (!j || j.state !== 'queued') return null;
      const next = {
        ...j,
        state: 'running',
        leaseUntil: new Date(clock() + JOB_LEASE_MS).toISOString(),
        updatedAt: stamp(),
      };
      tx.set(path, next);
      return next;
    });
    if (!job) return;

    try {
      const result =
        job.operation === 'generate'
          ? await generate(job.ownerId, job.request, jobId)
          : await guide(job.ownerId, job.request, jobId);

      await store.transaction(async (tx) => {
        const j = await tx.get(path);
        if (j?.state === 'running') {
          tx.set(path, {
            ...j,
            request: {},
            requestRetained: false,
            state: 'succeeded',
            result,
            updatedAt: stamp(),
          });
        }
      });
    } catch (e) {
      // Ghi trạng thái lỗi.
      try {
        await store.transaction(async (tx) => {
          const j = await tx.get(path);
          if (j?.state === 'running') {
            tx.set(path, {
              ...j,
              state: e.uncertain ? 'unknown' : 'failed',
              error: {
                status: e.status || 503,
                code: e.code || 'SERVICE_UNAVAILABLE',
                message: e.status ? e.message : 'Dịch vụ tạm thời không khả dụng.',
              },
              updatedAt: stamp(),
            });
          }
        });
      } catch {
        /* Bộ phục hồi (recover) sẽ đánh dấu job không xác định. */
      }

      // Hoàn lại lượt khi lỗi rõ ràng. Không hoàn nếu kết quả chưa xác định
      // (n8n có thể đã chạy xong).
      if (!e.uncertain && job.usagePath) {
        const bucket = job.operation === 'generate' ? 'generate' : 'guide';
        try {
          await store.transaction(async (tx) => {
            const c = await tx.get(job.usagePath);
            if (c && c[bucket] > 0) {
              tx.set(job.usagePath, { ...c, [bucket]: c[bucket] - 1, updatedAt: stamp() });
            }
          });
        } catch {
          /* Hoàn lượt là việc cố gắng hết sức, lỗi cũng bỏ qua. */
        }
      }
    }
  }

  /* ---------- Gọi n8n ---------- */

  async function call(kind, body) {
    let r;
    try {
      r = await forward(kind, body);
    } catch (e) {
      if (e instanceof ApiError) throw e;
      const ex = new ApiError(
        503,
        'N8N_OUTCOME_UNKNOWN',
        'Chưa xác nhận được kết quả từ n8n. Kiểm tra execution trước khi tạo lại.',
      );
      ex.uncertain = true;
      throw ex;
    }

    if (r.status >= 400 || r.data?.error) {
      error(
        r.status >= 400 ? r.status : 502,
        r.data?.code || 'N8N_FAILED',
        String(r.data?.error || 'n8n không xử lý được yêu cầu.').slice(0, 400),
      );
    }
    return r.data;
  }

  /* ---------- Tạo tour bằng AI ---------- */

  async function generate(uid, b, jobId) {
    const request = normalizeRequest({ ...b, sendEmail: false, email: '' });
    const errs = validateRequest(request);
    if (errs.length) error(400, 'INVALID_INPUT', errs[0]);

    const output = await call('trip', request);
    const tripId = 'trip-' + jobId.slice(0, 32);
    const t = canonical({ ...output, request }, { tripId, revision: 0 });

    try {
      await store.transaction(async (tx) => {
        const m = await tx.get(`trips/${tripId}`);
        if (m) {
          if (m.ownerId !== uid) error(409, 'TRIP_CONFLICT', 'Mã tour đã được sử dụng.');
          return; // tour đã được lưu trước đó
        }
        tx.set(`trips/${tripId}`, meta(uid, t, { createdAt: stamp(), origin: 'ai', canUndo: false }));
        tx.set(statePath(tripId), t);
      });
    } catch (e) {
      if (!e.status) e.uncertain = true;
      throw e;
    }

    return { kind: 'trip', tripId, emailRequested: b.sendEmail === true };
  }

  /* ---------- Hỏi đáp / chỉnh tour với An ---------- */

  async function guide(uid, b, jobId) {
    const baseline = await trip(uid, id(b.tripId));
    const mode = b.mode === 'edit' ? 'edit' : 'ask';
    const question = String(b.question || '').trim();
    if (!question || question.length > 1000) {
      error(400, 'INVALID_QUESTION', 'Câu hỏi cần 1–1000 ký tự.');
    }

    // Lịch sử hội thoại gần nhất.
    const recent = await store.query(`trips/${b.tripId}/messages`, { orderBy: 'createdAt', limit: 6 });
    const history = recent.reverse().map((m) => ({ role: m.role, content: m.text }));

    // Các thay đổi người dùng yêu cầu (chỉ khi chỉnh tour).
    const desired = mode === 'edit' ? explicitChanges(question, baseline, b.desiredChanges) : {};
    if (Object.keys(desired).length) {
      const target = normalizeRequest({ ...baseline.request, ...desired });
      const errors = validateRequest(target);
      if (errors.length) error(400, 'INVALID_CHANGE', errors[0]);
      for (const key of Object.keys(desired)) desired[key] = target[key];
    }

    // Ghép câu hỏi gửi cho AI (giới hạn 1000 ký tự).
    const answerStyle =
      '\nPhần answer: tối đa 80 từ, 2–3 ý ngắn, đi thẳng vào câu hỏi; không chào lại. Giữ proposal đầy đủ nếu chỉnh tour.';
    const changeText = Object.keys(desired).length
      ? '\nCác giá trị mới người dùng yêu cầu: ' + JSON.stringify(desired)
      : '';
    const style = /chi tiết|đầy đủ|phân tích kỹ/i.test(question) ? '' : answerStyle;
    const modelQuestion = question.slice(0, 1000 - changeText.length - style.length) + changeText + style;

    const response = await call('guide', {
      mode,
      question: modelQuestion,
      itinerary: baseline.itinerary,
      request: baseline.request,
      destination: baseline.destination,
      revision: baseline.revision,
      history,
    });

    if (typeof response.answer !== 'string' || !response.answer.trim()) {
      error(502, 'INVALID_ANSWER', 'AI chưa trả lời hợp lệ.');
    }

    const answer = response.answer.slice(0, 4000);
    const sources = getContext(baseline.destination).sources.filter((s) =>
      (response.sources || []).some((x) => x.id === s.id),
    );

    // Chế độ chỉnh tour: kiểm tra bản đề xuất của AI.
    let proposal = null;
    if (mode === 'edit') {
      const raw = response.proposal;
      const rawWithCost = raw?.request
        ? {
            ...raw,
            request: {
              ...raw.request,
              costSettings: {
                ...raw.request.costSettings,
                activitiesPerPersonDay: baseline.request.costSettings.activitiesPerPersonDay,
              },
            },
          }
        : raw;

      proposal = canonical(rawWithCost, { tripId: b.tripId, revision: baseline.revision + 1 });

      // AI không được tự ý đổi thông tin ngoài phần được yêu cầu.
      for (const key of Object.keys(baseline.request)) {
        if (['email', 'sendEmail'].includes(key)) continue;
        const changed = JSON.stringify(baseline.request[key]) !== JSON.stringify(proposal.request[key]);
        const allowedChange = JSON.stringify(desired[key]) === JSON.stringify(proposal.request[key]);
        if (changed && !allowedChange) {
          error(
            422,
            'UNAUTHORIZED_CHANGE',
            'AI thay đổi thông tin chưa được yêu cầu: ' + key + '. Chọn giá trị trong phần chỉnh sửa.',
          );
        }
      }

      // AI phải áp dụng đúng các giá trị được yêu cầu.
      for (const key of Object.keys(desired)) {
        if (JSON.stringify(proposal.request[key]) !== JSON.stringify(desired[key])) {
          error(422, 'REQUESTED_CHANGE_MISSING', 'AI chưa áp dụng đúng giá trị được yêu cầu: ' + key + '.');
        }
      }
    }

    // Lưu đề xuất và tin nhắn.
    const proposalId = 'proposal-' + jobId.slice(0, 32);
    const proposalPath = `trips/${b.tripId}/proposals/${proposalId}`;

    await store.transaction(async (tx) => {
      const m = await owned(uid, b.tripId, tx);
      if (m.revision !== baseline.revision) {
        error(409, 'REVISION_CONFLICT', 'Tour đã thay đổi. Tải bản mới và đề xuất lại.');
      }

      if (proposal) {
        tx.set(
          proposalPath,
          sized({
            ownerId: uid,
            baseRevision: m.revision,
            candidate: proposal,
            before: baseline,
            snapshotState: 'full',
            status: 'pending',
            expiresAt: new Date(clock() + PROPOSAL_TTL_MS).toISOString(),
            createdAt: stamp(),
          }),
        );
      }

      tx.set(`trips/${b.tripId}/messages/${jobId}-0`, { role: 'user', text: question, createdAt: stamp() });
      tx.set(`trips/${b.tripId}/messages/${jobId}-1`, { role: 'assistant', text: answer, createdAt: stamp() });
    });

    return {
      kind: 'guide',
      tripId: b.tripId,
      answer,
      sources,
      ...(proposal ? { proposalId, expectedRevision: baseline.revision } : {}),
    };
  }

  /* ---------- Trạng thái job ---------- */

  async function getJob(uid, jobId) {
    const j = await store.get(`jobs/${id(jobId)}`);
    if (!j || j.ownerId !== uid) error(404, 'JOB_NOT_FOUND', 'Không tìm thấy công việc.');

    let result;
    if (j.state === 'succeeded') {
      result =
        j.result.kind === 'trip'
          ? await trip(uid, j.result.tripId)
          : { answer: j.result.answer, sources: j.result.sources };

      if (j.result.proposalId) {
        const p = await store.get(`trips/${j.result.tripId}/proposals/${j.result.proposalId}`);
        if (p?.candidate) {
          Object.assign(result, {
            proposal: p.candidate,
            proposalId: j.result.proposalId,
            expectedRevision: j.result.expectedRevision,
            expiresAt: p.expiresAt,
          });
        }
      }
    }

    return {
      ok: true,
      jobId,
      state: j.state,
      ...(result ? { result } : {}),
      ...(j.error ? { error: j.error.message, code: j.error.code, status: j.error.status } : {}),
      emailRequested: j.result?.emailRequested === true,
    };
  }

  /* ---------- Duyệt, hoàn tác, cân đối ngân sách ---------- */

  // Áp dụng một bản đề xuất (cần người dùng xác nhận).
  async function apply(uid, tripId, proposalId, expected, confirmed) {
    if (confirmed !== true || !Number.isInteger(expected)) {
      error(400, 'CONFIRMATION_REQUIRED', 'Cần xác nhận và phiên bản tour.');
    }

    const receipt = await store.transaction(async (tx) => {
      const m = await owned(uid, tripId, tx);
      const proposalPath = `trips/${tripId}/proposals/${id(proposalId)}`;
      const p = await tx.get(proposalPath);
      const current = await tx.get(statePath(tripId));

      if (!p || p.ownerId !== uid) error(404, 'PROPOSAL_NOT_FOUND', 'Không tìm thấy đề xuất.');
      if (p.status === 'applied') return { idempotent: true, appliedRevision: p.appliedRevision };
      if (p.status !== 'pending' || Date.parse(p.expiresAt) <= clock()) {
        error(410, 'PROPOSAL_EXPIRED', 'Đề xuất đã hết hạn.');
      }
      if (m.revision !== expected || p.baseRevision !== expected) {
        error(409, 'REVISION_CONFLICT', 'Tour đã thay đổi. Tải bản mới trước khi duyệt.');
      }

      const next = { ...p.candidate, tripId, revision: m.revision + 1 };
      tx.set(`trips/${tripId}/versions/previous`, current); // để hoàn tác
      tx.set(statePath(tripId), next);
      tx.set(`trips/${tripId}`, meta(uid, next, { createdAt: m.createdAt, origin: m.origin, canUndo: true }));
      tx.set(proposalPath, { ...p, status: 'applied', appliedAt: stamp(), appliedRevision: next.revision });
      return { idempotent: false, appliedRevision: next.revision };
    });

    return { ...(await trip(uid, tripId)), ...receipt };
  }

  // Hoàn tác về bản trước.
  async function undo(uid, tripId, expected) {
    await store.transaction(async (tx) => {
      const m = await owned(uid, tripId, tx);
      const prev = await tx.get(`trips/${tripId}/versions/previous`);

      if (m.revision !== expected) error(409, 'REVISION_CONFLICT', 'Phiên bản đã thay đổi.');
      if (!m.canUndo || !prev) error(409, 'NO_PREVIOUS_VERSION', 'Không có bản trước để hoàn tác.');

      const t = { ...prev, tripId, revision: m.revision + 1, emailStatus: 'not_requested' };
      tx.set(statePath(tripId), t);
      tx.set(`trips/${tripId}`, { ...meta(uid, t), createdAt: m.createdAt, origin: m.origin, canUndo: false });
      tx.delete(`trips/${tripId}/versions/previous`);
    });

    return trip(uid, tripId);
  }

  // Đề xuất chỉnh dự toán vé khứ hồi / trải nghiệm.
  async function budgetProposal(uid, tripId, expected, settings) {
    const base = await trip(uid, tripId);
    if (base.revision !== expected) error(409, 'REVISION_CONFLICT', 'Tour đã thay đổi.');

    const allowedKeys = ['arrivalPerPerson', 'arrivalKnown', 'activitiesPerPersonDay'];
    if (
      !settings ||
      typeof settings !== 'object' ||
      Array.isArray(settings) ||
      Object.keys(settings).some((k) => !allowedKeys.includes(k))
    ) {
      error(400, 'INVALID_COST_SETTINGS', 'Chỉ chỉnh vé khứ hồi và dự trù trải nghiệm.');
    }
    if (settings.arrivalKnown !== undefined && typeof settings.arrivalKnown !== 'boolean') {
      error(400, 'INVALID_COST_SETTINGS', 'Trạng thái vé không hợp lệ.');
    }
    for (const key of ['arrivalPerPerson', 'activitiesPerPersonDay']) {
      const v = settings[key];
      if (v !== undefined && (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1e8)) {
        error(400, 'INVALID_COST_SETTINGS', 'Dự toán vé phải từ 0 đến 100 triệu đồng.');
      }
    }

    const candidate = canonical(
      { ...base, request: { ...base.request, costSettings: { ...base.request.costSettings, ...settings } } },
      { tripId, revision: base.revision + 1 },
    );
    const proposalId = 'proposal-' + randomUUID();

    await store.transaction(async (tx) => {
      const m = await owned(uid, tripId, tx);
      if (m.revision !== expected) error(409, 'REVISION_CONFLICT', 'Tour đã thay đổi.');
      tx.set(
        `trips/${tripId}/proposals/${proposalId}`,
        sized({
          ownerId: uid,
          baseRevision: expected,
          candidate,
          before: base,
          snapshotState: 'full',
          status: 'pending',
          expiresAt: new Date(clock() + PROPOSAL_TTL_MS).toISOString(),
          createdAt: stamp(),
        }),
      );
    });

    return { proposal: candidate, proposalId, expectedRevision: expected };
  }

  // Đề xuất phương án cân đối khi vượt ngân sách.
  async function balance(uid, tripId, expected) {
    const base = await trip(uid, tripId);
    if (base.revision !== expected) error(409, 'REVISION_CONFLICT', 'Tour đã thay đổi.');

    const result = balanceTrip(base);
    if (!result.proposal) error(409, 'NO_BALANCE_PROPOSAL', result.message);

    const proposalId = 'proposal-' + randomUUID();

    await store.transaction(async (tx) => {
      const m = await owned(uid, tripId, tx);
      if (m.revision !== expected) error(409, 'REVISION_CONFLICT', 'Tour đã thay đổi.');
      tx.set(
        `trips/${tripId}/proposals/${proposalId}`,
        sized({
          ownerId: uid,
          baseRevision: expected,
          candidate: canonical(result.proposal),
          before: base,
          snapshotState: 'full',
          status: 'pending',
          expiresAt: new Date(clock() + PROPOSAL_TTL_MS).toISOString(),
          createdAt: stamp(),
        }),
      );
    });

    return { proposal: result.proposal, proposalId, expectedRevision: expected };
  }

  /* ---------- Tin nhắn, danh sách, nhập tour ---------- */

  async function messages(uid, tripId) {
    await owned(uid, tripId);
    const rows = await store.query(`trips/${tripId}/messages`, { orderBy: 'createdAt', limit: 40 });

    return {
      ok: true,
      messages: rows
        .reverse()
        .filter((m) => ['user', 'assistant'].includes(m.role) && typeof m.text === 'string')
        .map((m) => ({ role: m.role, text: m.text.slice(0, 4000), createdAt: m.createdAt })),
    };
  }

  async function list(uid, cursor) {
    let after;
    try {
      if (cursor) after = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      if (after && (typeof after.value !== 'string' || typeof after.id !== 'string')) throw Error();
    } catch {
      error(400, 'INVALID_CURSOR', 'Con trỏ danh sách không hợp lệ.');
    }

    const rows = await store.query('trips', {
      where: [['ownerId', '==', uid]],
      orderBy: 'updatedAt',
      limit: 20,
      after,
    });
    const last = rows.at(-1);

    return {
      ok: true,
      trips: rows.filter((x) => x.status !== 'deleting').map(({ path, ...x }) => x),
      nextCursor:
        rows.length === 20
          ? Buffer.from(JSON.stringify({ value: last.updatedAt, id: last.id })).toString('base64url')
          : null,
    };
  }

  // Nhập tour từ trình duyệt vào tài khoản (tối đa 5 tour mỗi ngày).
  async function importTrip(uid, raw, key) {
    const t = canonical(raw, { revision: 0 });
    const tripId = 'trip-' + hash([uid, key]).slice(0, 32);
    const importHash = hash([t.request, t.itinerary]);
    const usage = `users/${uid}/usage/${day()}`;

    await store.transaction(async (tx) => {
      const m = await tx.get(`trips/${tripId}`);
      const count = (await tx.get(usage)) || {};

      if (m) {
        if (m.ownerId !== uid) error(404, 'TRIP_NOT_FOUND', 'Không tìm thấy tour.');
        if (m.importHash !== importHash) {
          error(409, 'IDEMPOTENCY_CONFLICT', 'Khóa import đã dùng cho tour khác.');
        }
        return; // đã nhập trước đó
      }

      if ((count.import || 0) >= 5) error(429, 'DAILY_LIMIT', 'Tối đa 5 tour nhập mỗi ngày.');

      tx.set(
        `trips/${tripId}`,
        meta(uid, t, { createdAt: stamp(), origin: 'imported', canUndo: false, importHash }),
      );
      tx.set(statePath(tripId), { ...t, tripId, imported: true });
      tx.set(usage, {
        ...count,
        import: (count.import || 0) + 1,
        createdAt: count.createdAt || stamp(),
        updatedAt: stamp(),
      });
    });

    return trip(uid, tripId);
  }

  /* ---------- Gửi email ---------- */

  async function email(uid, tripId, expected, recipient) {
    if (!EMAIL_REGEX.test(recipient || '') || recipient.length > 254) {
      error(400, 'INVALID_EMAIL', 'Email không hợp lệ.');
    }

    const mailId = hash([uid, tripId, expected, recipient.toLowerCase()]);
    const mailPath = `mailJobs/${mailId}`;
    const usage = `users/${uid}/usage/${day()}`;

    // Bước 1: giữ chỗ (chống gửi trùng) và kiểm tra điều kiện.
    const claim = await store.transaction(async (tx) => {
      const m = await owned(uid, tripId, tx);
      const t = await tx.get(statePath(tripId));
      const old = await tx.get(mailPath);
      const count = (await tx.get(usage)) || {};

      if (old) return { old };

      if (m.revision !== expected) error(409, 'REVISION_CONFLICT', 'Tour đã thay đổi.');
      if (t.budgetAudit.activityBuffer > 0) {
        error(
          422,
          'UNALLOCATED_TICKET_ESTIMATE',
          'Khoản dự trù vé chưa phân bổ: tải lịch trình để giữ đúng tổng dự toán.',
        );
      }
      if (m.origin !== 'ai') {
        error(400, 'IMPORTED_EMAIL_DISABLED', 'Tour nhập từ trình duyệt chưa được xác minh để gửi email.');
      }
      if ((count.email || 0) >= limits.email) {
        error(429, 'DAILY_LIMIT', 'Đã đạt giới hạn email hôm nay.');
      }

      const mail = {
        ownerId: uid,
        tripId,
        revision: expected,
        recipient,
        status: 'sending',
        createdAt: stamp(),
        updatedAt: stamp(),
        leaseUntil: new Date(clock() + JOB_LEASE_MS).toISOString(),
      };
      tx.set(mailPath, mail);
      tx.set(usage, {
        ...count,
        email: (count.email || 0) + 1,
        createdAt: count.createdAt || stamp(),
        updatedAt: stamp(),
      });
      return { mail, trip: t };
    });

    // Yêu cầu này đã được xử lý trước đó.
    if (claim.old) {
      const sent = claim.old.status === 'sent';
      return {
        ok: sent,
        emailSent: sent,
        emailStatus: claim.old.status,
        idempotent: true,
        ...(sent ? {} : { error: 'Yêu cầu đã ghi nhận; kiểm tra kết quả trước khi gửi lại.' }),
      };
    }

    // Bước 2: gọi n8n. Trước hết dò xem workflow có hỗ trợ action "email" không.
    let status = 'unknown';
    try {
      const probe = await forward('trip', { action: 'email' });
      if (probe.data?.code !== 'INVALID_EMAIL_INPUT') {
        status = 'failed';
      } else {
        const r = await forward('trip', {
          ...claim.trip.request,
          email: recipient,
          sendEmail: true,
          action: 'email',
          itinerary: claim.trip.itinerary,
          revision: expected,
        });
        if (r.data?.emailSent === true && r.data?.emailStatus === 'sent') status = 'sent';
        else if (r.data?.emailStatus === 'failed') status = 'failed';
      }
    } catch {
      /* Gmail có thể đã nhận thư, nên giữ trạng thái "unknown". */
    }

    // Bước 3: ghi kết quả.
    await store.transaction(async (tx) => {
      const mail = await tx.get(mailPath);
      if (mail) tx.set(mailPath, { ...mail, status, updatedAt: stamp() });
    });

    const failedText =
      status === 'failed'
        ? 'Gửi thất bại hoặc workflow email cần cập nhật.'
        : 'Chưa xác định kết quả gửi. Kiểm tra hộp thư/execution; không tự gửi lại.';

    return {
      ok: status === 'sent',
      emailSent: status === 'sent',
      emailStatus: status,
      ...(status === 'sent' ? {} : { error: failedText }),
    };
  }

  /* ---------- Xóa tour ---------- */

  async function remove(uid, tripId) {
    // Đánh dấu đang xóa để các request khác không truy cập được nữa.
    await store.transaction(async (tx) => {
      const m = await owned(uid, tripId, tx);
      tx.set(`trips/${tripId}`, { ...m, status: 'deleting', updatedAt: stamp() });
    });

    // Xóa nội dung nhạy cảm trong job và mailJob liên quan.
    for (const collection of ['jobs', 'mailJobs']) {
      let after;
      do {
        const rows = await store.query(collection, {
          where: [['ownerId', '==', uid], ['tripId', '==', tripId]],
          limit: 100,
          after,
        });

        for (const row of rows) {
          await store.transaction(async (tx) => {
            const current = await tx.get(row.path);
            if (!current) return;

            tx.set(
              row.path,
              collection === 'jobs'
                ? {
                    ...current,
                    request: {},
                    requestRetained: false,
                    result: {},
                    state: 'cancelled',
                    error: { status: 410, code: 'TRIP_DELETED', message: 'Chuyến đi đã được xóa.' },
                    updatedAt: stamp(),
                  }
                : { ...current, recipient: '', tripDeleted: true, updatedAt: stamp() },
            );
          });
        }

        const last = rows.at(-1);
        after = rows.length === 100 ? { value: last.createdAt, id: last.id } : null;
      } while (after);
    }

    await store.deleteTree(`trips/${tripId}`);
    return { ok: true };
  }

  /* ---------- Phục hồi sau khi server khởi động lại ---------- */

  async function recover() {
    // Job đang chờ: đưa lại vào hàng đợi.
    for (const j of await store.query('jobs', { where: [['state', '==', 'queued']], limit: 100 })) {
      enqueue(j.id);
    }

    // Job đang chạy nhưng đã quá hạn: đánh dấu không xác định.
    const staleJobs = await store.query('jobs', {
      where: [['state', '==', 'running'], ['leaseUntil', '<', stamp()]],
      orderBy: 'leaseUntil',
      desc: false,
      limit: 100,
    });
    for (const j of staleJobs) {
      await store.transaction(async (tx) => {
        const current = await tx.get(j.path);
        if (current?.state === 'running' && current.leaseUntil < stamp()) {
          tx.set(j.path, {
            ...current,
            state: 'unknown',
            error: {
              status: 503,
              code: 'JOB_INTERRUPTED',
              message: 'Công việc bị gián đoạn. Kiểm tra execution n8n trước khi thử lại.',
            },
            updatedAt: stamp(),
          });
        }
      });
    }

    // Email đang gửi nhưng đã quá hạn: đánh dấu không xác định.
    const staleMails = await store.query('mailJobs', {
      where: [['status', '==', 'sending'], ['leaseUntil', '<', stamp()]],
      orderBy: 'leaseUntil',
      desc: false,
      limit: 100,
    });
    for (const m of staleMails) {
      await store.transaction(async (tx) => {
        const current = await tx.get(m.path);
        if (current?.status === 'sending' && current.leaseUntil < stamp()) {
          tx.set(m.path, { ...current, status: 'unknown', updatedAt: stamp() });
        }
      });
    }
  }

  function schedule() {
    const timer = setInterval(() => recover().catch(() => {}), 5 * 60 * 1000);
    timer.unref();
    timers.add(timer);
    recover().catch(() => {});
  }

  /* ---------- Hồ sơ người dùng ---------- */

  async function profile(uid, patch) {
    const path = `users/${uid}`;

    if (patch) {
      await store.transaction(async (tx) => {
        const old = (await tx.get(path)) || {};
        tx.set(path, {
          ...old,
          displayName: String(patch.displayName || '').slice(0, 100),
          interests: Array.isArray(patch.interests)
            ? patch.interests
                .filter((x) => typeof x === 'string')
                .map((x) => x.slice(0, 80))
                .slice(0, 8)
            : [],
          createdAt: old.createdAt || stamp(),
          updatedAt: stamp(),
        });
      });
    }

    return { ok: true, profile: (await store.get(path)) || {} };
  }

  /* ---------- API công khai ---------- */

  return {
    start,
    getJob,
    trip,
    messages,
    budgetProposal,
    list,
    apply,
    undo,
    balance,
    email,
    remove,
    importTrip,
    profile,
    recover,
    schedule,
    close() {
      closed = true;
      for (const t of timers) clearInterval(t);
    },
    async waitIdle() {
      while (running || queue.length) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
    },
  };
}