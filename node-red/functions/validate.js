const configuredLiveMs = Number(env.get("DT45_LIVE_WINDOW_MS"));  /// Biến môi trường DT45_LIVE_WINDOW_MS (nếu có) để đổi cửa sổ 'dữ liệu trực tiếp'.
// Wokwi thuong chay cham hon thoi gian thuc (15-60%): heartbeat 2s mo phong co the cach nhau 5-13s thuc.
const LIVE_WINDOW_MS = Number.isInteger(configuredLiveMs) && configuredLiveMs >= 3000 ? configuredLiveMs : 15000;  /// Cửa sổ dữ liệu trực tiếp: hợp lệ nếu là số nguyên ≥ 3000 ms, nếu không dùng mặc định 15 000 ms.
const p = msg.payload;  /// Telemetry đã được node JSON chuyển thành đối tượng.
const ids = new Set(Array.isArray(p?.zones) ? p.zones.map(z => z?.id) : []);  /// Tập các id vùng có trong bản tin.
const hasUsage = p && (p.session_ms !== undefined || (Array.isArray(p.zones) && p.zones.some(z => z?.on_ms !== undefined)));  /// Bản tin có số liệu thời gian sáng không (firmware mới).
const usageValid = !hasUsage || (Number.isSafeInteger(p.session_ms) && p.session_ms >= 0 &&  /// Nếu có: session_ms là số nguyên không âm,
  p.session_ms <= Number.MAX_SAFE_INTEGER / 3 && Array.isArray(p.zones) &&  /// không quá lớn, có mảng zones,
  p.zones.every(z => Number.isSafeInteger(z?.on_ms) && z.on_ms >= 0 && z.on_ms <= p.session_ms));  /// và mỗi on_ms là số nguyên trong khoảng 0..session_ms.
