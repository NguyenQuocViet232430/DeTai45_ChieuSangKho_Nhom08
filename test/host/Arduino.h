#pragma once
#include <cstdint>
#include <cstdarg>
#include <cstdio>
#include <deque>
#include <string>

constexpr int LOW = 0;
constexpr int HIGH = 1;
constexpr int INPUT_PULLDOWN = 2;
constexpr int OUTPUT = 3;
using byte = unsigned char;
struct FakeESP {
  uint64_t getEfuseMac() { return 0xaabbccddeeffULL; }
};
extern FakeESP ESP;
extern uint32_t fakeMillis;
extern int fakePins[64];
extern int fakeModes[64];
inline uint32_t millis() { return fakeMillis; }
inline int digitalRead(uint8_t pin) { return fakePins[pin]; }
inline void digitalWrite(uint8_t pin, int value) { fakePins[pin] = value; }
inline void pinMode(uint8_t pin, int mode) { fakeModes[pin] = mode; }

struct FakeSerial {
  std::deque<char> input;
  std::string output;
  void begin(int) {}
  int available() { return static_cast<int>(input.size()); }
  int read() { const unsigned char c = input.front(); input.pop_front(); return c; }
  void println(const char *text) { output += text; output += "\r\n"; }
  void printf(const char *format, ...) {
    char buffer[512];
    va_list args;
    va_start(args, format);
    vsnprintf(buffer, sizeof(buffer), format, args);
    va_end(args);
    output += buffer;
  }
  void feed(const std::string &text) { for (char c : text) input.push_back(c); }
};
extern FakeSerial Serial;
