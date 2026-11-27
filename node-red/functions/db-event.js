// Ghi moi su kien (lenh, ACK, canh bao, phuc hoi, rule...) vao CSDL SQLite (bang event_log).
// Dau vao la dong nhat ky do node history tao: {time, topic, event}.
const store = global.get("dt45db");  /// Đối tượng CSDL.
if (!store || !store.available) return null;  /// CSDL tắt → bỏ qua.
let record = msg.payload;  /// Dòng nhật ký từ history.js (chuỗi JSON).
if (typeof record === "string") {  /// Đổi lại thành đối tượng;
  try { record = JSON.parse(record); } catch { return null; }  /// chuỗi hỏng → bỏ qua.
}
try {
  if (store.saveEvent(record)) node.status({fill:"green",shape:"dot",text:"CSDL: "+store.stats().event_rows+" su kien"});  /// Ghi vào event_log và hiển thị số sự kiện đã lưu.
} catch (e) {
  node.status({fill:"red",shape:"ring",text:"CSDL loi"});  /// Báo đỏ,
  node.warn("Khong ghi duoc su kien vao CSDL: "+e.message);  /// và ghi cảnh báo vào Debug.
}
return null;  /// Không có cổng ra.
/// ▲ db-event.js: mọi dòng nhật ký (cũng là dòng trong events.jsonl) được lưu thêm vào bảng event_log để truy vấn lại.
