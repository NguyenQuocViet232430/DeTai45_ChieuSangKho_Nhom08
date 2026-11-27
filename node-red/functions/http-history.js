// GET /dt45/api/history?kind=telemetry|events|usage&hours=24&zone=1&type=alert&limit=200&format=csv
// Chi doc (nguoi xem cung xem duoc). Tra JSON cho dashboard hoac CSV de mo bang Excel.
const store = global.get("dt45db");  /// Đối tượng CSDL.
const json = (status,payload) => ({...msg,statusCode:status,  /// Tạo phản hồi JSON
  headers:{"Content-Type":"application/json","Cache-Control":"no-store"},payload});  /// không lưu cache.
if (!store || !store.available) {  /// CSDL không dùng được →
  return json(503,{ok:false,reason:"storage_unavailable",error:store ? store.error : "not_configured"});  /// HTTP 503 kèm lý do.
}
const q = (msg.req && msg.req.query) || {};  /// Tham số trên URL.
const kind = q.kind || "telemetry";  /// Loại dữ liệu: telemetry (mặc định), events hoặc usage.
const hours = q.hours === undefined ? 24 : Number(q.hours);  /// Khoảng thời gian (giờ), mặc định 24.
const zone = q.zone === undefined || q.zone === "" || q.zone === "all" ? null : Number(q.zone);  /// Vùng 1–3, hoặc null = tất cả.
const limit = q.limit === undefined ? 200 : Number(q.limit);  /// Số dòng tối đa, mặc định 200.
const type = q.type === undefined || q.type === "" ? undefined : String(q.type);  /// Lọc loại sự kiện (alert, command...).
if (!["telemetry","events","usage"].includes(kind) || !Number.isInteger(hours) || hours < 1 || hours > 720 ||  /// KIỂM TRA THAM SỐ: kind hợp lệ, hours 1–720 (30 ngày),
    (zone !== null && ![1,2,3].includes(zone)) || !Number.isInteger(limit) || limit < 1 || limit > 2000 ||  /// zone 1–3, limit 1–2000,
    (type !== undefined && !/^[a-z_]{1,32}$/.test(type)) || (q.format !== undefined && !["json","csv"].includes(q.format))) {  /// type chỉ gồm chữ thường và '_' (không thể chèn SQL), format json/csv.
  return json(400,{ok:false,reason:"invalid_history_query"});  /// Sai → HTTP 400.
}
const to = Date.now(), from = to - hours*3600000;  /// Khoảng thời gian truy vấn [from, to] tính bằng ms.
const options = {from,to,limit,type,zone:zone === null ? undefined : zone};  /// Tham số truyền cho store.
const COLUMNS = {  /// Cột của file CSV cho từng loại (tiêu đề không dấu để Excel nào cũng đọc được):
  telemetry:[["ts_vn","Gio Viet Nam"],["zone_id","Vung"],["pir","PIR"],["motion","Chuyen dong"],["led","Den"],  /// trạng thái vùng:
    ["mode","Che do"],["on_ms","Thoi gian sang (ms)"],["timeout_ms","Thoi gian giu (ms)"],["device","Thiet bi"],["uptime_ms","Uptime (ms)"]],
  events:[["ts_vn","Gio Viet Nam"],["type","Loai"],["code","Ma"],["zone_id","Vung"],["command","Lenh"],["cmd_id","ID lenh"],  /// sự kiện:
    ["result","Ket qua"],["reason","Ly do"],["source","Nguon"],["detail","Chi tiet JSON"]],
  usage:[["day","Ngay (gio VN)"],["zone_id","Vung"],["on_seconds","Thoi gian sang (giay)"],["samples","So mau"]]  /// thời gian sáng theo ngày.
};
let rows;
try {  /// Truy vấn CSDL bằng câu lệnh tham số hóa (prepared statement):
  rows = kind === "telemetry" ? store.queryTelemetry(options) :  /// trạng thái vùng,
    kind === "events" ? store.queryEvents(options) : store.usageByDay(options);  /// sự kiện, hoặc thời gian sáng theo ngày.
} catch (e) {
  return json(500,{ok:false,reason:"storage_error",error:e.message});  /// Lỗi CSDL → HTTP 500.
}
if (q.format === "csv") {  /// Yêu cầu CSV →
  const columns = COLUMNS[kind].map(([key,label]) => ({key,label}));  /// danh sách cột,
  return {...msg,statusCode:200,payload:store.toCsv(rows,columns),headers:{"Content-Type":"text/csv; charset=utf-8",  /// nội dung CSV (có BOM cho Excel),
    "Content-Disposition":`attachment; filename="nhom08-${kind}-${hours}h.csv"`,"Cache-Control":"no-store"}};  /// tải về với tên nhom08-<loại>-<giờ>h.csv.
}
return json(200,{ok:true,kind,hours,zone,from,to,count:rows.length,rows,storage:store.stats()});  /// JSON cho dashboard: số dòng, dữ liệu và thống kê CSDL.
/// ▲ http-history.js: GET /dt45/api/history – chỉ đọc nên người xem cũng dùng được; mọi tham số đều được kiểm tra trước khi truy vấn.
