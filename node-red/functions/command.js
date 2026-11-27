const configuredLiveMs = Number(env.get("DT45_LIVE_WINDOW_MS"));  /// Biến môi trường DT45_LIVE_WINDOW_MS (nếu có) để đổi cửa sổ 'dữ liệu trực tiếp'.
// Wokwi thuong chay cham hon thoi gian thuc (15-60%): heartbeat 2s mo phong co the cach nhau 5-13s thuc.
const LIVE_WINDOW_MS = Number.isInteger(configuredLiveMs) && configuredLiveMs >= 3000 ? configuredLiveMs : 15000;  /// Cửa sổ dữ liệu trực tiếp: hợp lệ nếu là số nguyên ≥ 3000 ms, nếu không dùng mặc định 15 000 ms.
const command = String(msg.payload).trim().toUpperCase();  /// Lệnh từ dashboard/Telegram/Inject/rule, chuẩn hóa: bỏ khoảng trắng, chữ hoa.
const allowed = ["ALL_ON","ALL_OFF","AUTO","ON1","OFF1","ON2","OFF2","ON3","OFF3","STATUS","PRELIGHT_ON","PRELIGHT_OFF"];  /// Danh sách trắng các lệnh được phép gửi xuống ESP32.
const timeout = /^TIMEOUT=([0-9]{1,3})$/.exec(command);  /// TIMEOUT=X với X là 1–3 chữ số.
const validCommand = allowed.includes(command) || (timeout && Number(timeout[1]) >= 3 && Number(timeout[1]) <= 300);  /// Hợp lệ khi nằm trong danh sách trắng hoặc TIMEOUT trong khoảng 3–300 giây.
function reply(status,payload) {  /// Tạo phản hồi HTTP nếu lệnh đến từ API (msg.req có); từ Inject/Telegram thì không cần.
  return msg.req ? {...msg,statusCode:status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},payload} : null;  /// Giữ nguyên msg gốc (để node http response biết trả cho request nào), thêm mã trạng thái và JSON.
}
const lastAt = flow.get("lastTelemetryAt");  /// Thời điểm nhận telemetry trực tiếp gần nhất (validate.js ghi).
const online = flow.get("deviceOnline") === true && lastAt != null && Date.now() - lastAt <= LIVE_WINDOW_MS;  /// Thiết bị coi là online khi có telemetry LIVE trong cửa sổ 15 s – bản tin retained cũ không tính.
const invalidTelemetry = flow.get("invalidTelemetry") === true;  /// Telemetry gần nhất sai cấu trúc → khóa điều khiển.
const source = msg.automatic ? "automation" : (msg.source || "inject");  /// Nguồn lệnh: automation (rule), dashboard, telegram hoặc inject → ghi vào nhật ký và CSDL.
if (!validCommand || !online || invalidTelemetry) {  /// Không gửi nếu lệnh sai, thiết bị offline hoặc dữ liệu sai:
  const reason = !validCommand ? "invalid_command" : !online ? "no_live_telemetry" : "invalid_telemetry";  /// lý do từ chối,
  node.warn(`Tu choi ${command}: ${reason}`);  /// cảnh báo trong Debug của Node-RED,
  return [null,{payload:{type:"command_rejected",command,reason,source}},reply(!validCommand ? 400 : 409,{accepted:false,reason})];  /// ra cổng 2 (nhật ký) sự kiện command_rejected; cổng 3 trả HTTP 400 (lệnh sai) hoặc 409 (thiết bị không sẵn sàng).
}
if (!msg.automatic) {  /// Lệnh do người vận hành gửi (không phải rule) →
  flow.set("ruleBegin", null);  /// hủy đợt đếm kho vắng đang chạy,
  flow.set("ruleFired", false);  /// cho phép rule chạy lại ở đợt sau.
}
const sequence = (flow.get("commandSequence") || 0) + 1;  /// Số thứ tự lệnh tăng dần trong phiên Node-RED.
flow.set("commandSequence",sequence);  /// Lưu lại số thứ tự.
const id = "c-"+Date.now().toString(36)+"-"+sequence.toString(36);  /// ID lệnh duy nhất: c-<thời gian base36>-<số thứ tự base36>, ví dụ c-mvapjamd-3.
const pending = flow.get("commands") || [];  /// Danh sách lệnh đang theo dõi ACK.
pending.push({id,command,source,sent_at:Date.now(),status:"waiting"});  /// Thêm lệnh mới, trạng thái 'waiting' (chờ ESP32 xác nhận).
flow.set("commands",pending.slice(-20));  /// Chỉ giữ 20 lệnh gần nhất để bộ nhớ không tăng mãi.
const topic = "iot/nhom08/detai45/kho-c7e2/command/all";  /// Topic lệnh của nhóm.
return [{topic,payload:`CMD|${id}|${command}`,qos:1,retain:false},  /// Cổng 1 → MQTT out: payload CMD|<id>|<lệnh>, QoS 1, KHÔNG retain (để ESP32 kết nối lại không chạy lệnh cũ).
  {topic,payload:{type:"command_sent",id,command,source}},  /// Cổng 2 → nhật ký: command_sent.
  reply(202,{accepted:true,id,command,status:"waiting"})];  /// Cổng 3 → HTTP 202 Accepted: đã gửi, đang chờ ACK.
  /// ▲ command.js: cổng kiểm soát DUY NHẤT trước khi lệnh xuống ESP32 – dashboard, Telegram, Inject và rule đều phải đi qua đây.
  ///   3 cổng ra: [MQTT out + debug] [nhật ký] [HTTP response].
