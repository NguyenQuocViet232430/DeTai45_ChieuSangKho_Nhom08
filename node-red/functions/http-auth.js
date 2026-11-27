const expected = env.get("DT45_CONTROL_TOKEN");  /// Mã điều khiển của phiên, do start.ps1 sinh ngẫu nhiên (GUID) mỗi lần chạy.
const token = msg.req?.headers?.["x-dt45-token"];  /// Mã người dùng gửi trong header x-dt45-token.
function fail(status,reason) {  /// Trả lỗi HTTP ra cổng 3 (http response).
  return [null,null,{...msg,statusCode:status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},payload:{accepted:false,reason}}];  /// JSON {accepted:false, reason}; Cache-Control: no-store để trình duyệt không lưu.
}
if (!expected) return fail(503,"control_not_configured");  /// Chưa cấu hình mã (không chạy bằng start.ps1) → 503.
if (typeof token !== "string" || token !== expected) return fail(403,"operator_required");  /// Thiếu hoặc sai mã → 403: người chỉ xem không được điều khiển.
if (!msg.payload || typeof msg.payload !== "object" || Array.isArray(msg.payload)) return fail(400,"invalid_body");  /// Body phải là đối tượng JSON.
if (msg.req.url.split("?")[0].endsWith("/alerts")) return [null,null,null,msg];  /// POST /dt45/api/alerts → cổng 4 (settings.js).
if (msg.req.url.split("?")[0].endsWith("/rule")) {  /// POST /dt45/api/rule:
  if (typeof msg.payload.enabled !== "boolean" || !Number.isInteger(msg.payload.idle_seconds) ||  /// enabled phải là true/false và idle_seconds là số nguyên
      msg.payload.idle_seconds < 15 || msg.payload.idle_seconds > 300) return fail(400,"invalid_rule_config");  /// trong khoảng 15–300 giây.
  msg.idleSeconds = msg.payload.idle_seconds;  /// Chuyển sang định dạng mà rule.js đọc.
  msg.payload = msg.payload.enabled;  /// payload = bật/tắt.
  msg.kind = "rule_config";  /// Đánh dấu là lệnh cấu hình rule.
  return [null,msg,null];  /// → cổng 2 (rule.js).
}
if (typeof msg.payload.command !== "string") return fail(400,"invalid_command");  /// POST /dt45/api/command: body phải có command dạng chuỗi.
msg.payload = msg.payload.command;  /// Chỉ giữ tên lệnh.
msg.source = "dashboard";  /// Ghi nguồn 'dashboard' để nhật ký và CSDL phân biệt với Telegram.
return [msg,null,null];  /// → cổng 1 (command.js).
/// ▲ http-auth.js: kiểm tra quyền và định dạng của mọi API ghi; sai mã → 403, sai dữ liệu → 400.
///   4 cổng ra: [command] [rule] [HTTP response lỗi] [settings cảnh báo].
