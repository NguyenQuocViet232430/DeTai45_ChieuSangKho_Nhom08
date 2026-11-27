// Tao export Node-RED tu cac Function node co source de doc/sua.
const fs = require('node:fs');  /// Đọc file source Function và giao diện HTML.
const path = require('node:path');  /// Ghép đường dẫn.
const prefix = 'iot/nhom08/detai45/kho-c7e2';  /// Tiền tố topic MQTT của nhóm (giống project_config.h).
const tab = 'dt45-week45', broker = 'dt45-emqx';  /// ID của tab flow và của cấu hình broker.
const nodes = [{id:tab,type:'tab',label:'DT45 - Nhom08 - He thong hoan chinh',disabled:false,  /// Danh sách node; node đầu tiên là tab 'DT45 - Nhom08 - He thong hoan chinh'
  info:'Du 4 tang: 3 PIR -> ESP32 -> MQTT -> Node-RED -> Web Dashboard /dashboard. Rule mac dinh TAT. Dashboard can ma dieu khien trong terminal. Watchdog bao offline/ACK timeout. Khong gui lenh khi Deploy.'}];  /// kèm mô tả tóm tắt hiển thị trong editor.
function add(id,type,name,x,y,props,wires=[]) {  /// Thêm một node bất kỳ: id, loại, tên, toạ độ x/y trên editor, thuộc tính riêng, dây nối ra.
  nodes.push({id,type,z:tab,name,x,y,...props,wires});  /// Mọi node nằm trong tab DT45.
}
function fn(id,name,x,y,outputs,wires,initialize='') {  /// Thêm một Function node: code đọc từ node-red/functions/<id>.js → source dễ đọc, dễ test, dễ sửa.
  add(id,'function',name,x,y,{func:fs.readFileSync(path.join(__dirname,'functions',id+'.js'),'utf8'),outputs,  /// Nội dung func là file .js tương ứng; outputs = số cổng ra.
    timeout:0,noerr:0,initialize,finalize:'',libs:[]},wires);  /// Không giới hạn thời gian chạy; không có thư viện ngoài.
}
add('intro','comment','1. Telemetry, trang thai, nhat ky',250,40,{info:'Debug hien trang thai that tu ESP32. File log: node-red/logs/events.jsonl (duong dan tuy bien qua DT45_LOG_FILE).'});  /// Ghi chú nhóm 1 trên editor.
add('telemetry','mqtt in','Nhan telemetry',140,100,{topic:prefix+'/telemetry',qos:'1',datatype:'utf8',broker,nl:false,rap:true,rh:0},[['parse']]);  /// MQTT in: nhận telemetry (QoS 1 khi subscribe), giữ cờ retain (rap) để validate phân biệt live/retained.
add('parse','json','JSON -> object',350,100,{property:'payload',action:'obj',pretty:false},[['validate']]);  /// Chuỗi JSON → đối tượng JavaScript.
// JSON sai cu phap phai khoa command va ghi log nhu schema sai.
// Chi bat loi node parse, tranh lap vo han neu node ghi file log bi loi.
add('catch-telemetry-json','catch','Telemetry JSON sai -> khoa lenh',350,145,{scope:['parse'],uncaught:false},[['validate']]);  /// Bắt lỗi JSON hỏng → vẫn chuyển cho validate để khóa lệnh.
fn('validate','Kiem tra + tong hop 3 vung',600,100,2,[['state-debug','rule','db-telemetry'],['history']]);  /// validate: cổng 1 → debug, rule, ghi CSDL; cổng 2 → nhật ký.
add('state-debug','debug','TRANG THAI 3 VUNG',900,60,{active:true,tosidebar:true,console:false,tostatus:false,complete:'payload',targetType:'msg'});  /// Debug: hiện trạng thái 3 vùng ở thanh bên phải.
add('status-in','mqtt in','Online / offline',140,180,{topic:prefix+'/status',qos:'1',datatype:'utf8',broker,nl:false,rap:true,rh:0},[['status']]);  /// MQTT in: topic status (online / LWT offline).
fn('status','Xu ly trang thai ket noi',600,180,1,[['history']]);  /// Xử lý online/offline → nhật ký.
add('event-in','mqtt in','Phan hoi lenh tu ESP32',140,240,{topic:prefix+'/event',qos:'1',datatype:'utf8',broker,nl:false,rap:true,rh:0},[['history']]);  /// MQTT in: topic event (ACK của ESP32) → nhật ký (history.js ghép ACK với lệnh).
add('rule-comment','comment','2. Rule: MANUAL ON + vang -> AUTO',350,320,{info:'Mac dinh TAT, 30s; dashboard cho doi 15-300s. Chi tinh voi telemetry LIVE, ca 3 PIR=0 va motion=false, co den MANUAL ON. AUTO dua CA 3 vung ve tu dong, ke ca vung MANUAL OFF. Gui 1 lan moi dot; device giu den dang sang theo timeout hien tai (mac dinh 10s).'});  /// Ghi chú nhóm 2: luật kho vắng.
fn('rule','Rule tiet kiem dien',900,180,3,[['command'],['history'],['api-response']],  /// rule: cổng 1 → command (AUTO), cổng 2 → nhật ký, cổng 3 → HTTP response.
  'flow.set("ruleEnabled", false); if (flow.get("ruleIdleSeconds") === undefined) flow.set("ruleIdleSeconds", 30); flow.set("ruleBegin", null); flow.set("ruleFired", false); flow.set("ruleLastAt", null); flow.set("ruleLastUptime", null);');  /// Khởi tạo khi Deploy/khởi động: rule TẮT, ngưỡng 30 s, xóa bộ đếm.
