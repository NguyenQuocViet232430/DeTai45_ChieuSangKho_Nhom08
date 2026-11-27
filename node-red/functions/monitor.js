const configuredLiveMs = Number(env.get("DT45_LIVE_WINDOW_MS"));  /// Biến môi trường DT45_LIVE_WINDOW_MS (nếu có) để đổi cửa sổ 'dữ liệu trực tiếp'.
// Wokwi thuong chay cham hon thoi gian thuc (15-60%): heartbeat 2s mo phong co the cach nhau 5-13s thuc.
const LIVE_WINDOW_MS = Number.isInteger(configuredLiveMs) && configuredLiveMs >= 3000 ? configuredLiveMs : 15000;  /// Cửa sổ dữ liệu trực tiếp: hợp lệ nếu là số nguyên ≥ 3000 ms, nếu không dùng mặc định 15 000 ms.
const now = Date.now(), lastAt = flow.get("lastTelemetryAt");  /// Thời điểm hiện tại và lần nhận telemetry trực tiếp gần nhất.
const online = flow.get("deviceOnline") === true && lastAt != null && now-lastAt <= LIVE_WINDOW_MS;  /// Online khi có telemetry trực tiếp trong 15 s.
const previous = flow.get("monitorOnline");  /// Trạng thái online ở lần chạy trước (để phát hiện thời điểm đổi).
const events = [];  /// Danh sách sự kiện sẽ gửi ra nhật ký.
if (!online && flow.get("deviceOnline") === true) {  /// Vừa quá 15 s không có dữ liệu mà vẫn đang ghi online →
  flow.set("deviceOnline",false);  /// chuyển sang offline (dashboard khóa nút),
  flow.set("connectionReason","heartbeat_timeout");  /// lý do: heartbeat_timeout,
  flow.set("ruleBegin",null);  /// hủy đếm kho vắng,
  flow.set("ruleLastAt",null);  /// xóa mốc rule,
  flow.set("ruleFired",false);  /// cho phép rule chạy lại.
}
if (previous === true && !online) events.push({payload:{type:"alert",code:"DEVICE_OFFLINE",severity:"warning",reason:flow.get("connectionReason") || "heartbeat_timeout"}});  /// online → offline: cảnh báo DEVICE_OFFLINE (một lần cho mỗi lần mất).
if (previous === false && online) events.push({payload:{type:"recovery",code:"DEVICE_ONLINE"}});  /// offline → online: sự kiện phục hồi DEVICE_ONLINE.
flow.set("monitorOnline",online);  /// Nhớ trạng thái cho lần chạy sau.
const commands = flow.get("commands") || [];  /// Lệnh đang theo dõi ACK.
const configuredHighMs = Number(env.get("DT45_PIR_HIGH_MS"));  /// Ngưỡng PIR HIGH lâu có thể đặt bằng DT45_PIR_HIGH_MS (dùng trong test E2E: 2 s).
const config = flow.get("alertConfig") || {pir_high_seconds:  /// Cấu hình cảnh báo hiện tại hoặc mặc định:
  Number.isInteger(configuredHighMs) && configuredHighMs >= 1000 ? configuredHighMs/1000 : 120,  /// PIR HIGH 120 s,
  manual_idle_seconds:60,shift_enabled:false,shift_start:"08:00",shift_end:"17:00"};  /// đèn bật tay khi kho vắng 60 s, ngoài ca tắt, ca 08:00–17:00.
