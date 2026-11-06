# Vietjourney v3 — backend Firebase Spark

Đã bổ sung backend Node.js/Firebase Authentication/Cloud Firestore và nối frontend. Workflow v3 30 node được giữ nguyên. Không dùng Cloud Functions, không yêu cầu Blaze cho phần backend này. Node.js chạy trên máy của bạn hoặc máy chủ riêng; chi phí n8n/AI/hosting tính riêng.

## Đã thực hiện

- Xác minh Firebase ID token ở server, ownerId lấy từ token, kiểm tra quyền trên tour/job/proposal/email.
- CRUD tour, metadata tách state, danh sách phân trang, import tour local có validate và đánh dấu chưa xác minh; tour import không gửi email.
- Job AI chạy nền, concurrency 2, trạng thái và khóa chống trùng lưu Firestore. Frontend giữ khóa công việc theo tài khoản để không tạo lại cùng nội dung khi mất kết nối.
- Đề xuất 30 phút; duyệt transaction có revision, duyệt lặp trả biên nhận; hoàn tác một bước tăng revision mới.
- Hỏi đáp lấy tour/lịch sử từ server. Chặn AI đổi thông tin request không được cho phép; phần chat có ô số ngày/người/ngân sách mới. Câu “Giảm ngân sách 1 triệu” cũng được nhận diện chính xác; yêu cầu cấu trúc khác chưa nhận diện cần dùng ô chỉnh hoặc tạo tour mới.
- MailJob chống gửi trùng bền vững. Timeout không rõ kết quả thành unknown, không gửi lại tự động. Tạo tour luôn lưu trước rồi mới gửi email nếu đã yêu cầu.
- Hạn mức tài khoản/ngày: mặc định 3 yêu cầu tạo tour AI (điều chỉnh bằng `DAILY_GENERATE_LIMIT` trong `.env`), 20 lượt hỏi/chỉnh, 3 email, 5 tour import; IP giới hạn 120 API request/phút trong một tiến trình. Cấu hình thử nghiệm local từ 24/10/2026 dùng `DAILY_GENERATE_LIMIT=30`. Lượt tạo tour được tính khi nhận job, kể cả job sau đó lỗi; ngày tính theo UTC, đặt lại lúc 07:00 giờ Việt Nam. Khởi động lại server sau khi đổi cấu hình; bộ đếm đã dùng không bị xóa.
- Phục hồi jobs sau restart; lease hết hạn chuyển unknown. Không tuyên bố exactly-once với n8n/Gmail khi hệ thống ngoài không trả biên nhận.
- Script cleanup chạy có giới hạn, dry-run mặc định. Xóa tour qua API dọn subcollections, bỏ payload job và địa chỉ email liên quan nhưng giữ biên nhận chống trùng.
- Frontend có đăng nhập Google/email-password, tour trên Firebase, duyệt/hoàn tác qua server. Demo/voice trình duyệt vẫn hoạt động khi chưa cấu hình Firebase.

## Thiết lập Firebase thật

1. Tạo/chọn project Spark. Tạo Cloud Firestore Standard/Native, database `(default)`, Production mode; chọn vùng phù hợp, ví dụ Singapore.
2. Firebase Authentication → Sign-in method: bật Google và/hoặc Email/Password. Thêm `localhost` vào Authorized domains nếu chưa có; production thêm tên miền thật.
3. Project Settings → Your apps → tạo Web app; lấy projectId, apiKey, authDomain, appId. Đây là cấu hình web công khai; không phải private key.
4. Cấu hình Admin SDK trên máy chủ: dùng Application Default Credentials, hoặc tạo service-account key trong Console và lưu **ngoài frontend/repository**, ví dụ `D:/N8N-private/firebase-admin.json`. Không gửi nội dung key vào chat hoặc commit Git. Tài khoản máy chủ cần quyền Firestore và Firebase Auth phù hợp; không cần quyền quản trị billing.
5. Điền `.env` (giữ các URL n8n hiện tại):

```dotenv
FIREBASE_PROJECT_ID=tourismai-49e52
FIREBASE_WEB_API_KEY=your-web-api-key
FIREBASE_AUTH_DOMAIN=tourismai-49e52.firebaseapp.com
FIREBASE_WEB_APP_ID=your-web-app-id
GOOGLE_APPLICATION_CREDENTIALS=D:/N8N-private/firebase-admin.json
```

Nếu đã có ADC, để trống GOOGLE_APPLICATION_CREDENTIALS và đặt FIREBASE_USE_ADC=true. Không cần Firebase Storage cho voice v3.

6. Cài Firebase CLI nếu chưa có; chạy PowerShell trong thư mục `firebase`:

```powershell
npm install -g firebase-tools
firebase login
firebase deploy --only firestore --project tourismai-49e52
```

