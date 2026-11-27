// Telegram Bot cho de tai 45: gui canh bao va nhan lenh /status, /on1.../auto.
// Dung Bot API qua HTTPS (fetch co san trong Node.js 18+), khong can cai node rieng.
// Token va chat duoc phep doc tu bien moi truong, khong nam trong flows.json.
'use strict';  /// Chế độ nghiêm ngặt.

const COMMANDS = {  /// Bảng ánh xạ lệnh Telegram → lệnh ESP32:
  '/on1': 'ON1', '/off1': 'OFF1', '/on2': 'ON2', '/off2': 'OFF2', '/on3': 'ON3', '/off3': 'OFF3',  /// bật/tắt từng vùng,
  '/allon': 'ALL_ON', '/alloff': 'ALL_OFF', '/auto': 'AUTO'  /// cả kho và trả về tự động.
};

const HELP_TEXT = [  /// Nội dung trả lời /help:
  'Bot chiếu sáng kho – Nhóm 08, Đề tài 45',
  '/status – xem trạng thái 3 vùng',
  '/on1 /off1 /on2 /off2 /on3 /off3 – bật/tắt tay từng vùng',
  '/allon /alloff – bật/tắt cả kho (thủ công)',
  '/auto – trả cả 3 vùng về tự động theo PIR',
  'Cảnh báo (mất kết nối, PIR giữ HIGH lâu, đèn bật tay khi kho vắng, chuyển động ngoài ca, lệnh thiếu ACK) được gửi tự động.'  /// liệt kê các cảnh báo được gửi tự động.
].join('\n');  /// Ghép các dòng.

// "/ON1@ten_bot extra" -> {kind:'command', command:'ON1'}
function parseCommand(text) {  /// Phân tích tin nhắn thành lệnh.
  const first = String(text || '').trim().split(/\s+/)[0].toLowerCase().replace(/@.*$/, '');  /// Lấy từ đầu tiên, chữ thường, bỏ phần @ten_bot (khi dùng trong nhóm chat).
  if (first === '/start' || first === '/help') return {kind: 'help'};  /// /start, /help → trợ giúp.
  if (first === '/status') return {kind: 'status'};  /// /status → trạng thái.
  if (COMMANDS[first]) return {kind: 'command', command: COMMANDS[first]};  /// Lệnh điều khiển có trong bảng.
  return {kind: 'unknown'};  /// Còn lại → không hợp lệ.
}
/// ▲ parseCommand(): '/ON1@kho_bot' → {kind:'command', command:'ON1'}.

