// Moi 3 giay lay tin nhan Telegram moi. Chi chat co trong DT45_TELEGRAM_CHAT_ID moi duoc dieu khien.
// Lenh hop le di vao node "command" (cung kiem tra live telemetry, tao ID, cho ACK nhu dashboard).
const tg = global.get("dt45tg");  /// Đối tượng Telegram tạo trong settings.js.
if (!tg || !tg.enabled) {  /// Chưa có token →
  node.status({fill:"grey",shape:"ring",text:"Telegram tat (chua co token)"});  /// báo xám, không gọi Internet.
  return null;
}
const configuredLiveMs = Number(env.get("DT45_LIVE_WINDOW_MS"));  /// Biến môi trường DT45_LIVE_WINDOW_MS (nếu có) để đổi cửa sổ 'dữ liệu trực tiếp'.
const LIVE_WINDOW_MS = Number.isInteger(configuredLiveMs) && configuredLiveMs >= 3000 ? configuredLiveMs : 15000;  /// Cửa sổ dữ liệu trực tiếp: hợp lệ nếu là số nguyên ≥ 3000 ms, nếu không dùng mặc định 15 000 ms.
function statusText() {  /// Tạo nội dung trả lời lệnh /status:
  const p = flow.get("telemetry"), lastAt = flow.get("lastTelemetryAt");  /// telemetry và lần nhận gần nhất,
  if (!p || !Array.isArray(p.zones)) return "Chưa nhận dữ liệu từ ESP32.";  /// chưa có dữ liệu,
  const online = flow.get("deviceOnline") === true && lastAt != null && Date.now()-lastAt <= LIVE_WINDOW_MS;  /// online khi có dữ liệu trực tiếp trong 15 s,
  const lines = [online ? "ESP32: trực tuyến" : "ESP32: mất kết nối – đây là dữ liệu gần nhất"];  /// dòng đầu: trạng thái kết nối,
  for (const z of p.zones) {  /// mỗi vùng một dòng:
    lines.push("Vùng "+z.id+": đèn "+(z.led ? "BẬT" : "tắt")+" · "+(z.mode === "AUTO" ? "Tự động" : "Thủ công")+  /// đèn, chế độ,
      " · "+(z.motion ? "có chuyển động" : "không chuyển động"));  /// và chuyển động,
  }
  lines.push("Đèn sáng: "+p.zones.filter(z => z.led).length+"/3 · Giữ đèn "+Math.round(p.timeout_ms/1000)+" giây");  /// dòng tổng: số đèn sáng và thời gian giữ.
  return lines.join("\n");  /// Ghép thành một tin nhắn.
}
tg.poll().then(messages => {  /// Hỏi Telegram có tin mới không (getUpdates, bất đồng bộ):
  const commands = [], logs = [];  /// lệnh sẽ gửi xuống và sự kiện cần ghi nhật ký,
  for (const m of messages) {  /// duyệt từng tin:
    const parsed = tg.parseCommand(m.text);  /// phân tích lệnh (/on1 → ON1, /status, /help...),
    if (!m.authorized) {  /// chat KHÔNG có trong danh sách được phép →
      tg.send("Chat ID "+m.chatId+" chưa được cấp quyền. Thêm số này vào DT45_TELEGRAM_CHAT_ID rồi chạy lại Node-RED.",m.chatId);  /// trả lời kèm Chat ID để người quản trị thêm vào cấu hình,
      logs.push({payload:{type:"telegram",action:"unauthorized",command:parsed.command || null}});  /// ghi nhật ký lần thử trái phép,
      continue;  /// không thực hiện.
    }
    if (parsed.kind === "help") tg.send(tg.helpText,m.chatId);  /// /help hoặc /start → danh sách lệnh,
    else if (parsed.kind === "status") tg.send(statusText(),m.chatId);  /// /status → trạng thái 3 vùng,
    else if (parsed.kind === "command") commands.push({payload:parsed.command,source:"telegram"});  /// lệnh điều khiển → chuyển sang command.js với nguồn 'telegram',
    else tg.send("Lệnh không hợp lệ. Gõ /help để xem danh sách lệnh.",m.chatId);  /// khác → báo lệnh không hợp lệ.
  }
  const st = tg.status();  /// Thống kê của bot.
  node.status(st.last_error ? {fill:"red",shape:"ring",text:"Telegram loi: "+String(st.last_error).slice(0,40)} :  /// Có lỗi → chấm đỏ kèm lỗi rút gọn (không bao giờ chứa token),
    {fill:"green",shape:"dot",text:"Telegram: "+st.received+" tin, "+st.sent+" da gui"});  /// không lỗi → chấm xanh với số tin nhận/gửi.
  if (commands.length || logs.length) node.send([commands.length ? commands : null,logs.length ? logs : null]);  /// Gửi bất đồng bộ: cổng 1 → command.js, cổng 2 → history.
  node.done();  /// Báo Node-RED đã xử lý xong lần chạy này.
}).catch(e => {  /// Lỗi ngoài dự kiến →
  node.status({fill:"red",shape:"ring",text:"Telegram loi"});  /// báo đỏ,
  node.done();  /// vẫn kết thúc lần chạy.
});
return null;  /// Không trả gì đồng bộ – kết quả gửi qua node.send() ở trên.
/// ▲ telegram-in.js: chạy mỗi 3 s (node inject 'telegram-tick'). Dùng long-polling getUpdates nên không cần webhook hay IP public.
///   Lệnh Telegram đi qua CÙNG cổng kiểm soát command.js như dashboard: kiểm tra online, tạo ID, QoS 1, chờ ACK.
