const p = msg.payload;  /// Body của POST /dt45/api/alerts (đã qua http-auth).
const clock = value => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);  /// Kiểm tra giờ dạng HH:MM 24 giờ.
const valid = p && Number.isInteger(p.pir_high_seconds) && p.pir_high_seconds >= 5 && p.pir_high_seconds <= 3600 &&  /// PIR HIGH: số nguyên 5–3600 giây,
  Number.isInteger(p.manual_idle_seconds) && p.manual_idle_seconds >= 15 && p.manual_idle_seconds <= 300 &&  /// kho vắng: số nguyên 15–300 giây,
  typeof p.shift_enabled === "boolean" && clock(p.shift_start) && clock(p.shift_end) && p.shift_start !== p.shift_end;  /// bật/tắt ngoài ca là boolean, giờ bắt đầu/kết thúc hợp lệ và khác nhau.
const response = (status,payload) => ({...msg,statusCode:status,  /// Tạo phản hồi HTTP JSON
  headers:{"Content-Type":"application/json","Cache-Control":"no-store"},payload});  /// không lưu cache.
if (!valid) return [null,response(400,{accepted:false,reason:"invalid_alert_config"})];  /// Sai → HTTP 400, không đổi cấu hình.
// Chi luu cac truong da kiem tra, khong cho body ghi de flow context tuy y.
const config = {pir_high_seconds:p.pir_high_seconds,manual_idle_seconds:p.manual_idle_seconds,  /// Chỉ chép các trường đã kiểm tra:
  shift_enabled:p.shift_enabled,shift_start:p.shift_start,shift_end:p.shift_end};  /// body không thể ghi đè dữ liệu khác trong flow context.
flow.set("alertConfig",config);  /// Lưu cấu hình cảnh báo (monitor.js và http-state.js đọc).
flow.set("pirHighSince",{});  /// Đặt lại các bộ đếm để ngưỡng mới áp dụng từ đầu:
flow.set("sensorAlerts",{});
flow.set("manualIdleSince",null);
flow.set("manualIdleAlert",false);
flow.set("afterHoursAlert",false);
return [{payload:{type:"alert_config",...config}},response(200,{accepted:true,...config})];  /// Cổng 1 → nhật ký alert_config; cổng 2 → HTTP 200.
/// ▲ settings.js: lưu cấu hình cảnh báo & ca làm việc; cấu hình chỉ tồn tại trong phiên Node-RED.
