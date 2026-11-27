// Node-RED/API/dashboard + EMQX that, thiet bi GIA LAP; khong thay test Wokwi.
// --preview giu server /dashboard cho QA trinh duyet, Ctrl+C de dung.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),runtime=path.join(root,'.pio/node-red-runtime/node_modules');
const mqtt=require(path.join(runtime,'mqtt')),preview=process.argv.includes('--preview');
const out=path.join(root,'.pio/week68-'+Date.now());fs.mkdirSync(out,{recursive:true});
const base='iot/nhom08/detai45/kho-c7e2',prefix=base+'/e2e-'+Date.now(),control='demo-week68';
const nodes=JSON.parse(fs.readFileSync(path.join(root,'node-red/flows.json'),'utf8').replaceAll(base,prefix));
fs.writeFileSync(path.join(out,'flows.json'),JSON.stringify(nodes));
// CSDL SQLite rieng cho lan test + Telegram Bot API gia lap tai cong 18299 (khong goi Telegram that).
const http=require('node:http'),tgSent=[],tgQueue=[],tgPort=18299;let tgUpdateId=1;
const tgServer=http.createServer((req,res)=>{let body='';req.on('data',c=>body+=c);req.on('end',()=>{
  const method=req.url.split('/').pop(),data=body?JSON.parse(body):{};let result;
  if(!req.url.startsWith('/bote2e-token/')){res.writeHead(401);return res.end(JSON.stringify({ok:false,description:'Unauthorized'}));}
  if(method==='getUpdates')result=tgQueue.splice(0).filter(u=>u.update_id>=(data.offset||0));
  else if(method==='sendMessage'){tgSent.push(data);result={message_id:tgSent.length};}
  else{res.writeHead(404);return res.end(JSON.stringify({ok:false,description:'Not Found'}));}
  res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true,result}));});}).listen(tgPort,'127.0.0.1');
const lib=name=>JSON.stringify(path.join(root,'node-red/lib',name)),dbFile=path.join(out,'dt45.sqlite');
fs.writeFileSync(path.join(out,'settings.js'),`const {openStore}=require(${lib('dt45-store.cjs')});const {createTelegram}=require(${lib('dt45-telegram.cjs')});
module.exports={uiHost:"127.0.0.1",uiPort:1881,mqttReconnectTime:1000,functionGlobalContext:{dt45db:openStore(${JSON.stringify(dbFile)},{sampleMs:2000}),
dt45tg:createTelegram({token:"e2e-token",chatIds:"42",apiBase:"http://127.0.0.1:${tgPort}"})}};`);
const logFile=path.join(out,'events.jsonl');
const proc=spawn(process.execPath,[path.join(runtime,'node-red/red.js'),'--userDir',out,'--settings',path.join(out,'settings.js'),path.join(out,'flows.json')],
  {cwd:root,windowsHide:true,env:{...process.env,DT45_LOG_FILE:logFile,DT45_CONTROL_TOKEN:control,DT45_PIR_HIGH_MS:'2000',DT45_LIVE_WINDOW_MS:'6000'}});
let runtimeOutput='',client,timer,transmit=true,dropNextAck=false,checks=0;
proc.stdout.on('data',x=>runtimeOutput+=x);proc.stderr.on('data',x=>runtimeOutput+=x);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms)),url='http://127.0.0.1:1881';
const started=Date.now(),received=[],zones=[1,2,3].map(id=>({id,pir:0,motion:false,led:false,mode:'AUTO',on_ms:0,lastMotion:Date.now()}));
let timeoutMs=10000,prelight=false,usageAt=started;
function usage(){const at=Date.now(),delta=at-usageAt;usageAt=at;for(const z of zones)if(z.led)z.on_ms+=delta;}
function payload(){return {device:'test-device-gia-lap',uptime_ms:Date.now()-started,session_ms:usageAt-started,
  timeout_ms:timeoutMs,prelight_enabled:prelight,prelight_hold_ms:5000,zones:zones.map(({lastMotion,...z})=>z)};}
