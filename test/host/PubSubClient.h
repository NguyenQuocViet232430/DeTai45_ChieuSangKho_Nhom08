#pragma once
#include "WiFi.h"
#include <vector>
#include <algorithm>
struct FakePublication {
  std::string topic, payload;
  bool retained;
};
struct PubSubClient {
  bool link = false, reachable = true, subscribeOk = true, publishOk = true;
  unsigned connectCalls = 0, loopCalls = 0;
  std::string host, clientId, subscription, willTopic, willPayload;
  uint16_t port = 0, bufferSize = 0, socketTimeout = 0, keepAlive = 0;
  uint8_t willQos = 0, subscriptionQos = 0;
  bool willRetained = false;
  std::vector<FakePublication> publications;
  void (*callback)(char *, byte *, unsigned int) = nullptr;
  std::vector<byte> *activeRx = nullptr;
  explicit PubSubClient(WiFiClient &) {}
  void setServer(const char *value, uint16_t p) { host = value; port = p; }
  void setCallback(void (*cb)(char *, byte *, unsigned int)) { callback = cb; }
  bool setBufferSize(uint16_t value) { bufferSize = value; return true; }
  void setSocketTimeout(uint16_t value) { socketTimeout = value; }
  void setKeepAlive(uint16_t value) { keepAlive = value; }
  bool connected() { return link && WiFi.link; }
  bool connect(const char *id, const char *will, uint8_t qos, bool retain, const char *payload) {
    ++connectCalls; clientId = id; willTopic = will; willPayload = payload;
    willQos = qos; willRetained = retain;
    link = reachable && WiFi.link; return link;
  }
  int state() { return connected() ? 0 : -2; }
  bool subscribe(const char *topic, uint8_t qos) {
    subscription = topic; subscriptionQos = qos; return subscribeOk;
  }
  bool publish(const char *topic, const char *payload, bool retained) {
    if (!connected() || !publishOk) return false;
    publications.push_back({topic, payload, retained});
    if (activeRx) std::fill(activeRx->begin(), activeRx->end(), byte('X'));
    return true;
  }
  void disconnect() { link = false; }
  bool loop() { ++loopCalls; return connected(); }
  void receive(const std::string &topic, const std::string &payload) {
    std::vector<char> t(topic.begin(), topic.end()); t.push_back('\0');
    std::vector<byte> data(payload.begin(), payload.end());
    activeRx = &data;
    callback(t.data(), data.data(), static_cast<unsigned int>(data.size()));
    activeRx = nullptr;
  }
};
