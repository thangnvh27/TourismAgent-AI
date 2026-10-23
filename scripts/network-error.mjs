export function networkError(error) {
  const code = error.cause?.code || error.code || '';
  if (error.name === 'TimeoutError' || code.includes('TIMEOUT')) return { status: 504, code: 'N8N_TIMEOUT', error: 'n8n phản hồi quá lâu. Kiểm tra execution của workflow rồi thử lại.' };
  if (['EACCES', 'EPERM'].includes(code)) return { status: 502, code: 'NETWORK_PERMISSION_DENIED', error: 'Server bị chặn quyền kết nối mạng đến n8n. Khởi động server trong terminal có quyền mạng.' };
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return { status: 502, code: 'N8N_DNS_ERROR', error: 'Không phân giải được tên miền n8n. Kiểm tra URL webhook và kết nối Internet.' };
  if (code === 'ECONNREFUSED') return { status: 502, code: 'N8N_CONNECTION_REFUSED', error: 'n8n từ chối kết nối. Kiểm tra n8n đang chạy và đúng cổng trong .env.' };
  if (['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE'].includes(code)) return { status: 502, code: 'N8N_TLS_ERROR', error: 'Chứng chỉ HTTPS của n8n không hợp lệ. Kiểm tra chứng chỉ trên server n8n.' };
  return { status: 502, code: 'N8N_CONNECTION_FAILED', error: 'Không kết nối được n8n. Kiểm tra server và cấu hình .env.' };
}
