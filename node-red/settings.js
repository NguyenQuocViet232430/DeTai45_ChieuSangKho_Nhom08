const path = require('node:path');  /// Ghép đường dẫn file.
const {openStore} = require('./lib/dt45-store.cjs');  /// Module CSDL SQLite của nhóm.
const {createTelegram} = require('./lib/dt45-telegram.cjs');  /// Module Telegram bot của nhóm.

// CSDL lich su SQLite: mac dinh node-red/data/dt45.sqlite (doi bang DT45_DB_FILE).
const dbFile = process.env.DT45_DB_FILE || path.join(__dirname, 'data', 'dt45.sqlite');  /// File CSDL: biến DT45_DB_FILE (start.ps1 đặt), hoặc mặc định node-red/data/dt45.sqlite.
const sampleMs = Number(process.env.DT45_DB_SAMPLE_MS);  /// Chu kỳ lưu tối thiểu (tuỳ chọn).
// Telegram chi bat khi co DT45_TELEGRAM_TOKEN; chat duoc phep trong DT45_TELEGRAM_CHAT_ID.
const telegram = createTelegram({  /// Tạo bot Telegram từ biến môi trường:
  token: process.env.DT45_TELEGRAM_TOKEN,  /// token từ @BotFather (đặt trong telegram.local.ps1),
  chatIds: process.env.DT45_TELEGRAM_CHAT_ID,  /// danh sách chat được phép,
  apiBase: process.env.DT45_TELEGRAM_API || undefined  /// địa chỉ API (chỉ đổi khi test với máy chủ giả lập).
});

module.exports = {  /// Cấu hình của Node-RED:
  uiHost: '127.0.0.1',  /// chỉ nghe trên máy này (127.0.0.1) → máy khác trong mạng không mở được editor/dashboard.
  uiPort: 1880,  /// Cổng 1880.
  flowFilePretty: true,  /// flows.json được ghi có thụt lề, dễ đọc khi so sánh.
  mqttReconnectTime: 5000,  /// Mất broker thì thử lại sau 5 s.
  functionExternalModules: false,  /// Không cho Function node tự cài gói npm.
  functionGlobalContext: {  /// Đối tượng dùng chung cho mọi Function node qua global.get():
    dt45db: openStore(dbFile, {sampleMs: Number.isInteger(sampleMs) && sampleMs >= 1000 ? sampleMs : 10000}),  /// dt45db = CSDL SQLite, chu kỳ lưu tối thiểu 10 s (≥ 1 s nếu đặt bằng biến môi trường),
    dt45tg: telegram  /// dt45tg = Telegram bot (tắt nếu chưa có token).
  },
  logging: {console: {level: 'info', metrics: false, audit: false}}  /// Log mức info ra terminal.
};
/// ▲ settings.js: Node-RED nạp file này khi khởi động (start.ps1 truyền --settings). CSDL và bot được tạo MỘT lần tại đây.
