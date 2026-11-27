// CSDL lich su SQLite cho de tai 45 (dung node:sqlite co san trong Node.js 22.5+, khong can cai them).
// Bang telemetry_log: moi dong la trang thai 1 vung tai 1 thoi diem.
// Bang event_log: moi lenh, ACK, canh bao, phuc hoi, rule... (giong events.jsonl nhung truy van duoc).
'use strict';  /// Chế độ nghiêm ngặt của JavaScript: báo lỗi sớm khi dùng biến chưa khai báo.
const fs = require('node:fs');  /// Tạo thư mục chứa file CSDL.
const path = require('node:path');  /// Ghép đường dẫn đúng chuẩn Windows/Linux.

const VN_OFFSET_MS = 7 * 3600000;  /// Việt Nam là UTC+7 (không có giờ mùa hè).
const pad = n => String(n).padStart(2, '0');  /// Thêm số 0 phía trước: 7 → '07'.
// Gio Viet Nam (UTC+7) dang "YYYY-MM-DD HH:mm:ss", khong phu thuoc timezone may chay Node-RED.
function vnTime(ms) {  /// Đổi mốc thời gian (ms) sang giờ Việt Nam để hiển thị và xuất CSV.
  const d = new Date(ms + VN_OFFSET_MS);  /// Cộng 7 giờ rồi đọc bằng các hàm UTC → không phụ thuộc múi giờ của máy chạy Node-RED.
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +  /// Ngày dạng YYYY-MM-DD,
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;  /// giờ dạng HH:mm:ss.
}
const vnDay = ms => vnTime(ms).slice(0, 10);  /// Chỉ lấy phần ngày (dùng để gom thời gian sáng theo ngày).
const bit = v => (v ? 1 : 0);  /// true/false → 1/0 (SQLite không có kiểu boolean).
const intOrNull = v => (Number.isSafeInteger(v) ? v : null);  /// Chỉ nhận số nguyên an toàn, còn lại ghi NULL.
const textOrNull = v => (v === undefined || v === null ? null : String(v));  /// Chuỗi hoặc NULL.

// CSV mo bang Excel: co BOM, boc dau nhay, chan cong thuc (=,+,-,@) de tranh CSV injection.
function toCsv(rows, columns) {  /// Chuyển danh sách dòng thành nội dung CSV theo danh sách cột {key, label}.
  const cell = value => {  /// Định dạng một ô:
    if (value === null || value === undefined) return '';  /// giá trị rỗng → ô trống,
    let text = String(value);  /// đổi sang chuỗi,
    if (/^[=+\-@]/.test(text) && typeof value === 'string') text = "'" + text;  /// chuỗi bắt đầu bằng = + - @ → thêm dấu ' để Excel không chạy như công thức (chống CSV injection),
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;  /// ô có dấu phẩy, ngoặc kép hoặc xuống dòng → bọc trong ngoặc kép và nhân đôi ngoặc kép bên trong.
  };
  const lines = [columns.map(c => cell(c.label)).join(',')];  /// Dòng tiêu đề.
  for (const row of rows) lines.push(columns.map(c => cell(row[c.key])).join(','));  /// Mỗi bản ghi một dòng.
  return '﻿' + lines.join('\r\n') + '\r\n';  /// BOM (\uFEFF) để Excel đọc đúng UTF-8; xuống dòng kiểu Windows CRLF.
}
/// ▲ toCsv(): xuất CSV mở được ngay bằng Excel (tiếng Việt không lỗi font, không bị chèn công thức).

function disabledStore(file, reason) {  /// Đối tượng 'CSDL tắt' có cùng giao diện: mọi hàm trả rỗng/false → Node-RED vẫn chạy khi không có SQLite.
  return {
    available: false, file, error: reason,  /// Không dùng được, kèm lý do.
    saveTelemetry: () => false, saveEvent: () => false,  /// Ghi: luôn trả false.
    queryTelemetry: () => [], queryEvents: () => [], usageByDay: () => [],  /// Đọc: luôn trả mảng rỗng.
    stats: () => ({available: false, file, error: reason}), toCsv, close() {}  /// Thống kê báo không khả dụng.
  };
}
/// ▲ disabledStore(): mẫu 'Null Object' – khi CSDL hỏng, phần còn lại của hệ thống không cần kiểm tra lỗi ở mọi nơi.

