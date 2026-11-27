// Gui canh bao / phuc hoi / rule tu dong va ket qua lenh Telegram toi cac chat duoc phep.
// Dau vao la dong nhat ky do node history tao: {time, topic, event}.
const tg = global.get("dt45tg");  /// Đối tượng Telegram.
if (!tg || !tg.enabled) return null;  /// Chưa có token → không gửi.
let record = msg.payload;  /// Dòng nhật ký từ history.js.
if (typeof record === "string") {  /// Đổi chuỗi JSON thành đối tượng;
  try { record = JSON.parse(record); } catch { return null; }  /// hỏng → bỏ qua.
}
const e = record && record.event;  /// Nội dung sự kiện.
if (!e || typeof e !== "object") return null;  /// Không có → bỏ qua.
const reasons = {no_live_telemetry:"ESP32 đang offline hoặc chưa có dữ liệu trực tiếp",  /// Diễn giải lý do từ chối lệnh sang tiếng Việt:
  invalid_telemetry:"dữ liệu ESP32 sai định dạng",invalid_command:"lệnh không hợp lệ"};
let text = null;  /// Tin nhắn sẽ gửi (null = sự kiện này không cần báo).
if (e.type === "alert") {  /// Cảnh báo:
  text = e.code === "DEVICE_OFFLINE" ? "[CẢNH BÁO] Mất dữ liệu từ ESP32. Dashboard đã khóa nút điều khiển." :  /// mất dữ liệu ESP32,
    e.code === "PIR_HIGH_LONG" ? "[CẢNH BÁO] PIR vùng "+e.zone+" giữ HIGH quá "+e.high_seconds+" giây – kiểm tra cảm biến." :  /// PIR giữ HIGH quá lâu,
    e.code === "MANUAL_LIGHT_IDLE" ? "[CẢNH BÁO] Có đèn bật thủ công khi kho vắng quá "+e.idle_seconds+" giây." :  /// đèn bật tay khi kho vắng,
    e.code === "AFTER_HOURS_MOTION" ? "[CẢNH BÁO] Có chuyển động ngoài ca làm việc." :  /// chuyển động ngoài ca,
    e.code === "COMMAND_TIMEOUT" ? "[CẢNH BÁO] Lệnh "+e.command+" chưa được ESP32 xác nhận sau 12 giây." :  /// lệnh thiếu ACK,
    "[CẢNH BÁO] "+(e.code || "Sự kiện bất thường");  /// loại khác.
} else if (e.type === "recovery") {  /// Phục hồi:
  text = e.code === "DEVICE_ONLINE" ? "[PHỤC HỒI] ESP32 đã gửi dữ liệu trở lại." :  /// ESP32 online trở lại,
    e.code === "PIR_HIGH_CLEARED" ? "[PHỤC HỒI] PIR vùng "+e.zone+" đã trở về LOW." :  /// PIR về LOW,
    e.code === "MANUAL_IDLE_CLEARED" ? "[PHỤC HỒI] Hết tình trạng đèn thủ công sáng khi kho vắng." :  /// hết đèn bật tay khi vắng,
    e.code === "AFTER_HOURS_CLEARED" ? "[PHỤC HỒI] Hết chuyển động ngoài ca." : "[PHỤC HỒI] "+(e.code || "");  /// hết chuyển động ngoài ca.
} else if (e.type === "automation") {  /// Rule tự động gửi AUTO:
  text = "[TỰ ĐỘNG] Kho vắng "+e.idle_seconds+" giây → Node-RED gửi "+e.command+".";  /// báo cho người quản lý biết hệ thống đã tự trả về tự động.
} else if (e.type === "command_sent" && e.source === "telegram") {  /// Lệnh gửi từ Telegram →
  text = "Đã gửi lệnh "+e.command+" ("+e.id+"). Đang chờ ESP32 xác nhận.";  /// xác nhận đã gửi kèm ID.
} else if (e.type === "command_rejected" && e.source === "telegram") {  /// Lệnh Telegram bị từ chối →
  text = "Không gửi được "+e.command+": "+(reasons[e.reason] || e.reason)+".";  /// báo lý do.
} else if (e.type === "command" && e.id) {  /// ACK từ ESP32:
  const entry = (flow.get("commands") || []).find(c => c.id === e.id);  /// tìm lệnh tương ứng,
  if (entry && entry.source === "telegram") {  /// chỉ báo cho lệnh có nguồn Telegram (lệnh dashboard không làm phiền điện thoại):
    text = e.result === "OK" ? "ESP32 đã xác nhận "+e.command+(entry.rtt_ms != null ? " · ACK "+entry.rtt_ms+" ms" : "")+"." :  /// OK kèm thời gian phản hồi ACK,
      "ESP32 từ chối "+(e.command || "lệnh")+": "+(e.reason || "không rõ lý do")+".";  /// hoặc lý do ESP32 từ chối.
  }
}
if (!text) return null;  /// Không có gì cần báo.
// Chong gui lap: cung noi dung trong 5 giay chi gui 1 lan.
const now = Date.now();  /// Thời điểm hiện tại.
if (text === flow.get("tgLastText") && now-(flow.get("tgLastAt") || 0) < 5000) return null;  /// Cùng nội dung trong vòng 5 s → không gửi lại (chống spam khi mạng chập chờn).
flow.set("tgLastText",text);  /// Nhớ nội dung,
flow.set("tgLastAt",now);  /// và thời điểm.
tg.send(text).then(ok => {  /// Gửi tới tất cả chat được phép (bất đồng bộ),
  node.status(ok ? {fill:"green",shape:"dot",text:"Da gui Telegram"} : {fill:"red",shape:"ring",text:"Gui Telegram loi"});  /// báo kết quả dưới node,
  node.done();  /// kết thúc lần chạy.
});
return null;  /// Không có cổng ra.
/// ▲ telegram-notify.js: nối nhánh nhật ký (history.js) sang Telegram – cảnh báo, phục hồi, rule tự động và kết quả lệnh Telegram.
