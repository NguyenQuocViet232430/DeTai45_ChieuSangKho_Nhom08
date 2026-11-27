// RTT tai Node-RED: command_sent -> ACK dau tien khop ID/command.
const fs=require('node:fs');  /// Đọc file nhật ký.
function summarize(records){  /// Tính thống kê từ danh sách dòng nhật ký.
  const commands=new Map(); let legacyAcks=0,alerts=0;  /// Lệnh đã gửi theo ID; đếm ACK kiểu cũ (không ID) và số cảnh báo.
  for(const record of records){  /// Lượt 1 – tìm các lệnh đã gửi:
    const e=record?.event,at=Date.parse(record?.time);  /// nội dung và thời điểm của dòng,
    if(!e||!Number.isFinite(at))continue;  /// dòng hỏng → bỏ qua,
    if(e.type==='command_sent'&&typeof e.id==='string'&&e.id&&!commands.has(e.id))  /// lệnh command_sent có ID, lấy lần gửi đầu tiên →
      commands.set(e.id,{id:e.id,command:e.command,sent:at,ack:null,result:null});  /// lưu: ID, lệnh, thời điểm gửi, chưa có ACK.
    if(e.type==='alert')alerts++;  /// Đếm cảnh báo.
    if(e.type==='command'&&!e.id)legacyAcks++;  /// Đếm ACK không có ID (lệnh gửi tay từ MQTTX).
  }
  for(const record of records){  /// Lượt 2 – ghép ACK với lệnh:
    const e=record?.event,at=Date.parse(record?.time),c=commands.get(e?.id);  /// dòng và lệnh có cùng ID,
    if(e?.type!=='command'||!c||!Number.isFinite(at)||at<c.sent||!['OK','ERROR'].includes(e.result))continue;  /// chỉ nhận ACK hợp lệ, đến sau lúc gửi, kết quả OK/ERROR,
    if(e.command!==c.command&&!(e.result==='ERROR'&&e.command===''))continue;  /// ACK phải đúng lệnh (hoặc lỗi không kèm lệnh),
    if(c.ack==null||at<c.ack){c.ack=at;c.result=e.result;}  /// giữ ACK SỚM NHẤT (ACK duplicate về sau không làm sai RTT).
  }
  const list=[...commands.values()],rtts=list.filter(c=>c.ack!=null&&c.result==='OK').map(c=>c.ack-c.sent).sort((a,b)=>a-b);  /// Danh sách lệnh và các RTT (ms) của lệnh OK, sắp xếp tăng dần.
  const percentile=p=>rtts.length?rtts[Math.max(0,Math.ceil(p*rtts.length)-1)]:null;  /// Phân vị theo phương pháp nearest-rank (p50 = trung vị, p95).
  return {commands_sent:list.length,acknowledged:list.filter(c=>c.result==='OK').length,rejected:list.filter(c=>c.result==='ERROR').length,  /// Kết quả: số lệnh gửi, được xác nhận, bị từ chối,
    no_matching_ack_in_file:list.filter(c=>c.ack==null).length,legacy_acks:legacyAcks,alerts,  /// không tìm thấy ACK trong file, ACK kiểu cũ, số cảnh báo,
    rtt_ms:{samples:rtts.length,min:rtts[0]??null,p50:percentile(.5),p95:percentile(.95),max:rtts.at(-1)??null},  /// RTT: số mẫu, nhỏ nhất, trung vị, P95, lớn nhất (số liệu 1,3 s / 9,7 s trong báo cáo),
    meaning:'Node-RED send to first matching OK ACK; not sensor latency or network packet-loss measurement.'};  /// ý nghĩa: thời gian từ Node-RED gửi tới ACK đầu tiên – không phải độ trễ cảm biến.
}
function readLog(file){  /// Đọc file JSONL:
  let malformed=0;const records=[];  /// đếm dòng hỏng,
  for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){  /// từng dòng,
    if(!line.trim())continue;try{records.push(JSON.parse(line));}catch{malformed++;}  /// bỏ dòng trống, đọc JSON, dòng hỏng thì đếm.
  }
  return {...summarize(records),malformed_lines:malformed};  /// Kết quả kèm số dòng hỏng.
}
module.exports={summarize,readLog};  /// Xuất hàm cho test.
if(require.main===module){  /// Chạy trực tiếp từ dòng lệnh:
  if(!process.argv[2]){console.error('Usage: node tools/log_summary.cjs events.jsonl [output.json]');process.exitCode=2;}  /// thiếu tên file → hướng dẫn cách dùng,
  else{const output=JSON.stringify(readLog(process.argv[2]),null,2)+'\n';if(process.argv[3])fs.writeFileSync(process.argv[3],output);console.log(output);}  /// in kết quả JSON (và ghi ra file nếu có tham số thứ 2).
}
/// ▲ log_summary.cjs: node .\tools\log_summary.cjs .\node-red\logs\events.jsonl → thống kê ACK và độ trễ lệnh.
