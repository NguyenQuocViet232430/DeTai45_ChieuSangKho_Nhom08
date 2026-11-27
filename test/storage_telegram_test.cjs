// Kiem tra CSDL lich su SQLite va Telegram bot (khong can Internet: Telegram API duoc gia lap).
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {openStore, toCsv, vnTime} = require('../node-red/lib/dt45-store.cjs');
const {createTelegram, parseCommand} = require('../node-red/lib/dt45-telegram.cjs');
const flowNodes = JSON.parse(fs.readFileSync(path.join(__dirname, '../node-red/flows.json'), 'utf8'));
const byId = new Map(flowNodes.map(n => [n.id, n]));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dt45-db-'));
const T0 = Date.parse('2026-11-21T01:00:00Z'); // 08:00 gio Viet Nam
const telemetry = (leds = [false, false, false], extra = {}) => ({device: 'test-esp32', uptime_ms: 5000, timeout_ms: 10000,
  zones: [1, 2, 3].map((id, i) => ({id, pir: leds[i] ? 1 : 0, motion: leds[i], led: leds[i], mode: 'AUTO', on_ms: 0})), ...extra});

// Chay Function node trong moi truong gia lap co global context va node.send bat dong bo.
function harness({store = null, tg = null, now = T0, envValues = {}} = {}) {
  const ctx = new Map(), sent = [], statuses = [];
  let clock = now, doneResolve;
  const done = new Promise(r => (doneResolve = r));
  class TestDate extends Date { constructor(...a) { super(...(a.length ? a : [clock])); } static now() { return clock; } }
  const flow = {get: k => ctx.get(k), set: (k, v) => ctx.set(k, v)};
  const global = {get: k => ({dt45db: store, dt45tg: tg})[k]};
  const node = {status: s => statuses.push(s), warn: () => {}, send: m => sent.push(m), done: () => doneResolve()};
  const env = {get: k => envValues[k] || ''};
  return {flow, sent, statuses, done, tick: ms => (clock += ms),
    run: (id, msg) => new Function('msg', 'flow', 'node', 'env', 'Date', 'global', byId.get(id).func)(msg, flow, node, env, TestDate, global)};
}
function fakeTelegram(updates = []) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const method = url.split('/').pop(), body = JSON.parse(options.body);
    calls.push({url, method, body});
    if (method === 'getUpdates') return {status: 200, json: async () => ({ok: true, result: updates.splice(0).filter(u => u.update_id >= body.offset)})};
    if (method === 'sendMessage') return {status: 200, json: async () => ({ok: true, result: {message_id: calls.length}})};
    return {status: 404, json: async () => ({ok: false, description: 'Not Found'})};
  };
  return {calls, fetchImpl};
}
const message = (update_id, chatId, text) => ({update_id, message: {chat: {id: chatId}, from: {username: 'thay'}, text}});