function openStore(file, {sampleMs = 10000, now = () => Date.now()} = {}) {  /// Mở (hoặc tạo) CSDL. sampleMs = chu kỳ lưu tối thiểu khi trạng thái không đổi; now() cho phép test giả lập thời gian.
  let DatabaseSync;  /// Lớp CSDL đồng bộ của Node.js.
  try {
    ({DatabaseSync} = require('node:sqlite'));  /// node:sqlite có sẵn từ Node.js 22.5 (dự án dùng Node 24) → không cần cài gói npm hay máy chủ CSDL.
  } catch (e) {  /// Node quá cũ →
    return disabledStore(file, 'Node.js chua ho tro node:sqlite (can Node 22.5+): ' + e.message);  /// trả về CSDL tắt kèm lý do.
  }
  let db;
  try {
    fs.mkdirSync(path.dirname(file), {recursive: true});  /// Tạo thư mục data/ nếu chưa có.
    db = new DatabaseSync(file);  /// Mở file .sqlite (chưa có thì tạo mới).
    /// Tạo cấu trúc CSDL nếu chưa có (chạy lại nhiều lần không sao nhờ IF NOT EXISTS):
    db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS telemetry_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL, ts_ms INTEGER NOT NULL,
        device TEXT, uptime_ms INTEGER, zone_id INTEGER NOT NULL,
        pir INTEGER NOT NULL, motion INTEGER NOT NULL, led INTEGER NOT NULL,
        mode TEXT NOT NULL, on_ms INTEGER, timeout_ms INTEGER);
      CREATE INDEX IF NOT EXISTS idx_telemetry_time ON telemetry_log(ts_ms);
      CREATE INDEX IF NOT EXISTS idx_telemetry_zone_time ON telemetry_log(zone_id, ts_ms);
      CREATE TABLE IF NOT EXISTS event_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL, ts_ms INTEGER NOT NULL,
        type TEXT NOT NULL, code TEXT, zone_id INTEGER,
        command TEXT, cmd_id TEXT, result TEXT, reason TEXT, source TEXT,
        detail TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_event_time ON event_log(ts_ms);
      CREATE INDEX IF NOT EXISTS idx_event_type_time ON event_log(type, ts_ms);`);  /// WAL: ghi nhanh, cho phép mở file bằng DB Browser trong lúc Node-RED đang ghi; chỉ mục theo thời gian và theo vùng/loại để truy vấn nhanh.
  } catch (e) {  /// Không mở được (đường dẫn sai, file bị khóa...) →
    try { db?.close(); } catch {}  /// đóng nếu đã mở dở,
    return disabledStore(file, 'Khong mo duoc CSDL: ' + e.message);  /// trả về CSDL tắt kèm lý do.
  }
  /// Câu lệnh chuẩn bị sẵn (prepared statement) để ghi 1 dòng trạng thái vùng:
  const insertTelemetry = db.prepare(`INSERT INTO telemetry_log
    (ts, ts_ms, device, uptime_ms, zone_id, pir, motion, led, mode, on_ms, timeout_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);  /// 11 dấu ? = 11 tham số → dữ liệu không bao giờ được ghép thẳng vào câu SQL (chống SQL injection).
  /// Câu lệnh ghi 1 sự kiện:
  const insertEvent = db.prepare(`INSERT INTO event_log
    (ts, ts_ms, type, code, zone_id, command, cmd_id, result, reason, source, detail)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);  /// 11 tham số.
  const counts = {  /// Bộ đếm số dòng, lấy từ CSDL lúc mở (để dashboard hiển thị không cần COUNT mỗi giây):
    telemetry: Number(db.prepare('SELECT COUNT(*) AS n FROM telemetry_log').get().n),  /// số dòng trạng thái,
    events: Number(db.prepare('SELECT COUNT(*) AS n FROM event_log').get().n)  /// số sự kiện.
  };
  let lastSavedAt = null, lastSignature = '', lastError = null, lastWriteAt = null;  /// Lần lưu trạng thái gần nhất, 'chữ ký' trạng thái đó, lỗi gần nhất, lần ghi gần nhất.

  // Ghi khi trang thai vung doi, hoac it nhat moi sampleMs (mac dinh 10 giay) de co du lieu theo thoi gian.
  function saveTelemetry(p, at = now()) {  /// Lưu trạng thái 3 vùng từ một bản tin telemetry.
    if (!p || !Array.isArray(p.zones) || p.zones.length === 0) return false;  /// Bản tin không có vùng nào → bỏ qua.
    const signature = JSON.stringify([p.device, p.timeout_ms,  /// 'Chữ ký' trạng thái: thiết bị, thời gian giữ
      p.zones.map(z => [z.id, z.pir, z.motion, z.led, z.mode])]);  /// và (id, pir, motion, led, mode) của từng vùng – KHÔNG gồm on_ms vì on_ms tăng mỗi heartbeat.
    if (signature === lastSignature && lastSavedAt !== null && at - lastSavedAt < sampleMs) return false;  /// Trạng thái không đổi và chưa đủ 10 s kể từ lần lưu trước → không lưu (tránh CSDL phình to vô ích).
    const ts = new Date(at).toISOString();  /// Thời gian ISO (UTC) dùng chung cho 3 dòng.
    db.exec('BEGIN');  /// Giao dịch: 3 dòng của cùng một thời điểm được ghi trọn vẹn hoặc không ghi gì.
    try {
      for (const z of p.zones) {  /// Mỗi vùng một dòng:
        insertTelemetry.run(ts, at, textOrNull(p.device), intOrNull(p.uptime_ms), Number(z.id),  /// thời gian, ms, thiết bị, uptime, số vùng,
          bit(z.pir), bit(z.motion), bit(z.led), String(z.mode), intOrNull(z.on_ms), intOrNull(p.timeout_ms));  /// pir, motion, led (0/1), chế độ, thời gian sáng, thời gian giữ.
      }
      db.exec('COMMIT');  /// Xác nhận giao dịch.
    } catch (e) {  /// Lỗi giữa chừng →
      db.exec('ROLLBACK');  /// hoàn tác,
      lastError = e.message;  /// nhớ lỗi để hiển thị,
      throw e;  /// báo lỗi cho Function node db-telemetry.
    }
    counts.telemetry += p.zones.length;  /// Tăng bộ đếm.
    lastSavedAt = at; lastSignature = signature; lastWriteAt = at; lastError = null;  /// Ghi nhớ lần lưu này.
    return true;  /// Đã lưu.
  }
  /// ▲ saveTelemetry(): ghi khi trạng thái đổi hoặc ít nhất mỗi 10 s; 3 vùng ghi trong 1 giao dịch.

  // record = {time, topic, event} giong dong trong events.jsonl.
  function saveEvent(record, at = now()) {  /// Lưu một sự kiện; record có dạng giống một dòng events.jsonl.
    const event = record && typeof record.event === 'object' && record.event ? record.event : null;  /// Lấy phần event (phải là đối tượng),
    if (!event || typeof event.type !== 'string') return false;  /// phải có trường type.
    const parsed = Date.parse(record.time);  /// Thời gian của dòng nhật ký,
    const ms = Number.isFinite(parsed) ? parsed : at;  /// nếu hỏng thì dùng thời điểm hiện tại.
    insertEvent.run(new Date(ms).toISOString(), ms, event.type, textOrNull(event.code),  /// Ghi: thời gian, ms, loại, mã cảnh báo,
      Number.isInteger(event.zone) ? event.zone : null, textOrNull(event.command), textOrNull(event.id),  /// vùng, lệnh, ID lệnh,
      textOrNull(event.result), textOrNull(event.reason), textOrNull(event.source), JSON.stringify(event));  /// kết quả, lý do, nguồn (dashboard/telegram/automation) và toàn bộ JSON gốc ở cột detail.
    counts.events += 1; lastWriteAt = at; lastError = null;  /// Tăng bộ đếm.
    return true;  /// Đã lưu.
  }
  /// ▲ saveEvent(): mỗi lệnh, ACK, cảnh báo, phục hồi, rule... thành 1 dòng event_log.

  function range({from, to}) {  /// Chuẩn hóa khoảng thời gian truy vấn:
    const end = Number.isFinite(to) ? to : now();  /// mặc định tới hiện tại,
    const begin = Number.isFinite(from) ? from : end - 24 * 3600000;  /// mặc định 24 giờ trước đó.
    return [begin, end];
  }
  const clampLimit = limit => Math.max(1, Math.min(2000, Number.isInteger(limit) ? limit : 200));  /// Giới hạn số dòng trả về trong 1–2000, mặc định 200.

  function queryTelemetry({from, to, zone, limit} = {}) {  /// Truy vấn trạng thái vùng theo khoảng thời gian, lọc vùng (tuỳ chọn).
    const [begin, end] = range({from, to});  /// Khoảng thời gian.
    const zoneFilter = Number.isInteger(zone) ? ' AND zone_id = ?' : '';  /// Có lọc vùng thì thêm điều kiện (vẫn dùng tham số ?).
    const params = [begin, end, ...(zoneFilter ? [zone] : []), clampLimit(limit)];  /// Tham số theo đúng thứ tự dấu ?.
    return db.prepare(`SELECT id, ts, ts_ms, device, uptime_ms, zone_id, pir, motion, led, mode, on_ms, timeout_ms
      FROM telemetry_log WHERE ts_ms BETWEEN ? AND ?${zoneFilter} ORDER BY ts_ms DESC, zone_id LIMIT ?`)  /// Mới nhất trước; dùng chỉ mục ts_ms.
      .all(...params).map(r => ({...r, ts_vn: vnTime(r.ts_ms)}));  /// Thêm cột giờ Việt Nam cho dashboard và CSV.
  }

  function queryEvents({from, to, type, zone, limit} = {}) {  /// Truy vấn sự kiện, lọc theo loại và vùng (tuỳ chọn).
    const [begin, end] = range({from, to});  /// Khoảng thời gian.
    let where = 'ts_ms BETWEEN ? AND ?';  /// Điều kiện cơ bản.
    const params = [begin, end];  /// Tham số tương ứng.
    if (typeof type === 'string' && type) { where += ' AND type = ?'; params.push(type); }  /// Lọc loại (alert, command...) – giá trị đi qua tham số, không ghép chuỗi.
    if (Number.isInteger(zone)) { where += ' AND zone_id = ?'; params.push(zone); }  /// Lọc vùng.
    params.push(clampLimit(limit));  /// Giới hạn số dòng.
    return db.prepare(`SELECT id, ts, ts_ms, type, code, zone_id, command, cmd_id, result, reason, source, detail
      FROM event_log WHERE ${where} ORDER BY ts_ms DESC, id DESC LIMIT ?`).all(...params)  /// Mới nhất trước.
      .map(r => ({...r, ts_vn: vnTime(r.ts_ms)}));  /// Thêm giờ Việt Nam.
  }
  /// ▲ queryTelemetry()/queryEvents(): truy vấn tham số hóa, giới hạn số dòng, mới nhất trước.

  // Tong thoi gian den sang moi vung theo ngay (gio Viet Nam), tinh tu cac mau trong telemetry_log.
  // Khoang cach giua 2 mau lon hon maxGap (mat ket noi) khong duoc tinh de tranh cong sai.
  function usageByDay({from, to, zone} = {}) {  /// Tính thời gian đèn sáng theo ngày cho từng vùng.
    const [begin, end] = range({from, to});  /// Khoảng thời gian.
    const maxGap = Math.max(3 * sampleMs, 30000);  /// Khoảng cách tối đa giữa 2 mẫu liên tiếp được tính (≥ 30 s); lớn hơn coi là mất kết nối, không cộng.
    const zoneFilter = Number.isInteger(zone) ? ' AND zone_id = ?' : '';  /// Lọc vùng (tuỳ chọn).
    /// Lấy các mẫu
    const rows = db.prepare(`SELECT ts_ms, zone_id, led FROM telemetry_log
      WHERE ts_ms BETWEEN ? AND ?${zoneFilter} ORDER BY zone_id, ts_ms`)  /// theo thứ tự vùng rồi thời gian,
      .all(begin, end, ...(zoneFilter ? [zone] : []));  /// truyền tham số.
    const result = new Map();  /// Kết quả theo khóa (ngày, vùng).
    const bucket = (day, zoneId) => {  /// Lấy hoặc tạo ô kết quả cho (ngày, vùng):
      const key = day + '#' + zoneId;  /// khóa,
      if (!result.has(key)) result.set(key, {day, zone_id: zoneId, on_seconds: 0, samples: 0});  /// tạo mới nếu chưa có,
      return result.get(key);  /// trả về ô.
    };
    for (let i = 0; i < rows.length; i++) {  /// Duyệt từng mẫu:
      const r = rows[i], next = rows[i + 1];  /// mẫu hiện tại và mẫu kế tiếp,
      const b = bucket(vnDay(r.ts_ms), r.zone_id);  /// ô của ngày (giờ VN) và vùng,
      b.samples += 1;  /// đếm số mẫu,
      if (r.led && next && next.zone_id === r.zone_id) {  /// đèn đang sáng và mẫu kế tiếp cùng vùng →
        const gap = next.ts_ms - r.ts_ms;  /// khoảng thời gian tới mẫu kế tiếp,
        if (gap > 0 && gap <= maxGap) b.on_seconds += gap / 1000;  /// chỉ cộng nếu không vượt maxGap.
      }
    }
    return [...result.values()]  /// Kết quả:
      .map(b => ({...b, on_seconds: Math.round(b.on_seconds)}))  /// làm tròn giây,
      .sort((a, b) => (a.day === b.day ? a.zone_id - b.zone_id : a.day < b.day ? 1 : -1));  /// sắp xếp ngày mới nhất trước, trong ngày theo vùng.
  }
  /// ▲ usageByDay(): cộng thời gian giữa các mẫu khi đèn sáng; bỏ qua khoảng mất kết nối để không cộng sai.

  function stats() {  /// Thống kê cho dashboard và terminal:
    return {available: true, file, telemetry_rows: counts.telemetry, event_rows: counts.events,  /// khả dụng, đường dẫn file, số dòng trạng thái, số sự kiện,
      sample_ms: sampleMs, last_write_at: lastWriteAt, last_error: lastError};  /// chu kỳ lưu, lần ghi gần nhất, lỗi gần nhất.
  }

  return {available: true, file, error: null, saveTelemetry, saveEvent, queryTelemetry, queryEvents,  /// Giao diện công khai của module
    usageByDay, stats, toCsv, close: () => db.close()};  /// (Function node chỉ dùng các hàm này qua global.get('dt45db')).
}
/// ▲ openStore(): toàn bộ thao tác CSDL nằm trong module này → muốn đổi sang MySQL/InfluxDB chỉ cần viết lại file này, không sửa flow.
///   Cấu trúc: telemetry_log(id, ts, ts_ms, device, uptime_ms, zone_id, pir, motion, led, mode, on_ms, timeout_ms)
///             event_log(id, ts, ts_ms, type, code, zone_id, command, cmd_id, result, reason, source, detail)

module.exports = {openStore, toCsv, vnTime};  /// Xuất ra để settings.js và test dùng.