if (!p || typeof p.device !== "string" || !Number.isInteger(p.uptime_ms) ||  /// KIỂM TRA CẤU TRÚC: device là chuỗi, uptime_ms là số nguyên
    p.uptime_ms < 0 || p.uptime_ms > 4294967295 || !Number.isInteger(p.timeout_ms) ||  /// trong phạm vi 32 bit, timeout_ms là số nguyên
    p.timeout_ms <= 0 || p.timeout_ms > 4294967295 || !Array.isArray(p.zones) ||  /// dương, zones là mảng
    p.zones.length !== 3 || ids.size !== 3 || ![1,2,3].every(id => ids.has(id)) ||  /// đúng 3 phần tử, id 1, 2, 3 không trùng,
    !p.zones.every(z => z && (z.pir === 0 || z.pir === 1) && typeof z.motion === "boolean" &&  /// pir là 0/1, motion là boolean,
      typeof z.led === "boolean" && ["AUTO","MANUAL"].includes(z.mode)) || !usageValid ||  /// led là boolean, mode là AUTO/MANUAL, số liệu thời gian sáng hợp lệ,
    (p.prelight_enabled !== undefined && typeof p.prelight_enabled !== "boolean")) {  /// prelight_enabled (nếu có) là boolean.
  node.warn("Telemetry sai schema; khong chay rule.");  /// Sai cấu trúc → cảnh báo,
  flow.set("ruleBegin", null);  /// hủy đếm kho vắng,
  flow.set("invalidTelemetry", true);  /// đánh dấu dữ liệu sai → command.js khóa mọi lệnh,
  flow.set("pirHighSince", {});  /// xóa bộ đếm PIR HIGH,
  flow.set("manualIdleSince",null);  /// xóa bộ đếm đèn bật tay khi vắng,
  return [null, {topic:msg.topic,payload:{type:"validation_error"}}];  /// chỉ ghi nhật ký validation_error, không chạy rule.
}
msg.live = msg.retain !== true;  /// Bản tin trực tiếp (không phải retained cũ broker lưu lại).
if (msg.live) {  /// Chỉ dữ liệu trực tiếp mới được cập nhật trạng thái 'online':
  const now = Date.now(), previousAt = flow.get("lastTelemetryAt"), previousUptime = flow.get("sensorUptime");  /// thời điểm hiện tại, lần trước và uptime lần trước,
  const reset = previousAt == null || now-previousAt > LIVE_WINDOW_MS || previousUptime == null || p.uptime_ms < previousUptime ||  /// phát hiện gián đoạn: lần đầu, mất dữ liệu quá 15 s, uptime giảm (ESP32 khởi động lại)
    p.device !== flow.get("sensorDevice");  /// hoặc đổi thiết bị →
  if (reset) {  /// đặt lại mọi bộ đếm của rule và cảnh báo để không tính nhầm thời gian lúc mất kết nối.
    flow.set("ruleBegin",null);
    flow.set("ruleFired",false);
    flow.set("manualIdleSince",null);
    flow.set("manualIdleAlert",false);
    flow.set("afterHoursAlert",false);
    flow.set("sensorAlerts",{});
  }
  const highSince = reset ? {} : (flow.get("pirHighSince") || {});  /// Mốc PIR bắt đầu HIGH của từng vùng.
  for (const z of p.zones) {  /// Từng vùng:
    if (z.pir === 1) { if (highSince[z.id] == null) highSince[z.id] = now; }  /// PIR HIGH → ghi mốc nếu chưa có (monitor.js dùng để cảnh báo PIR HIGH quá 120 s),
    else delete highSince[z.id];  /// PIR LOW → xóa mốc.
  }
  flow.set("pirHighSince",highSince);  /// Lưu mốc,
  flow.set("sensorUptime",p.uptime_ms);  /// uptime,
  flow.set("sensorDevice",p.device);  /// và ID thiết bị.
  const idleManual = p.zones.every(z => z.pir === 0 && !z.motion) && p.zones.some(z => z.mode === "MANUAL" && z.led);  /// Kho vắng (cả 3 PIR = 0, không chuyển động) mà vẫn có đèn bật tay?
  if (!idleManual) flow.set("manualIdleSince",null);  /// Không → xóa mốc.
  else if (flow.get("manualIdleSince") == null) flow.set("manualIdleSince",now);  /// Có → ghi mốc bắt đầu nếu chưa có (cảnh báo MANUAL_LIGHT_IDLE).
  flow.set("lastTelemetryAt", Date.now());  /// Thời điểm nhận telemetry trực tiếp.
  flow.set("lastSeenAt", Date.now());  /// Lần thấy thiết bị.
  flow.set("deviceOnline", true);  /// Thiết bị online.
  flow.set("connectionReason", "live");  /// Lý do: live.
  flow.set("invalidTelemetry", false);  /// Dữ liệu hợp lệ → mở khóa điều khiển.
  const samples = flow.get("samples") || [];  /// Mẫu cho biểu đồ 'Hoạt động gần đây':
  samples.push({at:Date.now(),motion:p.zones.filter(z=>z.motion).length,lights:p.zones.filter(z=>z.led).length});  /// số vùng có chuyển động và số đèn sáng tại thời điểm này,
  flow.set("samples",samples.slice(-60));  /// chỉ giữ 60 mẫu gần nhất.
}
// Khong cho retained den tre ghi de du lieu live dang hien thi.
if (msg.live || !flow.get("telemetry")) {  /// Cập nhật telemetry hiển thị (retained chỉ dùng khi chưa có gì).
  flow.set("telemetry",p);  /// Lưu telemetry,
  flow.set("telemetrySource",msg.live ? "live" : "retained");  /// và nguồn.
}
// Bo dem thoi gian thay doi moi heartbeat, khong ghi event state lien tuc vi bo dem.
const signature = JSON.stringify({device:p.device,timeout_ms:p.timeout_ms,prelight_enabled:p.prelight_enabled,  /// 'Chữ ký' trạng thái: mọi thứ trừ on_ms (on_ms tăng mỗi heartbeat nên không dùng để so sánh).
  zones:p.zones.map(({on_ms,...z}) => z)});  /// Loại on_ms khỏi từng vùng.
let event = null;  /// Sự kiện state chỉ tạo khi trạng thái thực sự đổi.
if (signature !== flow.get("lastState")) {  /// Khác lần trước →
  flow.set("lastState", signature);  /// lưu chữ ký mới,
  event = {topic:msg.topic,payload:{type:"state",source:msg.live ? "live" : "retained",...p}};  /// tạo sự kiện state đầy đủ cho nhật ký.
}
node.status({fill:msg.live ? "green" : "grey",shape:"dot",  /// Trạng thái dưới node trong editor,
  text:p.zones.map(z => `Z${z.id}:${z.led ? "ON" : "OFF"}/${z.mode}`).join(" ")});  /// ví dụ Z1:ON/AUTO Z2:OFF/AUTO Z3:OFF/MANUAL.
return [msg,event];  /// Cổng 1 → debug, rule.js, db-telemetry (CSDL); cổng 2 → history (chỉ khi trạng thái đổi).
/// ▲ validate.js: 'người gác cổng' dữ liệu – chỉ telemetry đúng cấu trúc và trực tiếp mới được tin cậy.
///   Đây cũng là nơi phát hiện ESP32 khởi động lại (uptime giảm) để đặt lại các bộ đếm thời gian.
