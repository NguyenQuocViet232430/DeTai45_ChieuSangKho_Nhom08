const value = String(msg.payload).trim();  /// Bản tin topic status: online (ESP32 gửi khi kết nối) hoặc offline (LWT do broker gửi).
if (!["online","offline"].includes(value)) return null;  /// Giá trị khác → bỏ qua.
const previous = flow.get("brokerDeviceStatus");  /// Trạng thái trước đó.
flow.set("brokerDeviceStatus",value);  /// Lưu trạng thái mới.
// 'online' retained chua du: can telemetry live truoc khi gui lenh.
if (value === "offline") {  /// offline (LWT) → coi thiết bị mất kết nối ngay, không chờ hết 15 s:
  flow.set("deviceOnline", false);  /// đánh dấu offline,
  flow.set("connectionReason", "last_will");  /// lý do: last_will,
  flow.set("lastTelemetryAt", null);  /// xóa mốc telemetry → khóa điều khiển,
  flow.set("ruleBegin", null);  /// hủy đếm kho vắng,
  flow.set("ruleFired", false);  /// cho phép rule chạy lại,
  flow.set("ruleLastAt", null);  /// xóa mốc lần chạy rule.
}
node.status({fill:value === "online" ? "green" : "red",shape:"dot",text:value});  /// Chấm xanh/đỏ dưới node trong editor Node-RED.
if (previous === value) return null;  /// Không đổi → không ghi nhật ký lặp.
return {topic:msg.topic,payload:{type:"connection",status:value,retained:msg.retain === true}};  /// Ghi sự kiện connection (retained=true nghĩa là bản tin cũ broker lưu lại).
/// ▲ status.js: xử lý online/offline; LWT 'offline' giúp phát hiện ESP32 rớt mạng mà không cần đợi hết 15 s.