const tests = [
  ['SQLite store saves zone state on change or every 10 s and survives reopen', () => {
    const file = path.join(tmp, 'a.sqlite');
    const store = openStore(file, {sampleMs: 10000, now: () => T0});
    assert.equal(store.available, true);
    assert.equal(store.saveTelemetry(telemetry(), T0), true);
    assert.equal(store.saveTelemetry(telemetry(), T0 + 2000), false, 'same state inside 10 s is skipped');
    assert.equal(store.saveTelemetry(telemetry([true, false, false]), T0 + 4000), true, 'state change is saved immediately');
    assert.equal(store.saveTelemetry(telemetry([true, false, false]), T0 + 14000), true, 'same state saved again after 10 s');
    assert.equal(store.stats().telemetry_rows, 9);
    const zone1 = store.queryTelemetry({from: T0 - 1, to: T0 + 20000, zone: 1});
    assert.equal(zone1.length, 3); assert.equal(zone1[0].led, 1); assert.equal(zone1[2].led, 0);
    assert.equal(zone1[0].ts_vn, '2026-11-21 08:00:14');
    store.close();
    const reopened = openStore(file, {now: () => T0});
    assert.equal(reopened.stats().telemetry_rows, 9, 'rows persist after restart');
    reopened.close();
  }],
  ['event log is queryable by type and keeps the full JSON detail', () => {
    const store = openStore(path.join(tmp, 'b.sqlite'), {now: () => T0});
    store.saveEvent({time: new Date(T0).toISOString(), event: {type: 'command_sent', id: 'c-1', command: 'ON1', source: 'telegram'}});
    store.saveEvent({time: new Date(T0 + 1000).toISOString(), event: {type: 'command', result: 'OK', id: 'c-1', command: 'ON1'}});
    store.saveEvent({time: new Date(T0 + 2000).toISOString(), event: {type: 'alert', code: 'PIR_HIGH_LONG', zone: 2, high_seconds: 120}});
    assert.equal(store.saveEvent({time: 'x', event: 'bad'}), false);
    const all = store.queryEvents({from: T0 - 1, to: T0 + 5000});
    assert.deepEqual(all.map(e => e.type), ['alert', 'command', 'command_sent'], 'newest first');
    const alerts = store.queryEvents({from: T0 - 1, to: T0 + 5000, type: 'alert'});
    assert.equal(alerts.length, 1); assert.equal(alerts[0].zone_id, 2); assert.equal(JSON.parse(alerts[0].detail).high_seconds, 120);
    assert.equal(store.queryEvents({from: T0 - 1, to: T0 + 5000, zone: 2}).length, 1);
    store.close();
  }],
  ['daily usage sums lit time per zone and ignores offline gaps', () => {
    const store = openStore(path.join(tmp, 'c.sqlite'), {sampleMs: 10000, now: () => T0});
    for (let t = 0; t <= 60000; t += 10000) store.saveTelemetry(telemetry([true, false, false]), T0 + t);
    store.saveTelemetry(telemetry([true, false, false]), T0 + 600000); // 9 phut mat ket noi: khong cong
    const usage = store.usageByDay({from: T0 - 1, to: T0 + 700000});
    const z1 = usage.find(u => u.zone_id === 1), z2 = usage.find(u => u.zone_id === 2);
    assert.equal(z1.day, '2026-11-21'); assert.equal(z1.on_seconds, 60); assert.equal(z2.on_seconds, 0);
    store.close();
  }],
  ['CSV export has BOM, escapes quotes/newlines and neutralises formulas', () => {
    const csv = toCsv([{a: 'x,"y"', b: '=SUM(A1)', c: 5}], [{key: 'a', label: 'A'}, {key: 'b', label: 'B'}, {key: 'c', label: 'C'}]);
    assert.ok(csv.startsWith('﻿A,B,C\r\n'));
    assert.match(csv, /"x,""y""",'=SUM\(A1\),5/);
    assert.equal(vnTime(Date.parse('2026-12-31T17:30:00Z')), '2027-01-01 00:30:00');
  }],
  ['unusable database path disables storage without crashing Node-RED', () => {
    const store = openStore(tmp, {now: () => T0}); // thu muc, khong phai file
    assert.equal(store.available, false); assert.equal(store.saveTelemetry(telemetry()), false);
    assert.deepEqual(store.queryEvents(), []); assert.equal(store.stats().available, false);
  }],
  ['db Function nodes store only live telemetry and every journal record', () => {
    const store = openStore(path.join(tmp, 'd.sqlite'), {now: () => T0});
    const h = harness({store});
    h.run('db-telemetry', {live: false, payload: telemetry()});
    assert.equal(store.stats().telemetry_rows, 0, 'retained data is not history');
    h.run('db-telemetry', {live: true, payload: telemetry([false, true, false])});
    assert.equal(store.stats().telemetry_rows, 3);
    h.run('db-event', {payload: JSON.stringify({time: new Date(T0).toISOString(), topic: '', event: {type: 'automation', command: 'AUTO', idle_seconds: 30}})});
    assert.equal(store.queryEvents({from: T0 - 1, to: T0 + 1})[0].type, 'automation');
    store.close();
  }],
  ['history API answers JSON, CSV, validates input and reports missing storage', () => {
    const store = openStore(path.join(tmp, 'e.sqlite'), {now: () => T0});
    store.saveTelemetry(telemetry([true, false, false]), T0 - 1000);
    store.saveEvent({time: new Date(T0 - 500).toISOString(), event: {type: 'alert', code: 'DEVICE_OFFLINE'}});
    const h = harness({store});
    const ok = h.run('http-history', {req: {query: {kind: 'telemetry', hours: '1', zone: '1'}}});
    assert.equal(ok.statusCode, 200); assert.equal(ok.payload.count, 1); assert.equal(ok.payload.rows[0].led, 1);
    const events = h.run('http-history', {req: {query: {kind: 'events', type: 'alert'}}});
    assert.equal(events.payload.rows[0].code, 'DEVICE_OFFLINE');
    const csv = h.run('http-history', {req: {query: {kind: 'telemetry', format: 'csv'}}});
    assert.match(csv.headers['Content-Type'], /text\/csv/); assert.match(csv.payload, /Gio Viet Nam,Vung,PIR/);
    assert.match(csv.headers['Content-Disposition'], /nhom08-telemetry-24h\.csv/);
    assert.equal(h.run('http-history', {req: {query: {kind: 'usage'}}}).statusCode, 200);
    for (const query of [{kind: 'x'}, {hours: '0'}, {hours: '721'}, {zone: '4'}, {limit: '5000'}, {type: 'DROP TABLE'}, {format: 'xml'}]) {
      assert.equal(h.run('http-history', {req: {query}}).statusCode, 400, JSON.stringify(query));
    }
    assert.equal(harness().run('http-history', {req: {query: {}}}).statusCode, 503);
    store.close();
  }],
  ['Telegram parses commands, polls with offset and never leaks the token', async () => {
    assert.deepEqual(parseCommand('/ON2@kho_bot'), {kind: 'command', command: 'ON2'});
    assert.deepEqual(parseCommand('/alloff'), {kind: 'command', command: 'ALL_OFF'});
    assert.equal(parseCommand('/status').kind, 'status'); assert.equal(parseCommand('/start').kind, 'help');
    assert.equal(parseCommand('bat den').kind, 'unknown');
    const fake = fakeTelegram([message(7, 42, '/status'), message(8, 99, '/on1')]);
    const tg = createTelegram({token: 'SECRET-TOKEN', chatIds: '42', fetchImpl: fake.fetchImpl, apiBase: 'http://mock'});
    const msgs = await tg.poll();
    assert.deepEqual(msgs.map(m => [m.chatId, m.authorized]), [['42', true], ['99', false]]);
    await tg.poll(); assert.equal(fake.calls.at(-1).body.offset, 9, 'next poll asks only for new updates');
    assert.equal(await tg.send('Xin chao'), true);
    assert.deepEqual(fake.calls.filter(c => c.method === 'sendMessage').map(c => c.body.chat_id), ['42']);
    const broken = createTelegram({token: 'SECRET-TOKEN', chatIds: '42', fetchImpl: async () => { throw Error('fail SECRET-TOKEN'); }});
    await broken.send('x'); assert.ok(!broken.status().last_error.includes('SECRET-TOKEN'));
    const off = createTelegram({token: '', fetchImpl: () => assert.fail('must not call API')});
    assert.equal(off.enabled, false); assert.deepEqual(await off.poll(), []); assert.equal(await off.send('x'), false);
  }],
  ['telegram-in: allowed chat sends commands via the command node, others are refused', async () => {
    const fake = fakeTelegram([message(1, 42, '/on2'), message(2, 42, '/status'), message(3, 99, '/alloff'), message(4, 42, 'xin chao')]);
    const tg = createTelegram({token: 'T', chatIds: '42', fetchImpl: fake.fetchImpl, apiBase: 'http://mock'});
    const h = harness({tg});
    h.flow.set('telemetry', telemetry([true, false, false])); h.flow.set('deviceOnline', true); h.flow.set('lastTelemetryAt', T0);
    assert.equal(h.run('telegram-in', {}), null);
    await h.done; await new Promise(setImmediate);
    const [commands, logs] = h.sent[0];
    assert.deepEqual(commands.map(m => [m.payload, m.source]), [['ON2', 'telegram']]);
    assert.equal(logs[0].payload.action, 'unauthorized');
    const replies = fake.calls.filter(c => c.method === 'sendMessage');
    assert.ok(replies.some(r => r.body.chat_id === '42' && /Vùng 1: đèn BẬT/.test(r.body.text) && /trực tuyến/.test(r.body.text)));
    assert.ok(replies.some(r => r.body.chat_id === '99' && /chưa được cấp quyền/.test(r.body.text)));
    assert.ok(replies.some(r => r.body.chat_id === '42' && /không hợp lệ/.test(r.body.text)));
  }],
  ['telegram-notify sends alerts and Telegram command results once, skips other traffic', async () => {
    const fake = fakeTelegram();
    const tg = createTelegram({token: 'T', chatIds: '42,43', fetchImpl: fake.fetchImpl, apiBase: 'http://mock'});
    const h = harness({tg});
    const record = event => ({payload: JSON.stringify({time: new Date(T0).toISOString(), topic: '', event})});
    h.run('telegram-notify', record({type: 'alert', code: 'DEVICE_OFFLINE', severity: 'warning'}));
    h.run('telegram-notify', record({type: 'alert', code: 'DEVICE_OFFLINE', severity: 'warning'}));
    h.flow.set('commands', [{id: 'c-9', command: 'ON2', source: 'telegram', status: 'acknowledged', rtt_ms: 850},
      {id: 'c-10', command: 'ON1', source: 'dashboard', status: 'acknowledged', rtt_ms: 700}]);
    h.tick(6000);
    h.run('telegram-notify', record({type: 'command', result: 'OK', id: 'c-9', command: 'ON2'}));
    h.run('telegram-notify', record({type: 'command', result: 'OK', id: 'c-10', command: 'ON1'}));
    h.run('telegram-notify', record({type: 'command_rejected', command: 'ON3', reason: 'no_live_telemetry', source: 'telegram'}));
    h.run('telegram-notify', record({type: 'state', zones: []}));
    await new Promise(r => setTimeout(r, 20));
    const texts = fake.calls.filter(c => c.method === 'sendMessage').map(c => c.body.text);
    assert.equal(texts.filter(t => /Mất dữ liệu/.test(t)).length, 2, 'one offline alert to each of 2 chats (duplicate suppressed)');
    assert.ok(texts.some(t => /đã xác nhận ON2 · ACK 850 ms/.test(t)));
    assert.ok(!texts.some(t => /ON1/.test(t)), 'dashboard commands are not echoed to Telegram');
    assert.ok(texts.some(t => /Không gửi được ON3: ESP32 đang offline/.test(t)));
  }],
  ['command node tags Telegram source on accepted and rejected commands', () => {
    const h = harness();
    const rejected = h.run('command', {payload: 'ON1', source: 'telegram'});
    assert.equal(rejected[1].payload.source, 'telegram'); assert.equal(rejected[1].payload.reason, 'no_live_telemetry');
    h.flow.set('deviceOnline', true); h.flow.set('lastTelemetryAt', T0);
    const accepted = h.run('command', {payload: 'ON1', source: 'telegram'});
    assert.equal(accepted[1].payload.source, 'telegram'); assert.equal(h.flow.get('commands')[0].source, 'telegram');
  }],
  ['flow wiring: storage and Telegram hang off validate/history, API and poller exist', () => {
    assert.ok(byId.get('validate').wires[0].includes('db-telemetry'));
    for (const id of ['db-event', 'telegram-notify']) assert.ok(byId.get('history').wires[0].includes(id));
    assert.equal(byId.get('api-history-in').url, '/dt45/api/history');
    assert.deepEqual(byId.get('telegram-in').wires, [['command'], ['history']]);
    assert.equal(byId.get('telegram-tick').repeat, '3');
    const settings = fs.readFileSync(path.join(__dirname, '../node-red/settings.js'), 'utf8');
    assert.match(settings, /functionGlobalContext/); assert.ok(!/\d{8,}:[A-Za-z0-9_-]{30,}/.test(settings), 'no token in settings');
  }]
];

(async () => {
  let failures = 0;
  for (const [name, test] of tests) {
    try { await test(); console.log('PASS ' + name); }
    catch (e) { failures++; console.error('FAIL ' + name + '\n' + e.stack); }
  }
  console.log(`${tests.length - failures}/${tests.length} passed`);
  fs.rmSync(tmp, {recursive: true, force: true});
  process.exitCode = failures ? 1 : 0;
})();
