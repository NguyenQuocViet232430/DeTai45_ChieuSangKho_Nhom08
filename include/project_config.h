#pragma once  /// Chỉ nạp file này một lần dù được include nhiều nơi.
#include <stdint.h>  /// Kiểu số nguyên có kích thước cố định (uint16_t, uint32_t).

// Wokwi. Doi thanh Wi-Fi cua ban khi chay ESP32 that.
constexpr const char* WIFI_SSID = "Wokwi-GUEST";  /// Tên Wi-Fi ảo của Wokwi; khi chạy ESP32 thật đổi thành Wi-Fi 2,4 GHz của kho.
constexpr const char* WIFI_PASSWORD = "";  /// Wokwi-GUEST không có mật khẩu.
constexpr const char* MQTT_HOST = "broker.emqx.io";  /// Broker MQTT công cộng EMQX (chỉ dùng cho demo; triển khai thật nên dùng broker riêng có TLS).
constexpr uint16_t MQTT_PORT = 1883;  /// Cổng MQTT không mã hóa (TLS thường là 8883).

// MQTTX va Node-RED phai dung dung prefix nay.
// Doi suffix neu mo nhieu ban demo doc lap tren broker cong cong.
constexpr const char* MQTT_PREFIX = "iot/nhom08/detai45/kho-c7e2";  /// Tiền tố topic riêng của nhóm; ESP32, Node-RED và MQTTX phải dùng cùng giá trị này.
constexpr uint32_t WIFI_RETRY_MS = 10000;  /// Mất Wi-Fi thì thử kết nối lại mỗi 10 giây (NFR3).
constexpr uint32_t MQTT_RETRY_MS = 5000;  /// Mất broker thì thử kết nối lại mỗi 5 giây (NFR3).
constexpr uint32_t TELEMETRY_MS = 2000;  /// Chu kỳ heartbeat telemetry 2 giây (theo đồng hồ ESP32; trong Wokwi có thể chậm hơn thực tế).
/// ▲ project_config.h: gom mọi thông số kết nối vào một chỗ; đổi Wi-Fi/broker/topic chỉ cần sửa file này rồi build lại.
