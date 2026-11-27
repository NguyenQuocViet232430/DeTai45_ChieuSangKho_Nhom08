// Chay truc tiep src/main.cpp voi dong ho, GPIO va Serial gia lap tren PC.
// Khong thay the bai test Wokwi / mach that.
#include "Arduino.h"
#include "WiFi.h"
#include <algorithm>
#include <functional>
#include <iostream>
#include <stdexcept>
#include <vector>

uint32_t fakeMillis = 0;
int fakePins[64] = {};
int fakeModes[64] = {};
FakeSerial Serial;
FakeESP ESP;
FakeWiFi WiFi;
#include "../../src/main.cpp"

#define CHECK(condition) do { if (!(condition)) throw std::runtime_error( \
  std::string("line ") + std::to_string(__LINE__) + ": " + #condition); } while (0)

void reset(uint32_t start = 0) {
  fakeMillis = start;
  std::fill(fakePins, fakePins + 64, LOW);
  std::fill(fakeModes, fakeModes + 64, 0);
  Serial = FakeSerial{};
  WiFi = FakeWiFi{};
  client = PubSubClient(espClient);
  stateDirty = true;
  wifiReported = mqttReported = false;
  lastWifiAttempt = lastMqttAttempt = lastTelemetry = 0;
  for (auto &z : zones) {
    const uint8_t pir = z.pirPin, led = z.ledPin;
    z = Zone{pir, led, false, false, false, false, 0, 0};
    fakePins[led] = HIGH;  // setup phai chu dong dua output ve LOW.
  }
  lastScan = 0;
  cmdIdx = 0;
  discardLine = false;
  previousWasCR = false;
  escapeState = EscapeState::NONE;
  escapeLength = 0;
  escapeStartedAt = 0;
  std::fill(cmd, cmd + sizeof(cmd), '\0');
  setup();
}

void advance(uint32_t ms) {
  for (uint32_t i = 0; i < ms; ++i) { ++fakeMillis; loop(); }
}

void send(const std::string &text) {
  Serial.feed(text);
  while (Serial.available()) loop();
}

void expectLed(uint8_t zone, bool on) {
  CHECK(zones[zone].ledState == on);
  CHECK(fakePins[zones[zone].ledPin] == (on ? HIGH : LOW));
}

std::string topic(const char *suffix) { return std::string(MQTT_PREFIX) + "/" + suffix; }
std::string published(const char *suffix) {
  for (auto it = client.publications.rbegin(); it != client.publications.rend(); ++it) {
    if (it->topic == topic(suffix)) return it->payload;
  }
  return "";
}
void connectBroker() { WiFi.link = true; loop(); CHECK(client.connected()); }

