#pragma once
#include "Arduino.h"
constexpr int WL_CONNECTED = 3;
constexpr int WIFI_STA = 1;
struct FakeWiFi {
  bool link = false;
  unsigned beginCalls = 0;
  void mode(int) {}
  void begin(const char *, const char *) { ++beginCalls; }
  int status() const { return link ? WL_CONNECTED : 0; }
};
extern FakeWiFi WiFi;
struct WiFiClient {
  void setTimeout(uint32_t) {}
  void stop() {}
};