Rules chặn toàn bộ client Firestore; mọi truy cập qua backend. Dùng project riêng; nếu project đã có app khác, **ghép rules/indexes trước khi deploy**, tránh thay quyền collection của app đó. Admin SDK không bị rules chặn; backend tự kiểm tra quyền.

7. Từ thư mục gốc dự án:

```powershell
npm.cmd install
npm.cmd run firebase:check
npm.cmd test
npm.cmd start
```

Mở http://localhost:3000, Ctrl+F5. Đăng nhập, bỏ demo rồi tạo tour. Trước khi publish công khai, bật Header Auth `X-Tourism-Key` trên **cả hai** webhook v3 và điền N8N_WEBHOOK_SECRET. Browser không nhận secret này.

## API và chạy local

`GET /api/config` chỉ trả cấu hình web/trạng thái đã cấu hình, không chứng minh credential hoạt động. `GET /api/health` trả kiểu storage. Khi thiếu cấu hình, API dữ liệu trả 503 FIREBASE_SETUP_REQUIRED; không âm thầm dùng RAM làm database thay Firebase. Adapter RAM chỉ phục vụ kiểm thử, không có chế độ token giả trong server production.

API cần Authorization Bearer Firebase ID token. POST tạo/guide cần Idempotency-Key; trả 202/jobId; GET /api/jobs/:id chờ kết quả. Job giữ biên nhận 30 ngày khi chạy cleanup; dùng lại khóa sau khi biên nhận đã xóa có thể tạo thao tác mới.

API cũ `/api/trip`, `/api/guide`, `/api/email` đã được frontend cập nhật. Guide/email gửi tripId, không gửi lại toàn bộ tour. API mới: `/api/me`, `/api/trips`, `/api/trips/import`, `/api/trips/:id`, `/api/trips/:id/proposals/:id/approve`, `/undo`, `/balance`, `/email`.

Backend vẫn bind 127.0.0.1. Production đặt sau reverse proxy HTTPS trên máy luôn chạy. Khi chạy nhiều instance, IP rate-limit cần kho chung; job lease và daily quota đã dùng Firestore.

## Dọn dữ liệu và quota

```powershell
npm.cmd run cleanup
npm.cmd run cleanup:apply
```

Lệnh đầu chỉ báo cáo; lệnh thứ hai bỏ snapshot proposal cũ hơn 1 ngày (giữ biên nhận), xóa chat hơn 7 ngày, bỏ payload job hơn 7 ngày, xóa job/mail receipts hơn 30 ngày. Mỗi nhóm tối đa CLEANUP_BATCH_LIMIT (mặc định 100, tối đa 500) mỗi lượt. Có backlog thì chạy thêm lượt có kiểm soát. Lịch dọn chưa tự đăng ký vào Windows; có thể đặt Task Scheduler hằng ngày sau khi xem dry-run.

**Tour không tự xóa sau 30 ngày**: script báo số tour cũ, người dùng xóa qua giao diện. Chính sách này tránh mất tour bất ngờ, nhưng storage vẫn tăng nếu giữ mọi tour. Muốn áp dụng retention tự động cần chốt chính sách trước. Đăng nhập Firebase xóa tài khoản chưa có UI/API tự động; việc xóa tài khoản/dữ liệu toàn bộ cần bổ sung hoặc thực hiện qua công cụ quản trị.

Mô hình tính toán trước là thiết kế sơ bộ. Bản thực thi có thêm quota ledger và các trạng thái job: mẫu 1 tour + 5 hỏi + 2 chỉnh + 1 duyệt ≈ **54 writes/người/ngày**, chưa email/import/cleanup. Ước lượng reads tối thiểu khoảng **136/người/ngày** khi mỗi lần có 6 tin lịch sử và một lượt lấy kết quả; polling/retry làm tăng. Worker kiểm tra phục hồi mỗi 5 phút, có thể tạo tối thiểu khoảng 864 reads/ngày khi ba query trống được tính lượt tối thiểu. Đây là mô hình, chưa đo billing thật.

100 người/ngày theo mẫu: ≈14.464 reads và 5.400 writes, chưa overhead khác. 500 người/ngày: ≈68.864 reads và 27.000 writes, **vượt quota miễn phí**. Nên bắt đầu 20–100 người/ngày, phân trang, dọn dữ liệu và xem Usage; không coi Spark là không giới hạn.

## Kiểm thử và giới hạn