int main() {
  const std::vector<std::pair<const char *, std::function<void()>>> tests = {
    {"T01 boot: AUTO, outputs explicitly LOW", [] {
      reset();
      for (uint8_t i = 0; i < 3; ++i) {
        expectLed(i, false); CHECK(!zones[i].manualOverride);
        CHECK(fakeModes[zones[i].pirPin] == INPUT_PULLDOWN);
        CHECK(fakeModes[zones[i].ledPin] == OUTPUT);
      }
      advance(12000);
      for (uint8_t i = 0; i < 3; ++i) expectLed(i, false);
    }},
    {"T02 each PIR controls only its own LED; filter boundary", [] {
      for (uint8_t target = 0; target < 3; ++target) {
        reset(); fakePins[zones[target].pirPin] = HIGH;
        advance(319); expectLed(target, false);
        advance(1);
        for (uint8_t i = 0; i < 3; ++i) expectLed(i, i == target);
      }
    }},
    {"T03 short pulses rejected, LOW resets filter", [] {
      reset();
      for (int repeat = 0; repeat < 2; ++repeat) {
        fakePins[23] = HIGH; advance(200);
        fakePins[23] = LOW; advance(40); expectLed(0, false);
      }
      fakePins[23] = HIGH; advance(320); expectLed(0, true);
    }},
    {"T04 simultaneous zones and independent timeout", [] {
      reset(); fakePins[23] = HIGH; fakePins[22] = HIGH; fakePins[21] = HIGH;
      advance(320);
      for (uint8_t i = 0; i < 3; ++i) expectLed(i, true);
      fakePins[22] = LOW; advance(10000);
      expectLed(0, true); expectLed(1, false); expectLed(2, true);
    }},
    {"T05 continuous motion keeps LED on beyond 10 seconds", [] {
      reset(); fakePins[23] = HIGH; advance(15000); expectLed(0, true);
    }},
    {"T06 timeout boundary: 9999ms on, 10000ms off", [] {
      reset(); fakePins[23] = HIGH; advance(320);
      fakePins[23] = LOW;
      advance(9999); expectLed(0, true);
      advance(1); expectLed(0, false);
    }},
    {"T07 renewed motion extends timeout", [] {
      reset(); fakePins[23] = HIGH; advance(320);
      fakePins[23] = LOW; advance(9000);
      fakePins[23] = HIGH; advance(320);
      fakePins[23] = LOW;
      advance(9999); expectLed(0, true);
      advance(1); expectLed(0, false);
    }},
    {"T08 all six per-zone commands work and stay isolated", [] {
      for (uint8_t target = 0; target < 3; ++target) {
        reset(); send("ON" + std::to_string(target + 1) + "\n");
        for (uint8_t i = 0; i < 3; ++i) {
          expectLed(i, i == target); CHECK(zones[i].manualOverride == (i == target));
        }
        advance(12000); expectLed(target, true);
        fakePins[zones[target].pirPin] = HIGH;
        send("OFF" + std::to_string(target + 1) + "\n");
        advance(12000); expectLed(target, false);
      }
    }},
    {"T09 manual zone does not stop another automatic zone", [] {
      reset(); send("OFF1\n"); fakePins[23] = HIGH; fakePins[22] = HIGH;
      advance(320); expectLed(0, false); expectLed(1, true); expectLed(2, false);
    }},
    {"T10 ALL_ON and ALL_OFF persist until AUTO", [] {
      reset(); send("ALL_ON\n"); advance(12000);
      for (uint8_t i = 0; i < 3; ++i) { expectLed(i, true); CHECK(zones[i].manualOverride); }
      for (auto &z : zones) fakePins[z.pirPin] = HIGH;
      send("ALL_OFF\n"); advance(12000);
      for (uint8_t i = 0; i < 3; ++i) { expectLed(i, false); CHECK(zones[i].manualOverride); }
      send("AUTO\n"); advance(20);
      for (uint8_t i = 0; i < 3; ++i) { expectLed(i, true); CHECK(!zones[i].manualOverride); }
    }},
    {"T11 Manual -> AUTO grants a fresh 10s hold to lit LEDs", [] {
      reset(); send("ALL_ON\n"); advance(20000); send("AUTO\n");
      advance(9999);
      for (uint8_t i = 0; i < 3; ++i) expectLed(i, true);
      advance(1);
      for (uint8_t i = 0; i < 3; ++i) expectLed(i, false);
    }},
    {"T12 repeated AUTO does not extend hold", [] {
      reset(); send("ON1\nAUTO\n"); advance(9000); send("AUTO\n");
      advance(999); expectLed(0, true);
      advance(1); expectLed(0, false);
    }},
    {"T13 AUTO preserves already-automatic zone timeout", [] {
      reset(); fakePins[22] = HIGH; advance(320);
      fakePins[22] = LOW; advance(9000); send("ON1\nAUTO\n");
      advance(1000); expectLed(0, true); expectLed(1, false);
    }},
    {"T14 lower case, whitespace, CR/LF/CRLF and empty lines", [] {
      reset(); Serial.output.clear();
      send(" \ton1 \t\r\n\n\r"); expectLed(0, true);
      send(" off1\r"); expectLed(0, false);
      send("on2\n"); expectLed(1, true);
      CHECK(Serial.output.find("ERROR") == std::string::npos);
    }},
    {"T15 malformed commands rejected without state changes", [] {
      const char *bad[] = {"ON0", "ON4", "OFF0", "OFF4", "ON1x", "OFF1x", "ON", "OFF", "ON 1", "AUTO1", "ALL_ONx"};
      for (const auto *command : bad) {
        reset(); Serial.output.clear(); send(std::string(command) + "\n");
        for (uint8_t i = 0; i < 3; ++i) { expectLed(i, false); CHECK(!zones[i].manualOverride); }
        CHECK(Serial.output.find("ERROR") != std::string::npos);
      }
    }},
    {"T16 overlong line discarded entirely, next command recovers", [] {
      reset(); Serial.output.clear();
      send("ON1" + std::string(29, ' ') + "\n"); expectLed(0, false);
      CHECK(Serial.output.find("ERROR") != std::string::npos);
      send("ON2\n"); expectLed(1, true);
      reset(); send("ON1" + std::string(28, ' ') + "\n"); expectLed(0, true);
    }},
    {"T17 invalid control byte rejected, fragmented input waits for newline", [] {
      reset(); send(std::string("ON1\0", 4) + "\n"); expectLed(0, false);
      send("ON"); advance(1000); expectLed(0, false);
      send("1"); advance(1000); expectLed(0, false);
      send("\n"); expectLed(0, true);
    }},
    {"T18 STATUS and HELP report without changing controls", [] {
      reset(); send("ON1\n"); Serial.output.clear(); send("STATUS\nHELP\n");
      CHECK(Serial.output.find("Zone 1: PIR=0 VALID=0 LED=ON MODE=MANUAL") != std::string::npos);
      CHECK(Serial.output.find("Zone 2: PIR=0 VALID=0 LED=OFF MODE=AUTO") != std::string::npos);
      CHECK(Serial.output.find("Lenh:") != std::string::npos);
      expectLed(0, true); expectLed(1, false); expectLed(2, false);
    }},
    {"T19 serial backlog does not starve sensor scan", [] {
      reset(); fakePins[23] = HIGH; advance(300);
      Serial.feed(std::string(200, 'X'));
      fakeMillis += 20; loop();
      CHECK(Serial.available() == 168); expectLed(0, true);
    }},
    {"T21 typed characters are echoed before Enter; CRLF executes once", [] {
      reset(); Serial.output.clear();
      send("ON1"); CHECK(Serial.output == "ON1"); expectLed(0, false);
      send("\r"); expectLed(0, true);
      CHECK(Serial.output.find("ON1\r\n") == 0);
      const std::string afterCR = Serial.output;
      send("\n"); CHECK(Serial.output == afterCR);
    }},
    {"T22 Backspace and DEL correct input; empty backspace is harmless", [] {
      reset(); Serial.output.clear();
      send("\b\x7f"); CHECK(Serial.output.empty());
      send("ON3\b2\r"); expectLed(1, true); expectLed(2, false);
      CHECK(Serial.output.find("\b \b") != std::string::npos);
      send("OFF3\x7f" "2\n"); expectLed(1, false);
      CHECK(Serial.output.find("ERROR") == std::string::npos);
    }},
    {"T23 all console line endings return cursor to first column", [] {
      reset(); send("ON1\nSTATUS\nHELP\nAUTO\nINVALID\n");
      fakePins[22] = HIGH; advance(320);
      for (size_t i = 0; i < Serial.output.size(); ++i) {
        if (Serial.output[i] == '\n') CHECK(i > 0 && Serial.output[i - 1] == '\r');
      }
    }},
    {"T24 backspace cannot reactivate a discarded overlong line", [] {
      reset(); send("ON1" + std::string(29, ' ') + "\b\r\n"); expectLed(0, false);
      send("ON2\r\n"); expectLed(1, true);
    }},
    {"T25 repeated Backspace after ALL_ON permits continued typing", [] {
      reset(); send("ALL_ON\r\nALL_ON\b\bOFF\r\n");
      for (uint8_t i = 0; i < 3; ++i) expectLed(i, false);
      send("ON3\b\b\b\bON2\n"); expectLed(1, true);
      CHECK(!discardLine);
    }},
    {"T26 fragmented ANSI Delete erases without poisoning input", [] {
      reset(); send("ON3\033["); advance(20); send("3"); advance(20);
      send("~2\r\n"); expectLed(1, true); expectLed(2, false);
      CHECK(!discardLine);
    }},
    {"T27 arrows, Home/End and SS3 do not become command text", [] {
      reset(); send("ON\033[A\033[B\033[C\033[D\033[H\033[F\033OH1\n");
      expectLed(0, true); CHECK(!discardLine);
    }},
    {"T28 invalid byte reports immediately; Backspace clears line and recovers", [] {
      reset(); Serial.output.clear(); send(std::string("ON1\0", 4));
      CHECK(discardLine); CHECK(Serial.output.find("INPUT ERROR") != std::string::npos);
      send("\bON2\n"); expectLed(0, false); expectLed(1, true);
      CHECK(!discardLine);
    }},
    {"T29 Ctrl+U/Ctrl+C clear partial, invalid, overflowing and ESC input", [] {
      for (const char cancel : {char(21), char(3)}) {
        for (const auto &prefix : {std::string("ALL_ON"), std::string(40, 'X'),
                                  std::string("ON1\0", 4), std::string("ON1\033[")}) {
          reset(); send(prefix + cancel + "ON2\n");
          expectLed(0, false); expectLed(1, true); expectLed(2, false);
          CHECK(!discardLine);
        }
      }
    }},
    {"T30 incomplete escape cannot swallow Enter or block later input", [] {
      reset(); send("ON1\033[\r\n"); expectLed(0, true);
      send("OFF1\033[\b1\n"); expectLed(0, false);
      send("\033["); advance(250); send("ON2\n"); expectLed(1, true);
      send("ON3\033\x7f" "2\n"); expectLed(2, false); expectLed(1, true);
    }},
    {"T31 deleting entire line does not execute stale data", [] {
      reset(); send("ALL_ON" + std::string(30, '\b') + "\r\nSTATUS\n");
      for (uint8_t i = 0; i < 3; ++i) { expectLed(i, false); CHECK(!zones[i].manualOverride); }
    }},
    {"M01 MQTT broker, subscription, LWT and complete boot snapshot", [] {
      reset(); connectBroker();
      CHECK(client.host == "broker.emqx.io"); CHECK(client.port == 1883);
      CHECK(client.subscription == topic("command/all")); CHECK(client.subscriptionQos == 1);
      CHECK(client.willTopic == topic("status")); CHECK(client.willPayload == "offline");
      CHECK(client.willRetained); CHECK(client.willQos == 1);
      CHECK(published("status") == "online");
      for (int i = 1; i <= 3; ++i) {
        CHECK(published(("zone" + std::to_string(i) + "/led").c_str()) == "OFF");
        CHECK(published(("zone" + std::to_string(i) + "/mode").c_str()) == "AUTO");
      }
      CHECK(published("telemetry").find("\"zones\":[") != std::string::npos);
      for (const auto &p : client.publications) CHECK(p.retained);
      CHECK(client.bufferSize >= published("telemetry").size() + topic("telemetry").size() + 8);
    }},
    {"M02 remote commands share parser, ack and mode even when LED unchanged", [] {
      reset(); connectBroker(); client.receive(topic("command/all"), " off1 \r\n");
      expectLed(0, false); CHECK(zones[0].manualOverride);
      CHECK(published("zone1/mode") == "MANUAL");
      CHECK(published("event").find("\"result\":\"OK\"") != std::string::npos);
      client.receive(topic("command/all"), "ALL_ON");
      for (uint8_t i = 0; i < 3; ++i) expectLed(i, true);
      client.receive(topic("command/all"), "AUTO");
      for (const auto &z : zones) CHECK(!z.manualOverride);
      for (const auto &p : client.publications) if (p.topic == topic("event")) CHECK(!p.retained);
    }},
    {"M03 wrong topics and invalid, empty, oversized, embedded NUL commands rejected", [] {
      reset(); connectBroker(); client.receive("warehouse/command/all", "ALL_ON");
      for (const auto &payload : {std::string(""), std::string("ON4"), std::string(32, 'X'), std::string("ON1\0", 4)}) {
        client.receive(topic("command/all"), payload);
        for (uint8_t i = 0; i < 3; ++i) { expectLed(i, false); CHECK(!zones[i].manualOverride); }
        CHECK(published("event").find("ERROR") != std::string::npos);
      }
    }},
    {"M04 offline boot and failed broker preserve local PIR and Serial control", [] {
      reset(); CHECK(WiFi.beginCalls == 1); send("ON2\n"); expectLed(1, true);
      fakePins[23] = HIGH; advance(320); expectLed(0, true);
      WiFi.link = true; client.reachable = false; loop(); CHECK(client.connectCalls == 1);
      fakePins[23] = LOW; advance(10000); expectLed(0, false); expectLed(1, true);
      CHECK(client.connectCalls == 3); send("OFF2\n"); expectLed(1, false);
    }},
    {"M05 reconnect resubscribes and republishes offline changes", [] {
      reset(); connectBroker(); client.link = false; client.reachable = false;
      loop(); send("ON3\n"); advance(5000); client.reachable = true; advance(5000);
      CHECK(client.connected()); CHECK(client.subscription == topic("command/all"));
      CHECK(published("zone3/led") == "ON"); CHECK(published("zone3/mode") == "MANUAL");
      CHECK(published("status") == "online");
      client.receive(topic("command/all"), "OFF3"); expectLed(2, false);
    }},
    {"M06 WiFi retry and telemetry heartbeat survive timer rollover", [] {
      reset(UINT32_MAX - 5000); advance(9999); CHECK(WiFi.beginCalls == 1);
      advance(1); CHECK(WiFi.beginCalls == 2); connectBroker();
      const auto count = client.publications.size(); advance(1999);
      CHECK(client.publications.size() == count); advance(1); CHECK(client.publications.size() > count);
    }},
    {"M07 subscribe failure retries; failed publish retries with latest state", [] {
      reset(); WiFi.link = true; client.subscribeOk = false; loop(); CHECK(!client.connected());
      client.subscribeOk = true; advance(5000); CHECK(client.connected());
      client.publishOk = false; send("ON1\n"); advance(100); CHECK(stateDirty);
      client.publishOk = true; advance(100); CHECK(!stateDirty); CHECK(published("zone1/led") == "ON");
    }},
    {"M08 envelope executes and echoes ID/canonical command in ACK", [] {
      reset(); connectBroker(); client.receive(topic("command/all"), "CMD|web-123_4| on2 ");
      expectLed(1, true); CHECK(zones[1].manualOverride);
      CHECK(published("event").find("\"id\":\"web-123_4\"") != std::string::npos);
      CHECK(published("event").find("\"command\":\"ON2\"") != std::string::npos);
      client.receive(topic("command/all"), "CMD|auto-5|AUTO"); CHECK(!zones[1].manualOverride);
      client.receive(topic("command/all"), " off2 "); expectLed(1, false);
      CHECK(published("event").find("\"id\":\"\"") != std::string::npos);
    }},
    {"M10 duplicate MQTT ID returns ACK without applying old command again", [] {
      reset(); connectBroker();
      client.receive(topic("command/all"), "CMD|first|ON1"); expectLed(0,true);
      client.receive(topic("command/all"), "CMD|second|OFF1"); expectLed(0,false);
      client.receive(topic("command/all"), "CMD|first|ON1"); expectLed(0,false);
      CHECK(published("event").find("duplicate") != std::string::npos);
      CHECK(published("event").find("\"result\":\"OK\"") != std::string::npos);
    }},
    {"M11 reused ID with different command is rejected; new boot clears cache", [] {
      reset(); connectBroker();
      client.receive(topic("command/all"), "CMD|same|ON1");
      client.receive(topic("command/all"), "CMD|same|OFF1"); expectLed(0,true);
      CHECK(published("event").find("id_conflict") != std::string::npos);
      reset(); connectBroker(); client.receive(topic("command/all"), "CMD|same|OFF1"); expectLed(0,false);
      CHECK(published("event").find("\"result\":\"OK\"") != std::string::npos);
    }},
    {"M12 receipt ring is bounded and invalid command duplicate never actuates", [] {
      reset(); connectBroker();
      client.receive(topic("command/all"), "CMD|bad|ON4");
      client.receive(topic("command/all"), "CMD|bad|ON4");
      CHECK(published("event").find("unknown_command") != std::string::npos);
      for (int i=0;i<20;i++) client.receive(topic("command/all"), "CMD|id-"+std::to_string(i)+"|OFF1");
      CHECK(receiptNext < 8); CHECK(sizeof(receipts)/sizeof(receipts[0]) == 8);
      for (uint8_t i=0;i<3;i++) expectLed(i,false);
    }},
    {"M09 malformed envelope/ID cannot actuate or inject JSON", [] {
      for (const auto &payload : {std::string("CMD||ALL_ON"), std::string("CMD|bad\"id|ALL_ON"),
          std::string("CMD|id"), std::string("CMD|id|ON4"), std::string("CMD|id|"),
          std::string("CMD|") + std::string(33, 'a') + "|ALL_ON", std::string(96, 'x')}) {
        reset(); connectBroker(); client.receive(topic("command/all"), payload);
        for (uint8_t i = 0; i < 3; ++i) {expectLed(i, false); CHECK(!zones[i].manualOverride);}
        CHECK(published("event").find("\"result\":\"ERROR\"") != std::string::npos);
        CHECK(published("event").find("bad\"id") == std::string::npos);
      }
    }},
    {"M13 same MAC gets distinct boot IDs; reconnect keeps the current ID", [] {
      reset(); connectBroker();
      const std::string firstId = client.clientId;
      CHECK(firstId.size() <= 23);
      client.link = false;
      advance(5000);
      CHECK(client.connected()); CHECK(client.clientId == firstId);
      reset(); connectBroker();
      CHECK(client.clientId != firstId);
    }},
    {"M14 idle heartbeat sends telemetry only; PIR changes update retained zones", [] {
      reset(); connectBroker(); client.publications.clear();
      advance(1999); CHECK(client.publications.empty());
      advance(1); CHECK(client.publications.size() == 1);
      CHECK(client.publications[0].topic == topic("telemetry"));
      CHECK(client.publications[0].retained);
      client.publications.clear(); fakePins[23] = HIGH; advance(320);
      CHECK(published("zone1/led") == "ON");
      CHECK(published("zone1/motion") == "MOTION_DETECTED");
      CHECK(published("status") == "online");
    }},
    {"F01 runtime timeout validates complete integers and resets on boot", [] {
      reset(); CHECK(timeoutMs == 10000); send("TIMEOUT=15\n"); CHECK(timeoutMs == 15000);
      for (const auto &bad : {"TIMEOUT=", "TIMEOUT=2", "TIMEOUT=301", "TIMEOUT=-3", "TIMEOUT=3.5", "TIMEOUT=15x", "TIMEOUT= 15", "TIMEOUT=0003", "TIMEOUT=999999999999999999"}) {
        char value[32]; snprintf(value,sizeof(value),"%s",bad); CHECK(!handleCommand(value)); CHECK(timeoutMs == 15000);
      }
      connectBroker(); client.receive(topic("command/all"),"CMD|cfg-1|TIMEOUT=3"); CHECK(timeoutMs == 3000);
      CHECK(published("event").find("\"result\":\"OK\"") != std::string::npos);
      fakePins[23] = HIGH; advance(320); fakePins[23] = LOW;
      advance(2999); expectLed(0,true); advance(1); expectLed(0,false);
      send("TIMEOUT=300\n"); CHECK(timeoutMs == 300000); reset(); CHECK(timeoutMs == 10000);
    }},
    {"F02 changing timeout affects current hold without extending its start", [] {
      reset(); fakePins[23]=HIGH; advance(320); fakePins[23]=LOW; advance(4000);
      send("TIMEOUT=3\n"); advance(20); expectLed(0,false);
      reset(); fakePins[23]=HIGH; advance(320); fakePins[23]=LOW; advance(4000);
      send("TIMEOUT=15\n"); advance(10999); expectLed(0,true); advance(1); expectLed(0,false);
    }},
    {"F03 pre-light is opt-in, only adjacent, non-cascading and two-pass", [] {
      reset(); CHECK(!preLight); fakePins[23]=HIGH; advance(320); expectLed(0,true); expectLed(1,false);
      send("PRELIGHT_ON\n"); advance(20); expectLed(1,true); expectLed(2,false);
      send("PRELIGHT_OFF\n"); advance(20); expectLed(0,true); expectLed(1,false);
      reset(); send("PRELIGHT_ON\n"); fakePins[21]=HIGH; advance(320);
      expectLed(0,false); expectLed(1,true); expectLed(2,true);
      reset(); send("PRELIGHT_ON\n"); fakePins[22]=HIGH; advance(320);
      for(uint8_t i=0;i<3;i++)expectLed(i,true);
      reset(); CHECK(!preLight);
    }},
    {"F04 neighbor hold expires at 5s, manual OFF wins and rollover works", [] {
      reset(UINT32_MAX-200); send("PRELIGHT_ON\n"); fakePins[23]=HIGH; advance(320);
      fakePins[23]=LOW; advance(4999); expectLed(0,true); expectLed(1,true);
      advance(1); expectLed(0,true); expectLed(1,false);
      send("OFF2\n"); fakePins[23]=HIGH; advance(320); expectLed(1,false);
      send("AUTO\n"); advance(20); expectLed(1,true);
    }},
    {"F05 per-zone on-time counts transitions, offline time and millis rollover", [] {
      reset(UINT32_MAX-500); send("ON1\n"); advance(1000); send("OFF1\n");
      CHECK(sessionMs == 1000); CHECK(zones[0].onMs == 1000); CHECK(zones[1].onMs == 0);
      advance(1000); send("ON2\n"); advance(500); send("ON1\n"); advance(500);
      CHECK(sessionMs == 3000); CHECK(zones[0].onMs == 1500); CHECK(zones[1].onMs == 1000);
      connectBroker(); CHECK(published("telemetry").find("\"session_ms\":3000") != std::string::npos);
      CHECK(published("telemetry").find("\"on_ms\":1500") != std::string::npos);
      reset(); CHECK(sessionMs == 0); CHECK(zones[0].onMs == 0);
    }},
    {"F06 telemetry handles large counters within MQTT buffer and bounded JSON", [] {
      reset(); connectBroker(); sessionMs=900000000000ULL;
      for(auto &z:zones)z.onMs=sessionMs;
      publishSnapshot(); const auto json=published("telemetry");
      CHECK(json.find("\"on_ms\":900000000000") != std::string::npos);
      CHECK(json.substr(json.size()-2) == "]}");
      CHECK(json.size()+topic("telemetry").size()+8 <= client.bufferSize);
      char tiny[4]; size_t used=0; CHECK(!appendJson(tiny,sizeof(tiny),used,"12345")); CHECK(used == 0);
    }},
    {"T20 filter and timeout survive uint32 millis rollover", [] {
      reset(UINT32_MAX - 200); fakePins[23] = HIGH;
      advance(319); expectLed(0, false);
      advance(1); expectLed(0, true);
      fakePins[23] = LOW; advance(9999); expectLed(0, true);
      advance(1); expectLed(0, false);
      reset(UINT32_MAX - 5000); fakePins[23] = HIGH; advance(320);
      fakePins[23] = LOW; advance(9999); expectLed(0, true);
      advance(1); expectLed(0, false);
    }}
  };
  int failed = 0;
  for (const auto &test : tests) {
    try { test.second(); std::cout << "PASS " << test.first << '\n'; }
    catch (const std::exception &error) {
      ++failed; std::cout << "FAIL " << test.first << " -- " << error.what() << '\n';
    }
  }
  std::cout << (tests.size() - failed) << "/" << tests.size() << " passed\n";
  return failed ? 1 : 0;
}
