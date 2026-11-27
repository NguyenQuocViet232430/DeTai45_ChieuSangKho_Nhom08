const configuredLiveMs = Number(env.get("DT45_LIVE_WINDOW_MS"));  /// Biến môi trường DT45_LIVE_WINDOW_MS (nếu có) để đổi cửa sổ 'dữ liệu trực tiếp'.
// Wokwi thuong chay cham hon thoi gian thuc (15-60%): heartbeat 2s mo phong co the cach nhau 5-13s thuc.
const LIVE_WINDOW_MS = Number.isInteger(configuredLiveMs) && configuredLiveMs >= 3000 ? configuredLiveMs : 15000;  /// Cửa sổ dữ liệu trực tiếp: hợp lệ nếu là số nguyên ≥ 3000 ms, nếu không dùng mặc định 15 000 ms.
if (msg.kind === "rule_config") {  /// Lệnh cấu hình rule (từ dashboard hoặc Inject BAT/TAT rule):
  const enabled = msg.payload === true;  /// bật hay tắt,
  const idleSeconds = msg.idleSeconds === undefined ? (flow.get("ruleIdleSeconds") || 30) : msg.idleSeconds;  /// ngưỡng kho vắng mới, hoặc giữ ngưỡng cũ (mặc định 30 s),
  if (!Number.isInteger(idleSeconds) || idleSeconds < 15 || idleSeconds > 300) {  /// chỉ nhận 15–300 giây,
    return [null,null,msg.req ? {...msg,statusCode:400,payload:{accepted:false,reason:"invalid_idle_seconds"}} : null];  /// sai → HTTP 400.
  }
  flow.set("ruleEnabled", enabled);  /// Lưu trạng thái bật/tắt.
  flow.set("ruleIdleSeconds",idleSeconds);  /// Lưu ngưỡng.
  flow.set("ruleBegin", null);  /// Bắt đầu đếm lại từ đầu.
  flow.set("ruleFired", false);  /// Cho phép gửi AUTO ở đợt mới.
  node.status({fill:enabled ? "blue" : "grey",shape:"dot",text:enabled ? `BAT: ${idleSeconds}s` : "TAT"});  /// Hiển thị BAT: 30s / TAT dưới node.
  return [null,{payload:{type:"rule_config",enabled,idle_seconds:idleSeconds}},  /// Ghi nhật ký rule_config,
    msg.req ? {...msg,statusCode:200,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},payload:{accepted:true,enabled,idle_seconds:idleSeconds}} : null];  /// và trả HTTP 200 nếu cấu hình đến từ dashboard.
}
if (!msg.live || !flow.get("ruleEnabled")) return null;  /// Chỉ xét telemetry TRỰC TIẾP và khi rule đang bật (mặc định TẮT).
const now = Date.now(), p = msg.payload;  /// Thời điểm và telemetry.
const previousAt = flow.get("ruleLastAt"), previousUptime = flow.get("ruleLastUptime");  /// Lần xét trước và uptime lúc đó.
if (previousAt == null || now - previousAt > LIVE_WINDOW_MS ||  /// Gián đoạn dữ liệu quá 15 s
    previousUptime == null || p.uptime_ms < previousUptime) {  /// hoặc ESP32 khởi động lại (uptime giảm) →
  flow.set("ruleBegin", null);  /// hủy đợt đếm,
  flow.set("ruleFired", false);  /// cho phép gửi lại.
}
flow.set("ruleLastAt", now);  /// Ghi mốc lần xét.
flow.set("ruleLastUptime", p.uptime_ms);  /// Ghi uptime.
const noPresence = p.zones.every(z => z.pir === 0 && !z.motion);  /// Kho vắng: cả 3 PIR = 0 và không vùng nào có chuyển động hợp lệ.
const manualLight = p.zones.some(z => z.mode === "MANUAL" && z.led);  /// Có ít nhất một đèn đang bật THỦ CÔNG.
if (!noPresence || !manualLight || !flow.get("deviceOnline")) {  /// Không thỏa (có người, hoặc không có đèn bật tay, hoặc offline) →
  flow.set("ruleBegin", null);  /// hủy đợt đếm,
  flow.set("ruleFired", false);
  return null;  /// không làm gì.
}
let begin = flow.get("ruleBegin");  /// Đủ điều kiện:
if (begin == null) { begin = now; flow.set("ruleBegin", begin); }  /// bắt đầu đếm nếu chưa đếm.
const idleMs = (flow.get("ruleIdleSeconds") || 30)*1000;  /// Ngưỡng tính bằng ms.
if (now - begin < idleMs || flow.get("ruleFired")) return null;  /// Chưa đủ thời gian, hoặc đợt này đã gửi AUTO rồi → chờ.
flow.set("ruleFired", true);  /// Đánh dấu đã gửi (mỗi đợt kho vắng chỉ gửi 1 lần).
node.status({fill:"yellow",shape:"dot",text:`Vang ${idleMs/1000}s: gui AUTO`});  /// Hiển thị dưới node.
return [{payload:"AUTO",automatic:true},  /// Cổng 1 → command.js: AUTO với cờ automatic (không hủy đợt đếm).
  {topic:msg.topic,payload:{type:"automation",rule:"idle_manual_on",idle_seconds:idleMs/1000,command:"AUTO",device:p.device}},null];  /// Cổng 2 → nhật ký sự kiện automation; cổng 3 (HTTP) không dùng.
  /// ▲ rule.js: LUẬT TỰ ĐỘNG thứ 2 (chạy ở Node-RED): có đèn bật tay + kho vắng liên tục đủ ngưỡng → gửi AUTO cho cả 3 vùng,
  ///   tránh quên tắt đèn. Luật thứ 1 (đèn theo PIR, giữ 10 s) chạy tại ESP32.
