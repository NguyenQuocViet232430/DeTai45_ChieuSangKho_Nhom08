# Chạy kiểm thử

Tại thư mục project:

```powershell
powershell -ExecutionPolicy Bypass -File .\test\run_host_tests.ps1
node .\test\node_red_test.cjs
node .\test\dashboard_test.cjs
node .\test\log_summary_test.cjs
node .\test\storage_telegram_test.cjs
node .\test\e2e_week68_test.cjs
```

- **Host C++:** cần MSVC Build Tools; 51 ca chạy source firmware với phần cứng/network giả, gồm timeout từ xa, pre-light, thời gian sáng, quay vòng millis và cache ID lệnh.
- **Node-RED Function:** 33 ca, không cần Internet; đọc `node-red/flows.json`. Khi sửa source Function/HTML phải chạy `node .\node-red\build-flow.cjs` trước.
- **Script dashboard:** 6 nhóm kiểm tra chạy script thật trong DOM giả lập: phân quyền, nhập liệu qua các lần cập nhật, request cấu hình, pre-light, ca qua đêm và nhãn thống kê. Không thay thế kiểm tra bố cục trong trình duyệt.
- **Thống kê log:** 5 ca kiểm tra ACK đầu tiên, command khớp, timestamp lỗi và quantile.
- **CSDL + Telegram:** 12 ca, không cần Internet: SQLite (ghi khi đổi/10 giây, mở lại còn dữ liệu, lọc, thời gian sáng theo ngày, CSV), API `/dt45/api/history`, Telegram với API giả lập (phân quyền chat, không lộ token, chống gửi lặp).
- **E2E MQTT/API:** cần Node.js, runtime Node-RED cài bởi `node-red/start.ps1`, Internet và cổng 1881 trống. Có 17 kiểm tra dùng Node-RED/EMQX thật (gồm lệnh Telegram, cảnh báo Telegram qua API Telegram giả lập và đọc lịch sử từ SQLite) và thiết bị giả, prefix riêng để không tác động ESP32 demo. Kết quả ở `.pio/week68-<timestamp>/`. Ngưỡng PIR HIGH lúc đầu bài test là 2 giây; mặc định vận hành là 120 giây. Bài này kiểm tra đường truyền cấu hình pre-light; logic bật vùng liền kề được kiểm tra trực tiếp trong source C++ bằng bài host.

`mqtt_integration_test.cjs` giữ bài kiểm tra MQTT tuần 4–5. Bài E2E tuần 6–8 đã kiểm tra thêm dashboard/API, phân quyền và ACK có ID.

Chạy tất cả qua `powershell -ExecutionPolicy Bypass -File .\tools\verify.ps1`; `-SkipNetwork` hoặc `-SkipBuild` chỉ bỏ các bước đó, không ghi PASS mới cho bước bỏ qua. Minh chứng PIR/relay/LED Wokwi cần nhóm chạy và ghi riêng theo [hướng dẫn](../HUONG_DAN_CHAY_NHOM08.md).
