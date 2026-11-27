// Test Node-RED that + EMQX, voi device GIA LAP va prefix rieng. Khong test Wokwi.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const runtime=path.join(root,'.pio/node-red-runtime/node_modules');
const mqtt=require(path.join(runtime,'mqtt'));
const out=path.join(root,'.pio/mqtt-integration-'+Date.now()); fs.mkdirSync(out,{recursive:true});
const base='iot/nhom08/detai45/kho-c7e2',prefix=base+'/test-'+Date.now();
const nodes=JSON.parse(fs.readFileSync(path.join(root,'node-red/flows.json'),'utf8').replaceAll(base,prefix));
// Bat rule trong ban test rieng, giong bam Inject BAT rule.
nodes.find(n=>n.id==='enable-rule').once=true;
fs.writeFileSync(path.join(out,'flows.json'),JSON.stringify(nodes));
fs.writeFileSync(path.join(out,'settings.js'),'module.exports={uiHost:"127.0.0.1",uiPort:1881,mqttReconnectTime:1000};');
const logFile=path.join(out,'events.jsonl');
const proc=spawn(process.execPath,[path.join(runtime,'node-red/red.js'),'--userDir',out,'--settings',path.join(out,'settings.js'),path.join(out,'flows.json')],
  {cwd:root,windowsHide:true,env:{...process.env,DT45_LOG_FILE:logFile}});
let runtimeOutput='',client,interval;
proc.stdout.on('data',x=>runtimeOutput+=x); proc.stderr.on('data',x=>runtimeOutput+=x);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function test() {
  let ready=false;
  for(let i=0;i<250;i++) {
    if(proc.exitCode!=null) throw Error('Node-RED exited: '+runtimeOutput);
    try {const response=await fetch('http://127.0.0.1:1881/flows'); const flows=await response.json(); assert.equal(flows.length,nodes.length); ready=true; break;} catch {}
    await sleep(200);
  }
  assert.ok(ready,'Node-RED editor did not start');
  console.log('PASS Node-RED loads all '+nodes.length+' nodes');
  client=mqtt.connect('mqtt://broker.emqx.io:1883',{clientId:'dt45-test-'+Date.now(),protocolVersion:4,connectTimeout:15000,reconnectPeriod:0});
  await new Promise((resolve,reject)=>{client.once('connect',resolve);client.once('error',reject);});
  await new Promise((resolve,reject)=>client.subscribe(prefix+'/command/all',{qos:1},e=>e?reject(e):resolve()));
  console.log('PASS EMQX MQTT connection and subscription (isolated prefix)');
  const started=Date.now(); let automatic=false;
  function publishState() {
    const payload={device:'integration-mock',uptime_ms:Date.now()-started,timeout_ms:10000,
      zones:[1,2,3].map(id=>({id,pir:0,motion:false,led:true,mode:automatic?'AUTO':'MANUAL'}))};
    client.publish(prefix+'/telemetry',JSON.stringify(payload),{qos:0,retain:false});
  }
  const command=new Promise((resolve,reject)=> {
    const timeout=setTimeout(()=>reject(Error('No AUTO command after 48s')),48000);
    client.on('message',(topic,body,packet)=> {
      if(topic!==prefix+'/command/all') return;
      try {
        const match=body.toString().match(/^CMD\|([\w-]+)\|AUTO$/);
        assert.ok(match); assert.equal(packet.retain,false);
        automatic=true; publishState();
        client.publish(prefix+'/event',JSON.stringify({type:'command',result:'OK',id:match[1],command:'AUTO'}),{retain:false});
        clearTimeout(timeout); resolve();
      } catch(e) {clearTimeout(timeout); reject(e);}
    });
  });
  client.publish(prefix+'/status','online',{retain:false});
  publishState(); interval=setInterval(publishState,2000);
  await command;
  console.log('PASS LIVE telemetry -> idle rule 30s -> MQTT AUTO downlink');
  await sleep(700);
  const events=fs.readFileSync(logFile,'utf8').trim().split(/\r?\n/).map(s=>JSON.parse(s));
  assert.ok(events.some(e=>e.event.type==='automation'));
  assert.ok(events.some(e=>e.event.type==='command_sent'));
  assert.ok(events.some(e=>e.event.result==='OK'));
  console.log('PASS JSONL history contains automation, command and device ACK');
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({status:'PASS',device:'mock (not ESP32/Wokwi)',prefix,checks:4},null,2));
}
test().catch(e=>{console.error(e.stack);console.error(runtimeOutput.slice(-3000));process.exitCode=1;})
  .finally(async()=>{
    clearInterval(interval);
    if(client) await new Promise(resolve=>client.end(true,resolve));
    proc.kill(); fs.writeFileSync(path.join(out,'runtime.log'),runtimeOutput);
  });