function createTelegram({token, chatIds, apiBase = 'https://api.telegram.org', fetchImpl = globalThis.fetch,  /// Tạo đối tượng bot. fetchImpl và apiBase cho phép test dùng máy chủ Telegram giả lập.
  timeoutMs = 10000, now = () => Date.now()} = {}) {  /// Hết 10 s không phản hồi thì hủy yêu cầu.
  token = typeof token === 'string' ? token.trim() : '';  /// Token (bỏ khoảng trắng thừa).
  const allowed = new Set(String(chatIds || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean));  /// Danh sách chat ID được phép điều khiển (cách nhau bởi dấu phẩy, chấm phẩy hoặc khoảng trắng).
  const enabled = token.length > 0 && typeof fetchImpl === 'function';  /// Chỉ bật khi có token.
  let offset = 0, polling = false, lastError = null, lastOkAt = null, sent = 0, received = 0;  /// offset = update kế tiếp cần lấy; polling = đang có lần hỏi chưa xong; các số liệu thống kê.
  // Khong bao gio dua token vao thong bao loi / log.
  const clean = message => String(message || 'loi khong xac dinh').split(token).join('***');  /// Thay token bằng *** trong mọi thông báo lỗi.

  async function call(method, body) {  /// Gọi một phương thức của Telegram Bot API (HTTPS POST, JSON).
    const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined;  /// Đặt thời gian chờ tối đa.
    const response = await fetchImpl(`${apiBase}/bot${token}/${method}`, {  /// URL dạng https://api.telegram.org/bot<token>/<method>.
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal});  /// Gửi JSON.
    let data = null;
    try { data = await response.json(); } catch {}  /// Đọc phản hồi JSON.
    if (!data || data.ok !== true) throw Error(data?.description || `HTTP ${response.status}`);  /// Telegram trả ok:false → báo lỗi kèm mô tả.
    lastOkAt = now(); lastError = null;  /// Ghi nhận thành công.
    return data.result;  /// Kết quả của phương thức.
  }
  /// ▲ call(): lớp gọi Bot API dùng chung cho sendMessage và getUpdates.

  // Gui toi 1 chat (tra loi lenh) hoac toi tat ca chat duoc phep (canh bao).
  async function send(text, chatId) {  /// Gửi tin nhắn: tới 1 chat (trả lời lệnh) hoặc tới tất cả chat được phép (cảnh báo).
    if (!enabled) return false;  /// Bot tắt → không gửi.
    const targets = chatId !== undefined && chatId !== null ? [String(chatId)] : [...allowed];  /// Danh sách người nhận.
    let ok = 0;  /// Số tin gửi thành công.
    for (const target of targets) {  /// Gửi lần lượt từng người:
      try { await call('sendMessage', {chat_id: target, text: String(text).slice(0, 4000)}); sent++; ok++; }  /// sendMessage, cắt tối đa 4000 ký tự (giới hạn của Telegram là 4096).
      catch (e) { lastError = clean(e.message); }  /// Lỗi một người không làm dừng các người khác.
    }
    return ok > 0;  /// true nếu gửi được ít nhất một tin.
  }
  /// ▲ send(): gửi cảnh báo hoặc trả lời; không bao giờ ném lỗi ra ngoài.

  // Lay tin nhan moi (getUpdates, khong webhook). Khong chay chong cheo.
  async function poll() {  /// Lấy tin nhắn mới bằng getUpdates.
    if (!enabled || polling) return [];  /// Bot tắt hoặc lần hỏi trước chưa xong → không gọi chồng.
    polling = true;  /// Đánh dấu đang hỏi.
    try {
      const updates = await call('getUpdates', {offset, timeout: 0, allowed_updates: ['message']});  /// Chỉ lấy update từ 'offset' trở đi, không chờ (timeout 0), chỉ loại tin nhắn.
      const messages = [];  /// Danh sách tin trả về.
      for (const u of Array.isArray(updates) ? updates : []) {  /// Duyệt từng update:
        if (Number.isInteger(u.update_id)) offset = Math.max(offset, u.update_id + 1);  /// dời offset qua update này → lần sau Telegram không gửi lại (đã xác nhận đã đọc).
        const m = u.message;  /// Nội dung tin nhắn.
        if (!m || typeof m.text !== 'string' || !m.chat) continue;  /// Không phải tin chữ → bỏ qua.
        const chatId = String(m.chat.id);  /// Chat ID dạng chuỗi.
        received++;  /// Đếm tin nhận.
        messages.push({chatId, text: m.text.trim(), authorized: allowed.has(chatId),  /// Thêm vào kết quả, kèm cờ authorized (chat có trong danh sách được phép không),
          from: m.from?.username || m.from?.first_name || ''});  /// và tên người gửi.
      }
      return messages;  /// Trả về các tin mới.
    } catch (e) {  /// Lỗi mạng hoặc API →
      lastError = clean(e.message);  /// nhớ lỗi (đã che token),
      return [];  /// coi như không có tin.
    } finally {
      polling = false;  /// Cho phép lần hỏi sau.
    }
  }
  /// ▲ poll(): long-polling không cần webhook/IP public; không chạy chồng; offset đảm bảo mỗi tin chỉ xử lý 1 lần.

  function status() {  /// Thống kê cho dashboard:
    return {enabled, chats: allowed.size, last_error: lastError, last_ok_at: lastOkAt, sent, received};  /// bật/tắt, số chat được phép, lỗi gần nhất, lần thành công gần nhất, số tin đã gửi/nhận.
  }

  // parseCommand/helpText di kem de Function node dung ma khong can require.
  return {enabled, send, poll, status, isAllowed: id => allowed.has(String(id)), parseCommand, helpText: HELP_TEXT};  /// Giao diện công khai của bot.
}
/// ▲ createTelegram(): token chỉ đọc từ biến môi trường, không nằm trong flows.json; chỉ chat trong danh sách mới điều khiển được.

module.exports = {createTelegram, parseCommand, HELP_TEXT, COMMANDS};  /// Xuất ra cho settings.js và test.
