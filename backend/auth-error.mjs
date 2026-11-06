// Firebase can wrap certificate-download failures as auth/argument-error.
// Inspect the failure locally; never return SDK messages or tokens to clients.
export function authFailure(error) {
  const codes = new Set(['auth/internal-error', 'auth/network-request-failed', 'auth/invalid-credential', 'app/network-error', 'app/network-timeout', 'app/invalid-credential', 'EACCES', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT']);
  const unavailable = codes.has(error?.code) || codes.has(error?.cause?.code) || /Error fetching public keys|Error while making request|EACCES|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT/i.test(String(error?.message || ''));
  return unavailable
    ? {status:503, code:'AUTH_SERVICE_UNAVAILABLE', error:'Backend chưa kết nối được Firebase để xác minh đăng nhập. Thử lại sau; nếu lỗi tiếp diễn, kiểm tra mạng và cấu hình Firebase của backend.'}
    : {status:401, code:'AUTH_INVALID', error:'Phiên đăng nhập không hợp lệ hoặc đã hết hạn. Đăng xuất rồi đăng nhập lại.'};
}
