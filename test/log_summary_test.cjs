const assert=require('node:assert/strict'),{summarize}=require('../tools/log_summary.cjs');
const record=(ms,event)=>({time:new Date(1700000000000+ms).toISOString(),event});
const sent=(id,command='ON1',ms=0)=>record(ms,{type:'command_sent',id,command});
const ack=(id,ms=100,command='ON1',result='OK')=>record(ms,{type:'command',id,command,result});
const tests=[
 ['first matching ACK and quantiles',()=>{const r=summarize([sent('a'),ack('a',100),ack('a',500),sent('b'),ack('b',200)]);assert.equal(r.acknowledged,2);assert.deepEqual(r.rtt_ms,{samples:2,min:100,p50:100,p95:200,max:200});}],
 ['unordered file preserves timestamps',()=>{assert.equal(summarize([ack('a',125),sent('a')]).rtt_ms.p50,125);}],
 ['wrong ID/command, legacy and missing ACK',()=>{const r=summarize([sent('a'),ack('b'),ack('a',100,'OFF1'),ack(''),record(1,null)]);assert.equal(r.no_matching_ack_in_file,1);assert.equal(r.legacy_acks,1);assert.equal(r.rtt_ms.samples,0);}],
 ['rejection separated from successful RTT',()=>{const r=summarize([sent('a'),ack('a',20,'','ERROR'),record(30,{type:'alert'})]);assert.equal(r.rejected,1);assert.equal(r.acknowledged,0);assert.equal(r.alerts,1);}],
 ['duplicate sends and earlier timestamp cannot inflate success',()=>{const r=summarize([sent('a','ON1',200),sent('a','ON1',210),ack('a',100),ack('a',230)]);assert.equal(r.commands_sent,1);assert.equal(r.rtt_ms.p50,30);}]
];
let failures=0;for(const [name,fn]of tests){try{fn();console.log('PASS '+name);}catch(e){failures++;console.error(e.stack);}}
console.log(`${tests.length-failures}/${tests.length} passed`);process.exitCode=failures?1:0;