- 42 kiểm thử Node đã qua, gồm nghiệp vụ v3, auth HTTP mô phỏng, quyền sở hữu, quota, proposal, concurrent approval, undo, email unknown, restart, payload lớn và webhook secret.
- Kiểm thử DOM + HTTP local đã qua: trạng thái đăng nhập, tạo tour, proposal, duyệt, hoàn tác, danh sách Firebase và logout. Firebase Auth/n8n dùng stub; database dùng adapter transaction trong bộ nhớ.
- Chưa chạy Firestore Emulator/Firestore thật, Google popup thật, Gmail thật hoặc AI thật trong đợt kiểm thử này. Cần Project ID/config/credential và các indexes sau deploy để xác minh tích hợp thật.
- n8n v3 không có biên nhận callback bền vững theo requestId: khi lỗi mạng/restart làm kết quả chưa rõ, hệ thống giữ unknown để đối soát, không tự retry vô hạn. Nếu write DB cuối cùng lỗi, có thể phải kiểm tra execution và nhập lại kết quả.
- Lựa chọn số ngày/người/ngân sách cấu trúc được kiểm tra. Ý nghĩa hoạt động và mức độ phù hợp vẫn cần người dùng duyệt; không thể xác minh toàn bộ tính đúng của nội dung AI bằng schema.

Mã nguồn trước sửa nằm trong outputs/backend-v3-backup của phiên làm việc. Gói bàn giao không chứa `.env`, service-account key hay node_modules.

