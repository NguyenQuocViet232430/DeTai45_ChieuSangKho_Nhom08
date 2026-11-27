let event = msg.payload;  /// Sự kiện đầu vào (từ validate, status, ESP32 event, command, rule, monitor, telegram...).
if (typeof event === "string") {  /// Bản tin MQTT dạng chuỗi (ví dụ ACK từ topic event) →
  try { event = JSON.parse(event); }  /// thử đọc JSON,
  catch { event = {type:"message",value:event}; }  /// không phải JSON thì bọc lại thành {type:'message'}.
}
if (!event || typeof event !== "object" || Array.isArray(event)) {  /// Không phải đối tượng hợp lệ →
  event = {type:"message",value:event};  /// cũng bọc lại để luôn ghi được.
}
const record = {time:new Date().toISOString(),topic:msg.topic || "",event};  /// Dòng nhật ký: thời gian ISO (UTC), topic nguồn và nội dung sự kiện.
const journal = flow.get("journal") || [];  /// Nhật ký trong bộ nhớ cho dashboard.
journal.push(record);  /// Thêm dòng mới.
flow.set("journal",journal.slice(-100));  /// Chỉ giữ 100 dòng gần nhất (bản đầy đủ nằm trong file JSONL và CSDL).
if (event && event.type === "command" && typeof event.id === "string" && event.id) {  /// Sự kiện là ACK của ESP32 có ID →
  const commands = flow.get("commands") || [];  /// lấy danh sách lệnh đang chờ,
  const entry = commands.find(c=>c.id===event.id);  /// tìm lệnh cùng ID,
  if (entry && (event.command === entry.command || (event.result === "ERROR" && event.command === "")) && ["OK","ERROR"].includes(event.result)) {  /// ACK khớp lệnh (hoặc lỗi không kèm lệnh) và kết quả là OK/ERROR →
    if (entry.ack_at == null) {  /// chỉ ghi nhận ACK đầu tiên (ACK lặp lại do duplicate không làm sai số liệu),
      entry.status = event.result === "OK" ? "acknowledged" : "rejected";  /// acknowledged hoặc rejected,
      entry.ack_at = Date.now();  /// thời điểm nhận ACK,
      entry.rtt_ms = Math.max(0,entry.ack_at-entry.sent_at);  /// RTT = thời gian từ lúc gửi tới lúc nhận ACK (số liệu 1,3 s trong báo cáo lấy từ đây),
      entry.reason = event.reason || "";  /// lý do nếu ESP32 từ chối.
    }
    flow.set("commands",commands);  /// Lưu lại.
  }
}
msg.payload = JSON.stringify(record);  /// Đổi thành một dòng JSON để ghi file.
msg.filename = env.get("DT45_LOG_FILE") || "node-red/logs/events.jsonl";  /// File nhật ký node-red/logs/events.jsonl (đổi bằng DT45_LOG_FILE).
return msg;  /// → file-log, debug, db-event (CSDL) và telegram-notify.
/// ▲ history.js: điểm gom MỌI sự kiện của hệ thống → 1 dòng {time, topic, event}; đồng thời ghép ACK với lệnh để tính RTT.
///   Dòng mẫu: {"time":"2026-11-16T15:54:51.783Z","topic":"…/event","event":{"type":"command","result":"OK","id":"c-…","command":"ON1"}}
