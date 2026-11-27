#pragma once
#include <cstdint>

// Mo phong cac boot co cung MAC nhung RNG khac nhau.
inline uint32_t esp_random() {
  static uint32_t nextNonce = 0x84ad9000;
  return ++nextNonce;
}
