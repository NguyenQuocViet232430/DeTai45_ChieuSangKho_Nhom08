// Chay script dashboard trong DOM gia lap; kiem tra binding va request, khong thay QA trinh duyet.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const html=fs.readFileSync(path.join(__dirname,'../node-red/dashboard/index.html'),'utf8');
const elements=new Map(),requests=[];
function element(){return {value:'',checked:false,textContent:'',disabled:false,dataset:{},style:{},handlers:{},
  classList:{toggle(){},remove(){}},setAttribute(){},replaceChildren(){},appendChild(){},
  addEventListener(name,fn){this.handlers[name]=fn},querySelector(name){return this.children[name]??=(element())},children:{}}}
function get(id){if(!elements.has(id))elements.set(id,element());return elements.get(id)}
const buttons=['ALL_ON','ALL_OFF','AUTO','ON1','OFF1'].map(command=>{const b=element();b.dataset.command=command;return b});
let server={server_time:Date.now(),online:true,role:'viewer',invalid_telemetry:false,control_allowed:true,
  last_seen_at:Date.now(),age_ms:0,telemetry:{device:'test',uptime_ms:10000,timeout_ms:10000,prelight_enabled:false,
    zones:[1,2,3].map(id=>({id,pir:0,motion:false,led:false,mode:'AUTO',on_ms:0}))},
  rule:{enabled:false,idle_seconds:30,remaining_ms:null},alert_config:{pir_high_seconds:120,manual_idle_seconds:60,
    shift_enabled:false,shift_start:'08:00',shift_end:'17:00'},usage:{session_ms:10000,total_on_ms:0,saving_pct:100},
  commands:[],events:[],samples:[]};
const context=vm.createContext({console,Intl,Date,AbortController,setTimeout,clearTimeout,setInterval:()=>0,
  document:{getElementById:get,querySelectorAll:()=>buttons,activeElement:null,createElement:element},
  fetch:async(url,options={})=>{
    let result=structuredClone(server);
    if(options.method==='POST'){
      const body=JSON.parse(options.body);requests.push({url,body,headers:options.headers});
      if(url.endsWith('/command')){
        if(body.command.startsWith('TIMEOUT='))server.telemetry.timeout_ms=Number(body.command.slice(8))*1000;
        if(body.command.startsWith('PRELIGHT_'))server.telemetry.prelight_enabled=body.command==='PRELIGHT_ON';
        result={accepted:true,command:body.command,id:'ui-test'};
      }else if(url.endsWith('/alerts')){server.alert_config=body;result={accepted:true,...body}}
      else if(url.endsWith('/rule')){server.rule={...server.rule,...body};result={accepted:true,...body}}
    }
    return {ok:true,json:async()=>result};
  }});
function render(){context.testSnapshot=structuredClone(server);vm.runInContext('render(testSnapshot)',context)}
const change=(id,value)=>{get(id).value=value;get(id).handlers.input()};
const click=id=>get(id).handlers.click();
async function main(){
  vm.runInContext(html.match(/<script>([\s\S]*?)<\/script>/)[1],context);
  await new Promise(setImmediate);
  assert.equal(get('timeout-save').disabled,true);assert.equal(get('alerts-save').disabled,true);
  server.role='operator';render();assert.equal(get('timeout-save').disabled,false);
  server.online=false;render();assert.equal(get('timeout-save').disabled,true);assert.equal(get('alerts-save').disabled,false);
  server.online=true;delete server.telemetry.prelight_enabled;render();assert.equal(get('prelight-toggle').disabled,true);
  server.telemetry.prelight_enabled=false;render();
  console.log('PASS viewer, offline and older firmware gate device settings correctly');

  vm.runInContext("token='ui-test-control'",context);
  change('timeout-seconds','15');render();assert.equal(get('timeout-seconds').value,'15');
  await click('timeout-save');assert.equal(requests.at(-1).body.command,'TIMEOUT=15');
  assert.equal(requests.at(-1).headers['x-dt45-token'],'ui-test-control');
  assert.equal(get('hold-seconds').textContent,15);
  const before=requests.length;change('timeout-seconds','15x');await click('timeout-save');assert.equal(requests.length,before);
  console.log('PASS timeout draft survives polling, valid command is sent and bad input stays local');

  await click('prelight-toggle');assert.equal(requests.at(-1).body.command,'PRELIGHT_ON');
  assert.equal(get('prelight-state').textContent,'Pre-light: đang bật');
  await click('prelight-toggle');assert.equal(requests.at(-1).body.command,'PRELIGHT_OFF');
  console.log('PASS pre-light toggles use confirmed telemetry to select commands');

  change('pir-high-seconds','10');change('manual-idle-seconds','15');
  get('shift-enabled').checked=true;get('shift-enabled').handlers.input();
  change('shift-start','22:00');change('shift-end','06:00');render();
  assert.equal(get('pir-high-seconds').value,'10');assert.equal(get('shift-start').value,'22:00');
  await click('alerts-save');
  assert.deepEqual(requests.at(-1).body,{pir_high_seconds:10,manual_idle_seconds:15,shift_enabled:true,shift_start:'22:00',shift_end:'06:00'});
  assert.match(get('shift-summary').textContent,/22:00–06:00/);
  const count=requests.length;change('shift-end','22:00');await click('alerts-save');assert.equal(requests.length,count);
  assert.match(get('settings-feedback').textContent,/Giờ ca/);
  console.log('PASS alarm form preserves multi-field drafts and submits validated overnight shift');

  change('idle-seconds','15');render();assert.equal(get('idle-seconds').value,'15');
  await click('rule-toggle');assert.deepEqual(requests.at(-1).body,{enabled:true,idle_seconds:15});
  console.log('PASS idle automation retains an edited threshold and saves it');

  server.online=false;server.usage={session_ms:60000,total_on_ms:60000,saving_pct:100*2/3};render();
  assert.equal(get('saving-pct').textContent,'66.7%');assert.equal(get('usage-source').textContent,'Dữ liệu gần nhất');
  server.usage=null;render();assert.equal(get('saving-pct').textContent,'—');
  console.log('PASS estimated saving is formatted and offline/unsupported counters are labeled');
  console.log('6/6 passed');
}
main().catch(error=>{console.error(error.stack);process.exitCode=1});