for (const [id,label,value,y] of [['enable-rule','BAT rule 30s',true,360],['disable-rule','TAT rule 30s',false,410]]) {  /// Hai nút Inject bật/tắt rule ngay trong editor:
  add(id,'inject',label,150,y,{props:[{p:'payload'},{p:'kind',v:'rule_config',vt:'str'},{p:'idleSeconds',v:'30',vt:'num'}],repeat:'',crontab:'',once:false,onceDelay:0.1,topic:'',payload:String(value),payloadType:'bool'},[['rule']]);  /// gửi {kind:'rule_config', payload:true/false, idleSeconds:30} vào rule.js.
}
add('command-comment','comment','3. Bam Inject de gui lenh (Retain=false)',390,480,{info:'Node kiem tra lenh, chi gui neu co telemetry LIVE trong thoi gian cho (mac dinh 15s, env DT45_LIVE_WINDOW_MS). MQTT out QoS 1, khong retained. Deploy KHONG tu gui lenh.'});  /// Ghi chú nhóm 3: gửi lệnh thử.
['ALL_ON','ALL_OFF','AUTO','ON1','OFF1','ON2','OFF2','ON3','OFF3'].forEach((value,i)=> {  /// 9 nút Inject gửi lệnh thử trực tiếp trong editor:
  add('send-'+value.toLowerCase(),'inject',value,150,530+i*45,  /// mỗi lệnh một nút,
    {props:[{p:'payload'},{p:'kind',v:'manual_command',vt:'str'}],repeat:'',crontab:'',once:false,onceDelay:0.1,topic:'',payload:value,payloadType:'str'},[['command']]);  /// đi vào command.js (cùng kiểm tra như dashboard). once:false → Deploy KHÔNG tự gửi lệnh.
});
fn('command','Kiem tra lenh / ma ACK',620,540,3,[['mqtt-out','command-debug'],['history'],['api-response']]);  /// command: cổng 1 → MQTT out + debug, cổng 2 → nhật ký, cổng 3 → HTTP response.
add('mqtt-out','mqtt out','Gui lenh xuong ESP32',950,510,{topic:'',qos:'1',retain:'false',respTopic:'',contentType:'',userProps:'',correl:'',expiry:'',broker});  /// MQTT out: gửi lệnh QoS 1, retain = false.
add('command-debug','debug','LENH DA GUI',960,580,{active:true,tosidebar:true,console:false,tostatus:false,complete:'true',targetType:'full'});  /// Debug: lệnh đã gửi.
fn('history','Dong log JSONL + timestamp',1210,280,1,[['file-log','log-debug','db-event','telegram-notify']]);  /// history: gom nhật ký → file JSONL, debug, CSDL, Telegram.
add('file-log','file','Luu lich su event',1480,240,{filename:'filename',filenameType:'msg',appendNewline:true,createDir:true,overwriteFile:'false',encoding:'utf8'});  /// Ghi nối tiếp vào file (tên file lấy từ msg.filename), tự tạo thư mục.
add('log-debug','debug','LICH SU / ACK / RULE',1480,310,{active:true,tosidebar:true,console:false,tostatus:false,complete:'payload',targetType:'msg'});  /// Debug: lịch sử / ACK / rule.
add('catch-errors','catch','Bat loi JSON / flow / file',1180,400,{scope:null,uncaught:false},[['error-debug']]);  /// Catch: bắt mọi lỗi trong flow,
add('error-debug','debug','LOI FLOW',1480,400,{active:true,tosidebar:true,console:false,tostatus:false,complete:'true',targetType:'full'});  /// hiện ra debug 'LỖI FLOW'.
add('application-comment','comment','4. Web Dashboard /dashboard + API phan quyen',390,1000,{info:'HTTP GET xem trang thai; POST command/rule can x-dt45-token dung. Token doc tu env DT45_CONTROL_TOKEN, khong nam trong export. Du lieu retained khong cho gui lenh.'});  /// Ghi chú nhóm 4: dashboard và API.
add('dashboard-page','http in','GET /dashboard',160,1060,{url:'/dashboard',method:'get',upload:false,swaggerDoc:''},[['dashboard-html']]);  /// HTTP GET /dashboard
add('dashboard-html','template','Giao dien kho 3 vung',480,1060,{field:'payload',fieldType:'msg',format:'html',syntax:'mustache',template:fs.readFileSync(path.join(__dirname,'dashboard/index.html'),'utf8'),output:'str'},[['dashboard-response']]);  /// → template trả về file dashboard/index.html,
add('dashboard-response','http response','HTML',790,1060,{statusCode:'',headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});  /// → HTTP response: HTML UTF-8, không cache, chặn đoán sai kiểu nội dung (nosniff).
add('api-state-in','http in','GET /dt45/api/state',160,1130,{url:'/dt45/api/state',method:'get',upload:false,swaggerDoc:''},[['http-state']]);  /// HTTP GET /dt45/api/state
fn('http-state','Snapshot dashboard',480,1130,1,[['api-response']]);  /// → http-state.js tạo ảnh chụp trạng thái.
add('api-command-in','http in','POST /dt45/api/command',160,1200,{url:'/dt45/api/command',method:'post',upload:false,swaggerDoc:''},[['http-auth']]);  /// HTTP POST /dt45/api/command
add('api-rule-in','http in','POST /dt45/api/rule',160,1270,{url:'/dt45/api/rule',method:'post',upload:false,swaggerDoc:''},[['http-auth']]);  /// HTTP POST /dt45/api/rule
add('api-alerts-in','http in','POST /dt45/api/alerts',160,1320,{url:'/dt45/api/alerts',method:'post',upload:false,swaggerDoc:''},[['http-auth']]);  /// HTTP POST /dt45/api/alerts → cả ba đi qua http-auth.js kiểm tra mã điều khiển.
fn('http-auth','Quyen xem / dieu khien',500,1220,4,[['command'],['rule'],['api-response'],['settings']]);  /// http-auth: cổng 1 → command, 2 → rule, 3 → lỗi HTTP, 4 → settings.
fn('settings','Cau hinh canh bao / ca lam viec',820,1290,2,[['history'],['api-response']]);  /// settings: lưu cấu hình cảnh báo → nhật ký + HTTP response.
add('api-response','http response','JSON response',820,1160,{statusCode:'',headers:{}});  /// Node HTTP response dùng chung cho mọi API JSON.
add('watchdog-tick','inject','Kiem tra live / ACK moi 1s',170,1370,{props:[{p:'payload'}],repeat:'1',crontab:'',once:true,onceDelay:0.5,topic:'',payload:'',payloadType:'date'},[['monitor']]);  /// Inject chạy mỗi 1 s ngay khi khởi động
fn('monitor','Canh bao offline / ACK 12s',510,1370,1,[['history']]);  /// → monitor.js kiểm tra mất dữ liệu, thiếu ACK, các cảnh báo → nhật ký.
add('storage-comment','comment','5. CSDL SQLite: lich su trang thai + su kien',1250,560,{info:'File node-red/data/dt45.sqlite (doi bang DT45_DB_FILE). Bang telemetry_log: trang thai tung vung, ghi khi doi hoac moi 10s (DT45_DB_SAMPLE_MS). Bang event_log: lenh, ACK, canh bao, phuc hoi, rule. Xem lai: GET /dt45/api/history?kind=telemetry|events|usage&hours=24&zone=1&format=csv.'});  /// Ghi chú nhóm 5: CSDL SQLite.
fn('db-telemetry','Ghi trang thai vao CSDL',900,130,0,[]);  /// Ghi trạng thái vùng vào CSDL (nhận từ validate).
fn('db-event','Ghi su kien vao CSDL',1480,360,0,[]);  /// Ghi sự kiện vào CSDL (nhận từ history).
add('api-history-in','http in','GET /dt45/api/history',160,1440,{url:'/dt45/api/history',method:'get',upload:false,swaggerDoc:''},[['http-history']]);  /// HTTP GET /dt45/api/history
fn('http-history','Truy van lich su (JSON/CSV)',500,1440,1,[['api-response']]);  /// → http-history.js truy vấn CSDL, trả JSON hoặc CSV.
add('telegram-comment','comment','6. Telegram Bot: canh bao + lenh /status /on1 /auto',1250,640,{info:'Bat khi co DT45_TELEGRAM_TOKEN (dat trong node-red/telegram.local.ps1). Chi chat trong DT45_TELEGRAM_CHAT_ID duoc dieu khien. Lenh Telegram di qua node command: van kiem tra live telemetry, tao ID va cho ACK nhu dashboard.'});  /// Ghi chú nhóm 6: Telegram.
add('telegram-tick','inject','Lay tin Telegram moi 3s',170,1510,{props:[{p:'payload'}],repeat:'3',crontab:'',once:true,onceDelay:2,topic:'',payload:'',payloadType:'date'},[['telegram-in']]);  /// Inject mỗi 3 s
fn('telegram-in','Nhan lenh Telegram',510,1510,2,[['command'],['history']]);  /// → telegram-in.js: cổng 1 → command, cổng 2 → nhật ký.
fn('telegram-notify','Gui canh bao Telegram',1480,430,0,[]);  /// Gửi cảnh báo Telegram (nhận từ history).
nodes.push({id:broker,type:'mqtt-broker',name:'EMQX - DT45',broker:'broker.emqx.io',port:'1883',clientid:'',autoConnect:true,  /// Cấu hình broker: broker.emqx.io:1883,
  usetls:false,protocolVersion:'4',keepalive:'15',cleansession:true,autoUnsubscribe:true,birthTopic:'',birthQos:'0',birthPayload:'',  /// không TLS, MQTT 3.1.1 (protocolVersion 4), keep-alive 15 s, clean session.
  birthMsg:{},closeTopic:'',closeQos:'0',closePayload:'',closeMsg:{},willTopic:'',willQos:'0',willPayload:'',willMsg:{},
  sessionExpiry:''});
fs.writeFileSync(path.join(__dirname,'flows.json'),JSON.stringify(nodes,null,2)+'\n');  /// Ghi flows.json (có thụt lề) để Node-RED nạp.
console.log('Created node-red/flows.json: '+nodes.length+' nodes');  /// In số node đã tạo (hiện là 56).
/// ▲ build-flow.cjs: chạy 'node .\node-red\build-flow.cjs' sau mỗi lần sửa Function hoặc HTML để tạo lại flows.json.
///   Nhờ vậy flow được quản lý như mã nguồn: test đọc thẳng flows.json, không cần sửa tay trong editor.
