// Ghi trang thai 3 vung vao CSDL SQLite (bang telemetry_log).
// Chi ghi telemetry LIVE; ban tin retained cu khong duoc ghi de tranh sai lich su.
if (!msg.live) return null;  /// Bản tin retained cũ → không ghi vào lịch sử.
const store = global.get("dt45db");  /// Lấy đối tượng CSDL tạo trong settings.js.
if (!store || !store.available) {  /// CSDL không dùng được (Node quá cũ, không mở được file) →
  node.status({fill:"grey",shape:"ring",text:"CSDL tat"});  /// chỉ báo xám dưới node, hệ thống vẫn chạy bình thường.
  return null;
}
try {  /// Lỗi ghi CSDL không được làm hỏng luồng chính:
  if (store.saveTelemetry(msg.payload)) {  /// ghi khi trạng thái đổi hoặc mỗi 10 s (store tự quyết định),
    node.status({fill:"green",shape:"dot",text:"CSDL: "+store.stats().telemetry_rows+" dong trang thai"});  /// hiển thị số dòng đã lưu.
  }
} catch (e) {
  node.status({fill:"red",shape:"ring",text:"CSDL loi"});  /// Báo đỏ,
  node.warn("Khong ghi duoc telemetry vao CSDL: "+e.message);  /// và ghi cảnh báo vào Debug.
}
return null;  /// Không có cổng ra.
/// ▲ db-telemetry.js: nối nhánh telemetry hợp lệ (validate.js) vào bảng telemetry_log của SQLite.