const highMs = config.pir_high_seconds * 1000;  /// Ngưỡng PIR HIGH tính bằng ms.
const highSince = flow.get("pirHighSince") || {};  /// Mốc PIR bắt đầu HIGH của từng vùng (validate.js ghi).
const sensorAlerts = flow.get("sensorAlerts") || {};  /// Các vùng đang cảnh báo PIR.
if (!online) {  /// Offline → xóa mọi bộ đếm để không tính nhầm thời gian mất kết nối:
  flow.set("pirHighSince",{});
  flow.set("sensorAlerts",{});
  flow.set("manualIdleSince",null);
  flow.set("manualIdleAlert",false);
  flow.set("afterHoursAlert",false);
} else if (flow.get("invalidTelemetry") !== true) {  /// Online và dữ liệu hợp lệ → kiểm tra PIR từng vùng:
  for (const id of [1,2,3]) {  /// vùng 1, 2, 3:
    if (highSince[id] != null && now-highSince[id] >= highMs) {  /// PIR HIGH liên tục quá ngưỡng (có thể bị che/bụi hoặc có người làm việc liên tục) →
      if (!sensorAlerts[id]) events.push({payload:{type:"alert",code:"PIR_HIGH_LONG",zone:id,high_seconds:Math.floor(highMs/1000),severity:"warning"}});  /// cảnh báo PIR_HIGH_LONG một lần (không tự tắt đèn),
      sensorAlerts[id] = true;  /// đánh dấu đã cảnh báo.
    } else if (sensorAlerts[id] && highSince[id] == null) {  /// PIR đã về LOW sau khi cảnh báo →
      events.push({payload:{type:"recovery",code:"PIR_HIGH_CLEARED",zone:id}});  /// sự kiện phục hồi,
      delete sensorAlerts[id];  /// bỏ đánh dấu.
    }
  }
  flow.set("sensorAlerts",sensorAlerts);  /// Lưu danh sách vùng đang cảnh báo.
}
if (online && flow.get("invalidTelemetry") !== true) {  /// Online và dữ liệu hợp lệ:
  const idleSince = flow.get("manualIdleSince");  /// mốc bắt đầu 'kho vắng mà có đèn bật tay',
  const idleAlert = idleSince != null && now-idleSince >= config.manual_idle_seconds*1000;  /// kéo dài quá ngưỡng (mặc định 60 s)?
  if (idleAlert && !flow.get("manualIdleAlert")) events.push({payload:{type:"alert",code:"MANUAL_LIGHT_IDLE",severity:"warning",idle_seconds:config.manual_idle_seconds}});  /// Có → cảnh báo MANUAL_LIGHT_IDLE một lần.
  if (!idleAlert && flow.get("manualIdleAlert")) events.push({payload:{type:"recovery",code:"MANUAL_IDLE_CLEARED"}});  /// Hết điều kiện → phục hồi.
  flow.set("manualIdleAlert",idleAlert);  /// Lưu trạng thái cảnh báo.
  // Gio Viet Nam UTC+7, khong phu thuoc timezone may chay Node-RED; ho tro ca qua dem.
  const minute = Math.floor((now + 7*3600000)/60000) % 1440;  /// Phút hiện tại trong ngày theo giờ Việt Nam (UTC+7), không phụ thuộc múi giờ của máy.
  const toMinute = text => Number(text.slice(0,2))*60 + Number(text.slice(3));  /// 'HH:MM' → số phút trong ngày.
  const start = toMinute(config.shift_start), end = toMinute(config.shift_end);  /// Giờ bắt đầu và kết thúc ca.
  const inShift = start < end ? minute >= start && minute < end : minute >= start || minute < end;  /// Trong ca? Ca thường: start ≤ phút < end; ca qua đêm (22:00–06:00): phút ≥ start hoặc < end.
  const motion = (flow.get("telemetry")?.zones || []).some(z => z.motion);  /// Có vùng nào đang có chuyển động không.
  const afterHours = config.shift_enabled && !inShift && motion;  /// Ngoài ca + có chuyển động + đã bật tính năng.
  if (afterHours && !flow.get("afterHoursAlert")) events.push({payload:{type:"alert",code:"AFTER_HOURS_MOTION",severity:"warning"}});  /// Có → cảnh báo AFTER_HOURS_MOTION (chỉ cảnh báo, chưa kết luận xâm nhập).
  if (!afterHours && flow.get("afterHoursAlert")) events.push({payload:{type:"recovery",code:"AFTER_HOURS_CLEARED"}});  /// Hết → phục hồi.
  flow.set("afterHoursAlert",afterHours);  /// Lưu trạng thái.
}
for (const c of commands) {  /// Kiểm tra lệnh thiếu ACK:
  if (c.status === "waiting" && now-c.sent_at >= 12000) {  /// đã gửi quá 12 s mà vẫn 'waiting' →
    c.status = "timeout";  /// đánh dấu timeout (dashboard báo 'Chưa có xác nhận sau 12 giây'),
    events.push({payload:{type:"alert",code:"COMMAND_TIMEOUT",id:c.id,command:c.command,severity:"warning"}});  /// cảnh báo COMMAND_TIMEOUT – không bao giờ tuyên bố thành công khi chưa có ACK.
  }
}
flow.set("commands",commands);  /// Lưu trạng thái lệnh.
node.status({fill:online ? "green" : "red",shape:"dot",text:online ? "Live" : "Waiting / offline"});  /// Chấm Live/offline dưới node.
return events.length ? [events] : null;  /// Gửi tất cả sự kiện (nếu có) ra history trong một lần.
/// ▲ monitor.js: chạy MỖI GIÂY (node inject 'watchdog-tick'). Phát hiện: mất dữ liệu > 15 s, lệnh thiếu ACK > 12 s,
///   PIR HIGH quá lâu, đèn bật tay khi kho vắng, chuyển động ngoài ca. Mỗi cảnh báo chỉ ghi 1 lần và có sự kiện phục hồi.