Tài liệu chính: [Auth token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [Firestore transactions](https://firebase.google.com/docs/firestore/manage-data/transactions), [Firestore pricing/quotas](https://firebase.google.com/docs/firestore/pricing).

## Lỗi khi mở Tour trên Firebase

Nếu API trả FIRESTORE_INDEX_REQUIRED, danh sách cần composite index collection `trips`, query scope Collection, `ownerId` Ascending và `updatedAt` Descending (`__name__` Descending tự động). Tạo trong Firebase Console → Firestore Database → Indexes; đợi Enabled rồi tải lại danh sách. Các index cho job/cleanup đã có trong `firebase/firestore.indexes.json`; deploy bằng tài khoản có quyền quản lý index. Admin SDK có quyền dữ liệu không đồng nghĩa có quyền tạo index. Không cần mở quyền client trong firestore.rules.

## Nâng cấp hướng dẫn viên An

- Chọn ngày để gợi ý hỏi đáp theo điểm đến, số người, phương tiện và sở thích; hỏi ăn uống, di chuyển, văn hóa hoặc phương án khi trời mưa. Không có dữ liệu thời tiết trực tiếp.
- Xem nhanh lịch ngày, hành lý và ngân sách từ tour hiện tại, không gọi AI. Những lượt hỏi AI vẫn tính vào giới hạn 20 lượt/tài khoản/ngày.
- Khôi phục tối đa 40 tin nhắn AI gần nhất khi mở An trên tour Firebase. API GET /api/trips/:id/messages xác minh chủ sở hữu, trả nội dung giới hạn và theo thời gian. Model vẫn nhận 6 tin nhắn gần nhất. Các nút xem nhanh/demo giữ trong phiên; không ghi vào Firestore. Cleanup có thể xóa tin nhắn quá 7 ngày theo thiết kế hiện có.
- Tải hội thoại TXT; sao chép hoặc nghe từng câu trả lời. Tốc độ đọc chậm/tự nhiên/nhanh, tạm dừng/tiếp tục, nghe lại. Cài đặt giọng đọc lưu local; nội dung hội thoại không lưu local.
- Micro tiếng Việt điền câu hỏi để người dùng kiểm tra trước khi gửi. Chất lượng nhận dạng và giọng đọc phụ thuộc trình duyệt/thiết bị; audio không được lưu vào Firebase.
- Chỉnh số ngày/người/ngân sách, nhịp độ/phương tiện/sở thích; xem danh sách khác biệt và lịch trình đề xuất trước khi duyệt. Backend đối chiếu chính xác các giá trị được phép đổi; giữ cơ chế revision, duyệt, hoàn tác. Demo tạo lại mẫu theo giá trị đã chọn và có nhãn minh họa.
- Kiểm thử: 46 test tự động đạt; kiểm tra DOM + HTTP local với Firebase Auth/n8n mô phỏng bao gồm các nút theo ngày, voice/micro, export, proposal, history và cách ly dữ liệu khi đăng xuất. Chưa kiểm thử thiết bị micro/loa hoặc câu trả lời AI thực tế của bản nâng cấp này.

## Khung chat tối giản

Các điều khiển giọng nói và tải hội thoại nằm trong Tùy chọn, đóng mặc định. Lời chào và thông tin tour được rút gọn. Câu trả lời dài hiển thị bản xem nhanh khoảng 360 ký tự với Xem thêm/Thu gọn; sao chép và tải hội thoại giữ nội dung đầy đủ. Giọng đọc mặc định đọc bản xem nhanh. Backend yêu cầu answer tối đa 80 từ, 2–3 ý; giữ proposal đầy đủ. Yêu cầu chi tiết/đầy đủ/phân tích kỹ bỏ giới hạn này. Đây là hướng dẫn cho model, không cắt nội dung gốc khi lưu. 13 kiểm thử liên quan và kiểm tra DOM xem thêm/thu gọn, voice, khôi phục hội thoại, chỉnh tour đã đạt.


## Vé và chuyến đi đã lưu

Form mới dự trù khứ hồi 1.500.000 đ/người và trải nghiệm 150.000 đ/người/ngày, là giả định người dùng có thể chỉnh, không phải giá thị trường. Tổng vé trải nghiệm = max(tổng vé trong lịch trình, dự trù/người/ngày × người × ngày), không cộng trùng; phần dư ghi rõ chưa phân bổ. Tour cũ không tự thay giá; nút Chỉnh dự toán vé tạo đề xuất qua POST /api/trips/:id/budget, duyệt/hoàn tác theo revision. Có thể chọn 0 cho khoản không cần mua/dự trù; vé khứ hồi 0 chưa xác nhận hiển thị Chưa nhập.

Chuyến đi đã lưu dùng một cửa sổ cho dữ liệu tài khoản và thiết bị. Đồng bộ dùng khóa idempotency theo nội dung, chỉ chuyển bản local sau khi backend xác nhận lưu; dữ liệu local vẫn mở được khi chưa đăng nhập hoặc Firebase lỗi. Tour nhập có nhãn riêng và không gửi email.

Workflow v3 đang triển khai không biết khoản dự trù vé chưa phân bổ mới. Khi phần này lớn hơn 0, backend chặn gửi email để tránh email tính tổng khác; tải lịch trình/In PDF giữ đúng dự toán. Email các tour không có khoản dư vẫn dùng workflow hiện tại.

## Thêm 15 tỉnh/thành (21 điểm đến)

- Hà Nội — Phố cổ & di sản
- TP. Hồ Chí Minh — Nhịp sống Sài Gòn
- Huế — Cố đô & sông Hương
- Hải Phòng — Cát Bà & Lan Hạ
- Lào Cai — Sa Pa & bản làng
- Tuyên Quang — Hà Giang & cao nguyên đá
- Cao Bằng — Thác nước & non xanh
- Thanh Hóa — Pù Luông xanh
- Khánh Hòa — Nha Trang & biển xanh
- Gia Lai — Quy Nhơn & duyên hải
- Quảng Trị — Phong Nha & hang động
- Phú Thọ — Mai Châu & nhà sàn
- Đắk Lắk — Cà phê & đại ngàn
- Tây Ninh — Núi Bà Đen & văn hóa
- Cần Thơ — Chợ nổi & miệt vườn

Frontend có 15 thẻ chọn nhanh, lựa chọn điểm đến, tên thay thế qua voice và dữ liệu địa danh cho An. Tour mẫu 3 ngày/2 người sử dụng ngân sách giả định 10 triệu đồng; cần chỉnh theo ngày đi và giá thực tế. Không tự tạo tour vào tài khoản Firebase. Danh mục và nguồn tham khảo nằm trong frontend/catalog.js; cấu hình mẫu nằm trong frontend/tour-presets-15.json.

Demo/backend nhận 21 điểm đến sau khi khởi động lại server. Để AI nhận các điểm mới, import workflows/AI Tourism v3 - 21 destinations.json vào n8n, thay thế workflow v3 đang dùng rồi Publish. Bản này giữ số node, kết nối, đường dẫn webhook và cấu hình node của bản v3 gốc; chỉ mở rộng dữ liệu danh mục trong Code nodes. Không chạy đồng thời hai workflow cùng webhook. Chưa tự import/publish n8n từ thao tác này.

## Lỗi n8n gateway khi tạo lịch trình

HTTP 502/503/504 trả HTML được báo riêng là N8N_GATEWAY_ERROR; backend giữ trạng thái unknown vì chưa biết workflow có hoàn tất hay không. Không tự retry hoặc xóa khóa chống trùng. Kiểm tra Executions trong n8n đúng thời điểm lỗi, node đỏ và credential AI; nếu không có execution hoặc toàn bộ n8n trả 502, kiểm tra trạng thái instance trong n8n Cloud. Phản hồi JSON hợp lệ vẫn giữ nguyên lỗi nghiệp vụ.

## Frontend: Failed to fetch

Truy cập http://localhost:3000 (không dùng Live Server hoặc mở file HTML trực tiếp). Frontend phân biệt mất kết nối API localhost, thư viện Firebase CDN và xác nhận đăng nhập Firebase. Request GET trạng thái thử lại tối đa 2 lần khi mất mạng ngắn; POST tạo tour không tự gửi lại. Nếu đã lưu jobId và gửi lại cùng nội dung, frontend đọc trạng thái job đó thay vì tạo yêu cầu POST mới. Không xóa khóa chống trùng khi kết quả còn chưa xác định.