function publishState(){
  if(!transmit||!client?.connected)return;
  usage();
  for(const z of zones)if(z.mode==='AUTO'){if(z.motion){z.led=true;z.lastMotion=Date.now();}else if(Date.now()-z.lastMotion>=timeoutMs)z.led=false;}
  client.publish(prefix+'/telemetry',JSON.stringify(payload()),{retain:false});
}
function apply(command){
  usage();
  if(command==='AUTO')for(const z of zones){if(z.mode==='MANUAL'&&z.led)z.lastMotion=Date.now();z.mode='AUTO';}
  else if(['ALL_ON','ALL_OFF'].includes(command))for(const z of zones){z.mode='MANUAL';z.led=command==='ALL_ON';}
  else if(command.startsWith('TIMEOUT='))timeoutMs=Number(command.slice(8))*1000;
  else if(command.startsWith('PRELIGHT_'))prelight=command==='PRELIGHT_ON';
  else {const m=command.match(/^(ON|OFF)([123])$/);if(m){const z=zones[Number(m[2])-1];z.mode='MANUAL';z.led=m[1]==='ON';}}
}
async function read(operator=false){const r=await fetch(url+'/dt45/api/state',{headers:operator?{'x-dt45-token':control}:{}});return r.json();}
async function post(endpoint,body,operator=true){
  const r=await fetch(url+'/dt45/api/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(operator?{'x-dt45-token':control}:{})},body:JSON.stringify(body)});
  return {status:r.status,body:await r.json()};
}
async function until(predicate,timeout=8000){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){const s=await read();if(predicate(s))return s;await sleep(150);}
  throw Error('Timed out waiting for dashboard state');
}
function pass(name){checks++;console.log('PASS '+name);}
async function waitFor(predicate,timeout=8000,label='condition'){
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){if(predicate())return;await sleep(150);}
  throw Error('Timed out waiting for '+label);
}
async function main(){
  let ready=false;
  for(let i=0;i<250;i++){
    if(proc.exitCode!=null)throw Error('Node-RED exited');
    try{
      const r=await fetch(url+'/flows'),loaded=await r.json();
      assert.equal(loaded.length,nodes.length);
      assert.equal(loaded.find(n=>n.id==='telemetry')?.topic,prefix+'/telemetry');
      ready=true;break;
    }catch{}
    await sleep(200);
  }
  assert.ok(ready,'Node-RED did not start');
  const html=await fetch(url+'/dashboard');assert.equal(html.status,200);assert.match(await html.text(),/Điều khiển chiếu sáng kho/);
  pass(`Node-RED loads ${nodes.length} nodes and serves dashboard HTML`);
  assert.equal((await read()).role,'viewer');
  assert.equal((await post('command',{command:'ALL_ON'},false)).status,403);
  assert.equal((await post('command',{command:'ON1'})).status,409);
  pass('viewer cannot actuate; operator cannot send while device has no live data');
  client=mqtt.connect('mqtt://broker.emqx.io:1883',{clientId:'dt45-e2e-'+Date.now(),protocolVersion:4,connectTimeout:15000,reconnectPeriod:0});
  await new Promise((resolve,reject)=>{client.once('connect',resolve);client.once('error',reject);});
  await new Promise((resolve,reject)=>client.subscribe(prefix+'/command/all',{qos:1},e=>e?reject(e):resolve()));
  client.on('message',(topic,body,packet)=>{
    if(topic!==prefix+'/command/all')return;
    const match=body.toString().match(/^CMD\|([\w-]+)\|([\w=]+)$/);if(!match)return;
    received.push({id:match[1],command:match[2],retained:packet.retain});
    apply(match[2]);publishState();
    if(dropNextAck){dropNextAck=false;return;}
    client.publish(prefix+'/event',JSON.stringify({type:'command',result:'OK',id:match[1],command:match[2],uptime_ms:Date.now()-started}),{retain:false});
  });
  timer=setInterval(publishState,1000);
  client.publish(prefix+'/status','online',{retain:false});
  zones[1].pir=1;zones[1].motion=true;publishState();
  const uplink=await until(s=>s.online&&s.telemetry?.zones[1].motion);
  assert.equal(uplink.telemetry.zones[1].led,true);assert.equal(uplink.telemetry.zones[0].led,false);
  assert.equal((await read(true)).role,'operator');
  pass('MQTT sensor uplink reaches dashboard with correct zone, light and operator role');
  if(preview){
    console.log('PREVIEW '+url+'/dashboard (isolated mock device; control code: demo-week68)');
    await new Promise(resolve=>{process.once('SIGINT',resolve);process.once('SIGTERM',resolve);});
    return;
  }
  transmit=false;
  const beforeInvalid=received.length;
  client.publish(prefix+'/telemetry','{not json',{retain:false});
  await until(s=>s.invalid_telemetry&&!s.control_allowed);
  const blocked=await post('command',{command:'ALL_ON'});
  assert.equal(blocked.status,409);assert.equal(blocked.body.reason,'invalid_telemetry');
  assert.equal(received.length,beforeInvalid);
  transmit=true;publishState();
  await until(s=>s.online&&!s.invalid_telemetry&&s.control_allowed);
  pass('malformed MQTT JSON blocks downlink; valid live telemetry restores controls');
  await until(s=>s.sensor_alerts.includes(2)&&s.events.some(e=>e.event.code==='PIR_HIGH_LONG'));
  assert.equal(received.length,0,'PIR warning must not issue an automatic command');
  pass('long HIGH PIR produces visible warning; no forced OFF command');
  zones[1].pir=0;zones[1].motion=false;publishState();
  await until(s=>!s.sensor_alerts.includes(2)&&s.events.some(e=>e.event.code==='PIR_HIGH_CLEARED'));
  for(const [command,condition] of [
    ['TIMEOUT=3',s=>s.telemetry.timeout_ms===3000],['PRELIGHT_ON',s=>s.telemetry.prelight_enabled===true],
    ['PRELIGHT_OFF',s=>s.telemetry.prelight_enabled===false],['TIMEOUT=10',s=>s.telemetry.timeout_ms===10000]]) {
    const sent=await post('command',{command}); assert.equal(sent.status,202);
    await until(s=>condition(s)&&s.commands.some(c=>c.id===sent.body.id&&c.status==='acknowledged'));
  }
  assert.equal((await post('command',{command:'TIMEOUT=15x'})).status,400);
  const usageState=await read();assert.ok(usageState.usage.session_ms>0);assert.ok(usageState.usage.saving_pct>=0&&usageState.usage.saving_pct<=100);
  pass('runtime timeout/pre-light commands traverse MQTT and ACK; usage reaches API');
  const minute=Math.floor((Date.now()+7*3600000)/60000)%1440;
  const clock=m=>String(Math.floor((m%1440)/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
  const cfg={pir_high_seconds:120,manual_idle_seconds:15,shift_enabled:true,shift_start:clock(minute+60),shift_end:clock(minute+120)};
  assert.equal((await post('alerts',cfg,false)).status,403);
  assert.equal((await post('alerts',cfg)).status,200);
  zones[1].pir=1;zones[1].motion=true;publishState();
  await until(s=>s.incident_alerts.after_hours&&s.events.some(e=>e.event.code==='AFTER_HOURS_MOTION'));
  zones[1].pir=0;zones[1].motion=false;publishState();
  await until(s=>!s.incident_alerts.after_hours);
  await post('alerts',{...cfg,shift_enabled:false});
  pass('authorized shift settings produce after-hours warning and recovery without actuation');
  const sent=await post('command',{command:'ON1'});assert.equal(sent.status,202);
  const acknowledged=await until(s=>s.commands.some(c=>c.id===sent.body.id&&c.status==='acknowledged')&&s.telemetry.zones[0].led);
  assert.equal(acknowledged.telemetry.zones[0].mode,'MANUAL');
  assert.ok(acknowledged.commands.find(c=>c.id===sent.body.id).rtt_ms>=0);
  assert.ok(received.some(c=>c.id===sent.body.id&&c.command==='ON1'&&!c.retained));
  pass('dashboard POST -> MQTT command -> device ACK -> LED telemetry back to dashboard');
  tgQueue.push({update_id:tgUpdateId++,message:{chat:{id:42},text:'/on2'}},{update_id:tgUpdateId++,message:{chat:{id:99},text:'/alloff'}},
    {update_id:tgUpdateId++,message:{chat:{id:42},text:'/status'}});
  await until(s=>s.commands.some(c=>c.source==='telegram'&&c.command==='ON2'&&c.status==='acknowledged')&&s.telemetry.zones[1].led,15000);
  await waitFor(()=>tgSent.some(m=>m.chat_id==='42'&&/đã xác nhận ON2/.test(m.text))&&tgSent.some(m=>m.chat_id==='99'&&/chưa được cấp quyền/.test(m.text))&&
    tgSent.some(m=>m.chat_id==='42'&&/Vùng 2:/.test(m.text)),8000,'telegram replies');
  assert.ok(!received.some(c=>c.command==='ALL_OFF'),'unauthorized Telegram chat must not actuate');
  assert.equal((await read()).telegram.enabled,true);
  pass('Telegram /on2 (allowed chat) -> MQTT -> ACK reply; /status answers; unknown chat refused');
  const idleWarning=await until(s=>s.incident_alerts.manual_idle&&s.events.some(e=>e.event.code==='MANUAL_LIGHT_IDLE'),19000);
  assert.equal(idleWarning.telemetry.zones[0].mode,'MANUAL');assert.equal(idleWarning.telemetry.zones[0].led,true);
  pass('idle manual light warning does not force a light off');
  await post('command',{command:'ALL_ON'});
  assert.equal((await post('rule',{enabled:true,idle_seconds:15})).status,200);
  const automated=await until(s=>s.commands.some(c=>c.source==='automation'&&c.command==='AUTO'&&c.status==='acknowledged'),23000);
  assert.ok(automated.telemetry.zones.every(z=>z.mode==='AUTO'));
  pass('middleware idle rule at configured 15s returns AUTO; dashboard sees ACK and AUTO');
  await post('rule',{enabled:false,idle_seconds:30});
  dropNextAck=true;const unconfirmed=await post('command',{command:'OFF3'});
  const timeout=await until(s=>s.commands.some(c=>c.id===unconfirmed.body.id&&c.status==='timeout'),15000);
  assert.ok(timeout.events.some(e=>e.event.code==='COMMAND_TIMEOUT'));
  pass('missing ACK raises visible command timeout without declaring success');
  transmit=false;await until(s=>!s.online,8500);
  const before=received.length;assert.equal((await post('command',{command:'ALL_ON'})).status,409);assert.equal(received.length,before);
  await until(s=>s.events.some(e=>e.event.code==='DEVICE_OFFLINE'));
  pass('missing heartbeat raises offline alert and blocks downlink');
  await waitFor(()=>tgSent.some(m=>m.chat_id==='42'&&/Mất dữ liệu từ ESP32/.test(m.text)),6000,'telegram offline alert');
  pass('offline alert is pushed to the allowed Telegram chat');
  transmit=true;publishState();
  await until(s=>s.online&&s.events.some(e=>e.event.code==='DEVICE_ONLINE'));
  pass('new live telemetry restores device state and records recovery');
  await sleep(400);
  const events=fs.readFileSync(logFile,'utf8').trim().split(/\r?\n/).map(s=>JSON.parse(s));
  for(const type of ['automation','command_sent','command','alert','recovery'])assert.ok(events.some(e=>e.event.type===type),type);
  pass('persistent JSONL contains complete command, rule, failure and recovery history');
  const hist=await (await fetch(url+'/dt45/api/history?kind=telemetry&hours=1&zone=2&limit=2000')).json();
  assert.ok(hist.ok&&hist.count>0&&hist.rows.some(r=>r.led===1&&r.zone_id===2));
  const stored=await (await fetch(url+'/dt45/api/history?kind=events&hours=1&limit=2000')).json();
  for(const type of ['automation','command_sent','command','alert','recovery'])assert.ok(stored.rows.some(r=>r.type===type),'db '+type);
  assert.ok(stored.rows.some(r=>r.source==='telegram'),'telegram command stored');
  const csv=await fetch(url+'/dt45/api/history?kind=events&hours=1&format=csv');
  assert.match(csv.headers.get('content-type'),/text\/csv/);assert.match(await csv.text(),/Gio Viet Nam,Loai/);
  const usage=await (await fetch(url+'/dt45/api/history?kind=usage&hours=24')).json();assert.ok(usage.ok&&usage.rows.length>=3);
  assert.ok(fs.statSync(dbFile).size>0&&finalStorage(await read()));
  pass('SQLite history API returns stored zone states, events (JSON + CSV) and daily usage');
  const finalState=await read();
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({status:'PASS',checks,device:'mock, not Wokwi/ESP32',prefix,
    pir_test_threshold_ms:2000,production_pir_threshold_ms:120000,duration_ms:Date.now()-started,
    ack_rtt_ms:finalState.commands.filter(c=>c.status==='acknowledged').map(c=>c.rtt_ms)},null,2));
}
function finalStorage(s){return s.storage.available&&s.storage.telemetry_rows>0&&s.storage.event_rows>0;}
main().catch(e=>{console.error(e.stack);console.error(runtimeOutput.slice(-3000));process.exitCode=1;})
  .finally(async()=>{clearInterval(timer);if(client)await new Promise(resolve=>client.end(true,resolve));proc.kill();tgServer.close();fs.writeFileSync(path.join(out,'runtime.log'),runtimeOutput);});
