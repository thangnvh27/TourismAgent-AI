# Kết quả rà soát dự án

## Cập nhật mới: giới hạn dữ liệu, cân đối và email bản chỉnh

Source local đã nâng giới hạn request lên 512 KiB UTF-8, rút gọn ngữ cảnh chat có kiểm soát, bổ sung phương án tiết kiệm cho tour vượt ngân sách và API gửi đúng bản đang hiển thị. Workflow v3 nay có 30 node; node 30 tách email lịch trình có sẵn khỏi nhánh AI. Cần cập nhật và Publish JSON mới trên cloud để dùng email bản chỉnh và code chat mới. Frontend cân đối chạy ngay với tour v3 hiện có.

Các kiểm thử mới bao gồm tour 14 ngày với mô tả tiếng Việt vượt giới hạn cũ, bảo toàn mô tả hoạt động không chỉnh, dự toán cố định không khả thi, nhánh email bỏ qua AI, HTML đúng nội dung chỉnh, gộp gửi đồng thời và chặn gửi lại khi kết quả mạng chưa rõ. Kiểm thử email dùng mock Gmail, chưa gửi email thật trong lần nâng cấp này. Các kết quả cloud và tồn tại ở phần dưới là ghi nhận của lần rà soát trước, không xác nhận trạng thái triển khai mới.

Ngày kiểm tra: 10/10/2026. Rà soát mã nguồn, kiểm thử tự động, API local và webhook cloud; không gửi email.

## Đã xác minh thực tế

- `.env` trỏ đúng `/webhook/generate-trip-v3` và `/webhook/virtual-guide-v3`.
- Hai webhook xử lý yêu cầu thiếu dữ liệu với HTTP 400/JSON.
- AI tạo tour v3 2 ngày thành công, schemaVersion=3, tổng dự toán 4.800.000 đ với fixture kiểm tra, emailSent=false.
- Hỏi đáp hướng dẫn viên trả HTTP 200 và nguồn tham khảo.
- Chỉnh tour trả HTTP 502; upstream n8n.cloud trả HTML với tiêu đề “502: Bad gateway”. Chưa đọc execution trên cloud, nên chưa kết luận được node nào tạo ra lỗi gateway.

## Đã sửa trong source local

1. Prompt chỉnh tour yêu cầu hai định dạng mâu thuẫn. Hiện chỉ yêu cầu một envelope JSON có answer, requestPatch, itinerary. Ví dụ schema hợp lệ, requestPatch mặc định rỗng và số ngày dựa trên yêu cầu sau chỉnh.
2. Parser đề xuất lỗi trả HTTP 422/JSON thay vì 502; giữ tour hiện tại và mã AI_INVALID_PROPOSAL.
3. Bộ kiểm tra tour lưu trên trình duyệt/nhận từ API không bắt các phần tử null, ngày không phải số, ngân sách hoặc danh sách bị hỏng. Hiện từ chối các dữ liệu này mà không làm crash UI.
4. Danh mục điểm đến có thể truy xuất key kế thừa của Object; hiện chỉ nhận key được định nghĩa trong catalog. Chuẩn hóa request xử lý null/array an toàn, history bỏ mục null.
5. Vé khứ hồi nhập tiền nhưng chưa xác nhận vẫn được cộng vào tổng. Cảnh báo và narration nay ghi đúng là mức tạm nhập, thay vì nói chưa bao gồm.
6. Nút hỏi nhanh luôn chuyển về chế độ hỏi đáp. Sở thích mới do chỉnh tour bổ sung cũng xuất hiện trong form, tránh mất khi tạo lại.
7. Server hiện phân biệt upstream trả HTML/rỗng, kèm HTTP status và mã lỗi. Log chỉ in metadata phản hồi, không in khóa hoặc toàn bộ nội dung yêu cầu.

## Việc còn cần hoàn tất

- Publish bản sửa trên n8n Cloud để kiểm tra lại nhánh chỉnh tour. Source local không tự thay workflow đã import.
- Hai file `workflows/patches/25-guide-code.js` và `28-guide-code.js` dùng cập nhật riêng nhánh chat; file `AI Tourism v3.json` chứa toàn bộ bản sửa. Xem README.
- `N8N_WEBHOOK_SECRET` hiện để trống. Chưa xác minh webhook có dùng cơ chế xác thực khác. Nếu triển khai cho nhiều người, cấu hình Header Auth và giới hạn số yêu cầu; không tự bật vì cần cấu hình tương ứng trên cloud.
- Builder v3 còn dùng file v2 làm cấu trúc nền. Giữ file v2 cho đến khi tách builder độc lập.
- Chưa kiểm tra trực quan, in PDF hoặc micro trên trình duyệt trong đợt rà soát này. Không có trình duyệt được kết nối qua công cụ browser.
- Email từng được kiểm tra thành công trước đây; đợt này không gửi lại email và không khẳng định email v3 mới đã được thử thực tế.

Chạy `npm.cmd test` cho kiểm thử local; `node scripts/check-live.mjs --ai` để kiểm tra AI và chỉnh tour sau khi publish (không gửi email).
