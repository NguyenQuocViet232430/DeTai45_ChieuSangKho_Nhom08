const configuredLiveMs = Number(env.get("DT45_LIVE_WINDOW_MS"));  /// Biến môi trường DT45_LIVE_WINDOW_MS (nếu có) để đổi cửa sổ 'dữ liệu trực tiếp'.
// Wokwi thuong chay cham hon thoi gian thuc (15-60%): heartbeat 2s mo phong co the cach nhau 5-13s thuc.
const LIVE_WINDOW_MS = Number.isInteger(configuredLiveMs) && configuredLiveMs >= 3000 ? configuredLiveMs : 15000;  /// Cửa sổ dữ liệu trực tiếp: hợp lệ nếu là số nguyên ≥ 3000 ms, nếu không dùng mặc định 15 000 ms.
const now = Date.now(), lastAt = flow.get("lastTelemetryAt"), lastSeen = flow.get("lastSeenAt");  /// Thời điểm hiện tại, lần nhận telemetry trực tiếp và lần thấy thiết bị gần nhất.
const online = flow.get("deviceOnline") === true && lastAt != null && now-lastAt <= LIVE_WINDOW_MS;  /// Online khi có telemetry trực tiếp trong cửa sổ 15 s.
const begin = flow.get("ruleBegin");  /// Thời điểm bắt đầu đếm kho vắng (null nếu không đếm).
const token = env.get("DT45_CONTROL_TOKEN");  /// Mã điều khiển của phiên.
const p = flow.get("telemetry");  /// Telemetry gần nhất.
const usage = p && Number.isSafeInteger(p.session_ms) && p.zones.every(z => Number.isSafeInteger(z.on_ms)) ? {  /// Tính thống kê thời gian sáng nếu firmware có gửi session_ms và on_ms:
  session_ms:p.session_ms,total_on_ms:p.zones.reduce((sum,z) => sum+z.on_ms,0),  /// tổng thời gian phiên và tổng thời gian sáng của 3 đèn,
  saving_pct:p.session_ms > 0 ? Math.max(0,Math.min(100,100*(1-p.zones.reduce((sum,z)=>sum+z.on_ms,0)/(3*p.session_ms)))) : null  /// % giảm = 100 × (1 − tổng sáng / (3 × thời gian phiên)), kẹp trong 0–100.
} : null;  /// Firmware cũ không có số liệu → null.
const configuredHighMs = Number(env.get("DT45_PIR_HIGH_MS"));  /// Ngưỡng PIR HIGH lâu có thể đặt bằng biến môi trường (dùng trong test).
const alertConfig = flow.get("alertConfig") || {pir_high_seconds:  /// Cấu hình cảnh báo hiện tại, hoặc mặc định:
  Number.isInteger(configuredHighMs) && configuredHighMs >= 1000 ? configuredHighMs/1000 : 120,  /// PIR HIGH 120 s,
  manual_idle_seconds:60,shift_enabled:false,shift_start:"08:00",shift_end:"17:00"};  /// đèn bật tay khi kho vắng 60 s, cảnh báo ngoài ca tắt, ca 08:00–17:00.
// CSDL lich su va Telegram duoc tao trong settings.js (functionGlobalContext).
const context = typeof global !== "undefined" && global && typeof global.get === "function" ? global : null;  /// Lấy global context của Node-RED (trong test có thể không có).
const store = context ? context.get("dt45db") : null, telegram = context ? context.get("dt45tg") : null;  /// dt45db = CSDL SQLite, dt45tg = Telegram bot – cả hai được tạo trong settings.js.
msg.headers = {"Content-Type":"application/json","Cache-Control":"no-store"};  /// Phản hồi JSON, không lưu cache.
msg.payload = {  /// Ảnh chụp toàn bộ trạng thái cho dashboard (dashboard gọi mỗi giây):
  server_time:now,online,live_window_ms:LIVE_WINDOW_MS,reason:flow.get("connectionReason") || "waiting",  /// giờ máy chủ, online, cửa sổ live, lý do kết nối,
  control_allowed:online && flow.get("invalidTelemetry") !== true,  /// được phép điều khiển khi online và dữ liệu hợp lệ,
  last_seen_at:lastSeen ?? null,age_ms:lastSeen == null ? null : now-lastSeen,  /// lần thấy thiết bị gần nhất và đã bao lâu,
  role:token && msg.req?.headers?.["x-dt45-token"] === token ? "operator" : "viewer",  /// vai trò: operator nếu gửi đúng mã, ngược lại viewer,
  telemetry:flow.get("telemetry") || null,telemetry_source:flow.get("telemetrySource") || null,  /// telemetry gần nhất và nguồn (live/retained),
  invalid_telemetry:flow.get("invalidTelemetry") === true,  /// dữ liệu gần nhất có sai cấu trúc không,
  sensor_alerts:online && flow.get("invalidTelemetry") !== true ? Object.keys(flow.get("sensorAlerts") || {}).map(Number) : [],  /// danh sách vùng đang cảnh báo PIR HIGH lâu,
  usage,alert_config:alertConfig,  /// thống kê thời gian sáng và cấu hình cảnh báo,
  incident_alerts:online && flow.get("invalidTelemetry") !== true ? {  /// cảnh báo sự cố (chỉ khi online):
    manual_idle:flow.get("manualIdleAlert") === true,after_hours:flow.get("afterHoursAlert") === true  /// đèn bật tay khi kho vắng, chuyển động ngoài ca,
  } : {manual_idle:false,after_hours:false},
  rule:{enabled:flow.get("ruleEnabled") === true,idle_seconds:flow.get("ruleIdleSeconds") || 30,  /// trạng thái quy tắc kho vắng: bật/tắt, ngưỡng,
    remaining_ms:online && begin != null && !flow.get("ruleFired") ? Math.max(0,(flow.get("ruleIdleSeconds") || 30)*1000-(now-begin)) : null},  /// thời gian còn lại trước khi gửi AUTO,
  commands:flow.get("commands") || [],events:flow.get("journal") || [],samples:flow.get("samples") || [],  /// 20 lệnh gần nhất (kèm ACK, RTT), 100 sự kiện gần nhất, 60 mẫu biểu đồ,
  storage:store && typeof store.stats === "function" ? store.stats() : {available:false,error:"not_configured"},  /// trạng thái CSDL: số dòng trạng thái, số sự kiện, lỗi gần nhất,
  telegram:telegram && typeof telegram.status === "function" ? telegram.status() : {enabled:false,chats:0}  /// trạng thái Telegram: bật/tắt, số chat được phép, số tin đã gửi/nhận.
};
return msg;  /// → http response.
/// ▲ http-state.js: GET /dt45/api/state – dữ liệu duy nhất mà dashboard cần để vẽ giao diện.
