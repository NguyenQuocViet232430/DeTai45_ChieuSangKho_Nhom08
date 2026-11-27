const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const flowNodes = JSON.parse(fs.readFileSync(path.join(__dirname,'../node-red/flows.json'),'utf8'));
const byId = new Map(flowNodes.map(n => [n.id,n]));
let now = 100000, store, statuses, envValues;
class TestDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } }
const flow = {get:key=>store.get(key),set:(key,val)=>store.set(key,val)};
const node = {status:value=>statuses.push(value),warn:()=>{}};
const env = {get:key=>envValues[key]||''};
function reset(enabled=true) {
  now = 100000; store = new Map(); statuses=[];
  envValues={DT45_CONTROL_TOKEN:'test-control'};
  store.set('ruleEnabled',enabled);
}
function run(id,msg) {
  const n = byId.get(id);
  return new Function('msg','flow','node','env','Date',n.func)(msg,flow,node,env,TestDate);
}
function telemetry({motion=false,pir=0,led=true,mode='MANUAL',retained=false,uptime=now}={}) {
  const p={device:'test-dt45',uptime_ms:uptime,timeout_ms:10000,zones:[1,2,3].map(id=>({id,pir,motion,led,mode}))};
  return run('validate',{payload:p,retain:retained,topic:'test/telemetry'})[0];
}
function sample(ms,options) { now += ms; return run('rule',telemetry(options)); }
const tests=[
  ['slow Wokwi heartbeat (7s apart) keeps device online and lets the 30s idle rule fire',()=>{
    reset(); sample(0);
    for(let i=0;i<4;i++){ assert.equal(sample(7000),null); assert.equal(run('http-state',{req:{headers:{}}}).payload.online,true); }
    assert.equal(sample(7000)[0].payload,'AUTO');
  }],
  ['DT45_LIVE_WINDOW_MS overrides the live window; invalid values fall back to 15s',()=>{
    reset(); envValues.DT45_LIVE_WINDOW_MS='6000'; telemetry();
    now+=6001; assert.equal(run('command',{payload:'ON1'})[0],null);
    assert.equal(run('http-state',{req:{headers:{}}}).payload.live_window_ms,6000);
    for(const value of ['abc','1000','6.5']) {
      reset(); envValues.DT45_LIVE_WINDOW_MS=value; telemetry();
      now+=14000; assert.notEqual(run('command',{payload:'ON1'})[0],null);
      assert.equal(run('http-state',{req:{headers:{}}}).payload.live_window_ms,15000);
    }
  }],
  ['export uses built-in nodes and every wire/config resolves',()=>{
    assert.equal(byId.size,flowNodes.length);
    for(const n of flowNodes) {
      for(const wire of n.wires||[]) for(const id of wire) assert.ok(byId.has(id),id);
      if(n.broker && n.type!=='mqtt-broker') assert.ok(byId.has(n.broker));
      if(n.type==='inject' && !['watchdog-tick','telegram-tick'].includes(n.id)) assert.equal(n.once,false);
    }
    assert.equal(byId.get('dt45-emqx').broker,'broker.emqx.io');
    assert.equal(byId.get('mqtt-out').retain,'false');
    assert.equal(byId.get('file-log').filename,'filename');
    assert.equal(byId.get('file-log').filenameType,'msg');
  }],
  ['rule disabled by default and can be enabled/disabled',()=>{
    reset(false); assert.equal(sample(0),null);
    run('rule',{kind:'rule_config',payload:true}); assert.equal(flow.get('ruleEnabled'),true);
    run('rule',{kind:'rule_config',payload:false}); assert.equal(flow.get('ruleEnabled'),false);
  }],
  ['continuous idle triggers AUTO at 30s exactly, once per episode',()=>{
    reset(); assert.equal(sample(0),null);
    for(let i=0;i<14;i++) assert.equal(sample(2000),null);
    now+=1999; assert.equal(run('rule',telemetry()),null);
    const out=sample(1); assert.equal(out[0].payload,'AUTO');
    assert.equal(out[1].payload.type,'automation'); assert.equal(sample(2000),null);
    run('rule',telemetry({mode:'AUTO'})); assert.equal(flow.get('ruleFired'),false);
  }],
  ['raw PIR and validated motion both reset idle countdown',()=>{
    for(const presence of [{pir:1},{motion:true}]) {
      reset(); sample(0); for(let i=0;i<14;i++) sample(2000);
      assert.equal(sample(2000,presence),null); assert.equal(flow.get('ruleBegin'),null);
      assert.equal(sample(2000),null); assert.equal(flow.get('ruleBegin'),now);
    }
  }],
  ['manual OFF and AUTO zones never trigger the release rule',()=>{
    for(const options of [{led:false},{mode:'AUTO'}]) {
      reset(); for(let i=0;i<20;i++) assert.equal(sample(2000,options),null);
    }
  }],
  ['retained telemetry cannot mark online, trigger rule or permit commands',()=>{
    reset(); assert.equal(sample(0,{retained:true}),null);
    assert.equal(flow.get('lastTelemetryAt'),undefined);
    assert.equal(run('command',{payload:'ALL_ON'})[0],null);
  }],
  ['missing heartbeat, device reboot and offline reset the idle period',()=>{
    for(const condition of ['gap','reboot','offline']) {
      reset(); sample(0); for(let i=0;i<14;i++) sample(2000);
      if(condition==='gap') assert.equal(sample(15001),null);
      if(condition==='reboot') assert.equal(sample(2000,{uptime:0}),null);
      if(condition==='offline') {run('status',{payload:'offline'}); assert.equal(flow.get('ruleBegin'),null); assert.equal(sample(2000),null);}
      assert.equal(flow.get('ruleBegin'),now);
    }
  }],
  ['validator rejects malformed schema and duplicate/missing zone IDs',()=>{
    for(const payload of [null,{}, {zones:{map:'bad'}}, {device:'x',uptime_ms:0,zones:[{id:1},{id:1},{id:3}]}]) {
      reset(); const out=run('validate',{payload}); assert.equal(out[0],null); assert.equal(out[1].payload.type,'validation_error');
    }
  }],
  ['command gate validates command, live heartbeat, QoS and retain',()=>{
    reset(); telemetry();
    let out=run('command',{payload:' off2 '}); assert.match(out[0].payload,/^CMD\|[\w-]+\|OFF2$/);
    assert.equal(out[0].qos,1); assert.equal(out[0].retain,false);
    assert.equal(out[0].topic,byId.get('telemetry').topic.replace('/telemetry','/command/all'));
    assert.equal(run('command',{payload:'ON4'})[0],null);
    now+=15001; assert.equal(run('command',{payload:'AUTO'})[0],null);
  }],
  ['invalid telemetry blocks manual and automatic commands until valid live recovery',()=>{
    reset(); telemetry(); run('rule',telemetry());
    const req={headers:{'x-dt45-token':'test-control'}};
    assert.equal(run('http-state',{req}).payload.control_allowed,true);
    run('validate',{payload:null,retain:false});
    assert.equal(flow.get('ruleBegin'),null);
    assert.equal(run('http-state',{req}).payload.control_allowed,false);
    for(const automatic of [false,true]) {
      const out=run('command',{req,payload:'ALL_ON',automatic});
      assert.equal(out[0],null); assert.equal(out[2].statusCode,409);
      assert.equal(out[2].payload.reason,'invalid_telemetry');
    }
    assert.equal(flow.get('commands'),undefined);
    telemetry({retained:true});
    assert.equal(run('http-state',{req}).payload.control_allowed,false);
    now+=1000; telemetry();
    assert.equal(run('http-state',{req}).payload.control_allowed,true);
    assert.equal(run('command',{req,payload:'ON1'})[2].statusCode,202);
  }],
  ['JSON syntax errors enter validation through a parser-scoped catch',()=>{
    const catcher=byId.get('catch-telemetry-json');
    assert.equal(catcher.type,'catch'); assert.deepEqual(catcher.scope,['parse']);
    assert.deepEqual(catcher.wires,[['validate']]);
    reset(); telemetry();
    const rejected=run('validate',{payload:'{not json',error:{source:{id:'parse'}}});
    assert.equal(rejected[0],null); assert.equal(rejected[1].payload.type,'validation_error');
    assert.equal(run('http-state',{}).payload.control_allowed,false);
  }],
  ['dashboard commands stay disabled for malformed data and unlock after recovery',()=>{
    const html=byId.get('dashboard-html').template;
    const start=html.indexOf('function setControls(){'),end=html.indexOf('\nfunction eventText',start);
    const update=new Function('state','document','$','busy','backendError','reasons',html.slice(start,end)+';setControls();');
    const buttons=[{},{}],elements={};
    const element=id=>elements[id]??=({classList:{toggle(){}}});
    const document={querySelectorAll:()=>buttons};
    const state={role:'operator',online:true,invalid_telemetry:true,control_allowed:false};
    update(state,document,element,false,false,{invalid_telemetry:'Invalid sample'});
    assert.ok(buttons.every(b=>b.disabled)); assert.equal(element('access-note').textContent,'Invalid sample');
    state.invalid_telemetry=false;state.control_allowed=true;
    update(state,document,element,false,false,{});assert.ok(buttons.every(b=>!b.disabled));
    state.role='viewer';update(state,document,element,false,false,{});assert.ok(buttons.every(b=>b.disabled));
  }],
  ['history emits valid JSONL with timestamp, ack and filename',()=>{
    reset(); const out=run('history',{payload:'{"type":"command","result":"OK"}'});
    const record=JSON.parse(out.payload); assert.equal(record.event.result,'OK');
    assert.ok(record.time.endsWith('Z')); assert.equal(out.filename,'node-red/logs/events.jsonl');
    for(const payload of ['null','42','[]','"text"']) {
      const normalized=JSON.parse(run('history',{payload}).payload).event;
      assert.equal(normalized.type,'message');
    }
  }],
  ['HTTP control requires server token while viewer can read state',()=>{
    reset(); telemetry();
    assert.equal(run('http-state',{req:{headers:{}}}).payload.role,'viewer');
    assert.equal(run('http-auth',{req:{url:'/dt45/api/command',headers:{}},payload:{command:'ALL_ON'}})[2].statusCode,403);
    assert.equal(run('http-auth',{req:{url:'/dt45/api/command',headers:{'x-dt45-token':'wrong'}},payload:{command:'ALL_ON'}})[2].statusCode,403);
    const req={url:'/dt45/api/command',headers:{'x-dt45-token':'test-control'}};
    const authenticated=run('http-auth',{req,payload:{command:'ON1'}})[0];
    const out=run('command',authenticated); assert.equal(out[2].statusCode,202);
    assert.equal(out[2].req,req); assert.equal(out[1].payload.source,'dashboard');
    assert.equal(run('http-state',{req}).payload.role,'operator');
    assert.ok(!JSON.stringify(run('http-state',{req}).payload).includes('test-control'));
    envValues={}; assert.equal(run('http-auth',{req,payload:{command:'ON1'}})[2].statusCode,503);
  }],
  ['HTTP bad body/command and offline return errors without publishing',()=>{
    reset(); const req={url:'/dt45/api/command',headers:{'x-dt45-token':'test-control'}};
    assert.equal(run('http-auth',{req,payload:'ON1'})[2].statusCode,400);
    const out=run('command',run('http-auth',{req,payload:{command:'ON1'}})[0]);
    assert.equal(out[0],null); assert.equal(out[2].statusCode,409);
    assert.equal(flow.get('commands'),undefined);
    telemetry(); assert.equal(run('command',{req,payload:'ON4'})[2].statusCode,400);
  }],
  ['ACK matches command ID and command, handles rejection and out of order replies',()=>{
    reset(); telemetry();
    const a=run('command',{payload:'ON1'})[1].payload,b=run('command',{payload:'OFF2'})[1].payload;
    run('history',{payload:{type:'command',id:a.id,command:'OFF2',result:'OK'}});
    assert.equal(flow.get('commands')[0].status,'waiting');
    run('history',{payload:{type:'command',id:'unknown',command:'ON1',result:'OK'}});
    assert.equal(flow.get('commands')[0].status,'waiting');
    run('history',{payload:{type:'command',id:b.id,command:'OFF2',result:'OK'}});
    assert.equal(flow.get('commands')[1].status,'acknowledged');
    run('history',{payload:{type:'command',id:a.id,command:'',result:'ERROR',reason:'unknown_command'}});
    assert.equal(flow.get('commands')[0].status,'rejected');
  }],
  ['watchdog alerts once after 15s silence and recovers on new live telemetry',()=>{
    reset(); assert.equal(run('monitor',{}),null); telemetry(); run('monitor',{});
    now+=15000; assert.equal(run('monitor',{}),null); now+=1;
    const events=run('monitor',{}); assert.equal(events[0][0].payload.code,'DEVICE_OFFLINE');
    assert.equal(flow.get('deviceOnline'),false); assert.equal(run('monitor',{}),null);
    assert.equal(run('command',{payload:'ON1'})[0],null);
    telemetry(); assert.equal(run('monitor',{})[0][0].payload.code,'DEVICE_ONLINE');
  }],
  ['command is waiting until matching ACK; timeout at 12s does not imply actuation',()=>{
    reset(); telemetry(); run('monitor',{});
    const command=run('command',{payload:'ON3'})[1].payload;
    now+=11999; telemetry(); run('monitor',{}); assert.equal(flow.get('commands')[0].status,'waiting');
    now+=1; const out=run('monitor',{}); assert.ok(out[0].some(e=>e.payload.code==='COMMAND_TIMEOUT'));
    assert.equal(flow.get('commands')[0].status,'timeout'); assert.equal(run('monitor',{}),null);
    run('history',{payload:{type:'command',id:command.id,command:'ON3',result:'OK'}});
    assert.equal(flow.get('commands')[0].status,'acknowledged');
  }],
  ['operator can configure idle threshold; invalid values are rejected',()=>{
    reset(); const req={url:'/dt45/api/rule',headers:{'x-dt45-token':'test-control'}};
    const cfg=run('http-auth',{req,payload:{enabled:true,idle_seconds:15}})[1];
    assert.equal(run('rule',cfg)[2].statusCode,200);
    assert.equal(sample(0),null); for(let i=0;i<7;i++) assert.equal(sample(2000),null);
    assert.equal(sample(1000)[0].payload,'AUTO');
    for(const value of [14,301,30.5,'30']) assert.equal(run('http-auth',{req,payload:{enabled:true,idle_seconds:value}})[2].statusCode,400);
  }],
  ['retained data cannot overwrite displayed live state or permit controls',()=>{
    reset(); telemetry({led:false,mode:'AUTO'}); const lastAt=flow.get('lastTelemetryAt');
    now+=1; telemetry({retained:true,led:true});
    assert.equal(flow.get('telemetry').zones[0].led,false); assert.equal(flow.get('lastTelemetryAt'),lastAt);
    const snapshot=run('http-state',{req:{headers:{}}}).payload; assert.equal(snapshot.telemetry_source,'live');
    now+=15001; assert.equal(run('http-state',{req:{headers:{}}}).payload.online,false);
  }],
  ['continuous PIR HIGH alerts at threshold, once per episode, and LOW recovers',()=>{
    reset(); envValues.DT45_PIR_HIGH_MS='2000'; telemetry({pir:1}); run('monitor',{});
    now+=1999; telemetry({pir:1}); assert.equal(run('monitor',{}),null);
    now+=1; telemetry({pir:1});
    assert.equal(run('monitor',{})[0].filter(e=>e.payload.code==='PIR_HIGH_LONG').length,3);
    assert.equal(run('monitor',{}),null);
    assert.deepEqual(run('http-state',{req:{headers:{}}}).payload.sensor_alerts,[1,2,3]);
    telemetry({pir:0}); assert.equal(run('monitor',{})[0].filter(e=>e.payload.code==='PIR_HIGH_CLEARED').length,3);
  }],
  ['PIR alert never counts retained, missing data, reboot or malformed telemetry',()=>{
    for(const condition of ['gap','reboot','invalid']) {
      reset(); envValues.DT45_PIR_HIGH_MS='2000'; telemetry({pir:1}); run('monitor',{});
      now+=1000;
      if(condition==='gap')now+=15000;
      if(condition==='invalid')run('validate',{payload:null});
      telemetry({pir:1,uptime:condition==='reboot'?0:now});
      assert.equal(run('monitor',{}),null);
    }
    reset(); envValues.DT45_PIR_HIGH_MS='2000'; telemetry({pir:1,retained:true});
    now+=3000; assert.equal(run('monitor',{}),null);
  }],
  ['duplicate ACK preserves first measured RTT and cannot reverse completed result',()=>{
    reset(); telemetry(); const command=run('command',{payload:'ON1'})[1].payload;
    now+=125; run('history',{payload:{type:'command',id:command.id,command:'ON1',result:'OK'}});
    assert.equal(flow.get('commands')[0].rtt_ms,125);
    now+=500; run('history',{payload:{type:'command',id:command.id,command:'',result:'ERROR'}});
    assert.equal(flow.get('commands')[0].rtt_ms,125); assert.equal(flow.get('commands')[0].status,'acknowledged');
  }],
  ['runtime commands accept strict timeout bounds and optional pre-light',()=>{
    reset(); telemetry();
    for(const command of ['TIMEOUT=3','TIMEOUT=15','TIMEOUT=300','PRELIGHT_ON','PRELIGHT_OFF']) assert.ok(run('command',{payload:command})[0]);
    for(const command of ['TIMEOUT=2','TIMEOUT=301','TIMEOUT=15x','TIMEOUT=3.5','TIMEOUT=-3','TIMEOUT= 15','TIMEOUT=0003']) assert.equal(run('command',{payload:command})[0],null);
  }],
  ['usage validates complete counters and computes equal-power estimate without heartbeat log spam',()=>{
    reset(); telemetry(); const p={...flow.get('telemetry'),prelight_enabled:false,session_ms:10000};
    p.zones=p.zones.map((z,i)=>({...z,on_ms:i*5000}));
    assert.ok(run('validate',{payload:p})[0]);
    const s=run('http-state',{}).payload; assert.equal(s.usage.total_on_ms,15000); assert.equal(s.usage.saving_pct,50);
    const next={...p,uptime_ms:p.uptime_ms+2000,session_ms:12000,zones:p.zones.map(z=>({...z,on_ms:z.on_ms+1000}))};
    assert.equal(run('validate',{payload:next})[1],null);
    assert.ok(run('validate',{payload:{...next,prelight_enabled:true}})[1]);
    for(const bad of [{...p,session_ms:-1},{...p,session_ms:1},{...p,prelight_enabled:'false'},
      {...p,zones:p.zones.map((z,i)=>({...z,on_ms:i===1?undefined:z.on_ms}))},
      {...p,session_ms:Number.MAX_SAFE_INTEGER}]) assert.equal(run('validate',{payload:bad})[0],null);
    telemetry(); assert.equal(run('http-state',{}).payload.usage,null);
    assert.equal(run('validate',{payload:{...p,zones:[null,...p.zones.slice(1)]}})[0],null);
  }],
  ['usage at boot has no division by zero and retained usage never grants control',()=>{
    reset(); const p={...telemetry().payload,session_ms:0,zones:flow.get('telemetry').zones.map(z=>({...z,on_ms:0}))};
    reset(); run('validate',{payload:p,retain:true});
    const s=run('http-state',{}).payload; assert.equal(s.usage.saving_pct,null); assert.equal(s.control_allowed,false);
  }],
  ['alert settings require operator, validate time windows and never actuate',()=>{
    reset(); const req={url:'/dt45/api/alerts',headers:{'x-dt45-token':'test-control'}};
    const p={pir_high_seconds:5,manual_idle_seconds:15,shift_enabled:true,shift_start:'22:00',shift_end:'06:00'};
    assert.equal(run('http-auth',{req:{...req,headers:{}},payload:p})[2].statusCode,403);
    const authenticated=run('http-auth',{req,payload:p})[3];
    assert.equal(run('settings',authenticated)[1].statusCode,200);
    assert.deepEqual(run('http-state',{}).payload.alert_config,p); assert.equal(flow.get('commands'),undefined);
    for(const bad of [{...p,pir_high_seconds:4},{...p,pir_high_seconds:3601},{...p,manual_idle_seconds:14},
      {...p,shift_start:'24:00'},{...p,shift_end:'22:00'},{...p,shift_enabled:'true'}]) {
      assert.equal(run('settings',{req,payload:bad})[1].statusCode,400); assert.deepEqual(flow.get('alertConfig'),p);
    }
  }],
  ['manual light idle warning fires once, recovers and ignores disconnected time',()=>{
    reset(false); flow.set('alertConfig',{pir_high_seconds:120,manual_idle_seconds:15,shift_enabled:false,shift_start:'08:00',shift_end:'17:00'});
    telemetry(); run('monitor',{});
    for(let i=0;i<7;i++){now+=2000;telemetry();assert.equal(run('monitor',{}),null)}
    now+=1000;telemetry();assert.equal(run('monitor',{})[0][0].payload.code,'MANUAL_LIGHT_IDLE');
    assert.equal(run('monitor',{}),null); assert.equal((flow.get('commands')||[]).length,0);
    telemetry({motion:true,pir:1});assert.equal(run('monitor',{})[0][0].payload.code,'MANUAL_IDLE_CLEARED');
    telemetry();now+=16000;telemetry();assert.equal(run('monitor',{}),null);
    assert.equal(flow.get('manualIdleSince'),now);
  }],
  ['shift alarm uses Vietnam clock, overnight and exact start/end boundaries',()=>{
    for(const [start,end,clock,expected] of [
      ['08:00','17:00','07:59',true],['08:00','17:00','08:00',false],['08:00','17:00','17:00',true],
      ['22:00','06:00','23:30',false],['22:00','06:00','05:59',false],['22:00','06:00','06:00',true],['22:00','06:00','21:59',true]]) {
      reset(false);now=Date.parse('2026-10-16T'+clock+':00+07:00');
      flow.set('alertConfig',{pir_high_seconds:120,manual_idle_seconds:60,shift_enabled:true,shift_start:start,shift_end:end});
      telemetry({motion:true,pir:1,uptime:1000});const out=run('monitor',{});
      assert.equal(!!out?.[0].some(e=>e.payload.code==='AFTER_HOURS_MOTION'),expected,clock);
      assert.equal(run('monitor',{}),null);assert.equal((flow.get('commands')||[]).length,0);
      telemetry({uptime:1001}); const clear=run('monitor',{});
      assert.equal(!!clear?.[0].some(e=>e.payload.code==='AFTER_HOURS_CLEARED'),expected);
    }
  }],
  ['device identity change resets alert and automation timers even if uptime grows',()=>{
    reset();telemetry({pir:1});run('rule',telemetry());now+=2000;
    const p={...flow.get('telemetry'),device:'another-boot',uptime_ms:200000};
    run('validate',{payload:p}); assert.equal(flow.get('ruleBegin'),null); assert.equal(flow.get('manualIdleSince'),now);
  }],
  ['dashboard script parses and history/chart buffers remain bounded',()=>{
    reset();
    const html=byId.get('dashboard-html').template;
    new (require('node:vm').Script)(html.match(/<script>([\s\S]*?)<\/script>/)[1]);
    for(let i=0;i<110;i++){now++;telemetry();run('history',{payload:{type:'test',index:i}});}
    assert.equal(flow.get('journal').length,100); assert.equal(flow.get('samples').length,60);
    for(let i=0;i<25;i++)run('command',{payload:'ON1'});
    assert.equal(flow.get('commands').length,20);
  }]
];
let failures=0;
for(const [name,test] of tests) {
  try {test(); console.log('PASS '+name);} catch(e) {failures++; console.error('FAIL '+name+'\n'+e.stack);}
}
console.log(`${tests.length-failures}/${tests.length} passed`);
process.exitCode=failures ? 1 : 0;
