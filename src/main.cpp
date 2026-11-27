#include <Arduino.h>  /// Lõi Arduino cho ESP32: kiểu dữ liệu, millis(), pinMode(), digitalRead/Write(), Serial.
#include <ctype.h>  /// isalnum(), isspace(), toupper(): kiểm tra và chuẩn hóa ký tự của lệnh.
#include <string.h>  /// strcmp/strncmp/strchr/strlen/memcpy: xử lý chuỗi C trên bộ đệm tĩnh, không dùng String động (NFR4).
#include <stdarg.h>  /// va_list/va_start/va_end: cho hàm appendJson nhận số tham số thay đổi như printf.
#include <WiFi.h>  /// Thư viện Wi-Fi của ESP32 (chỉ hỗ trợ băng 2,4 GHz).
#include <PubSubClient.h>  /// PubSubClient 2.8: client MQTT 3.1.1 (publish QoS 0, subscribe QoS 0/1, có LWT).
#include <esp_system.h>  /// esp_random(): bộ sinh số ngẫu nhiên phần cứng, dùng để tạo Client ID khác nhau mỗi lần khởi động.

#include "project_config.h"  /// Hằng số Wi-Fi, broker, tiền tố topic, chu kỳ thử lại và chu kỳ telemetry.

WiFiClient espClient;  /// Kết nối TCP thô; MQTT chạy bên trên lớp này.
PubSubClient client(espClient);  /// Đối tượng MQTT client, dùng espClient làm đường truyền.
void applyLed(uint8_t i, bool on);  /// Khai báo trước (prototype): applyLed được gọi trước chỗ định nghĩa.
bool handleCommand(char *line);  /// Khai báo trước: bộ xử lý lệnh dùng chung cho Serial và MQTT.
void publishSnapshot(bool fullState = true);  /// Khai báo trước: mặc định fullState=true → gửi đủ 10 topic trạng thái + telemetry.
// Ban nghiem thu: logic cuc bo + MQTT hai chieu + ACK va chong lenh lap.
constexpr uint32_t DEBOUNCE_MS = 300;  /// Lọc nhiễu: PIR phải HIGH liên tục ≥ 300 ms mới tính là chuyển động hợp lệ (FR1).
constexpr uint32_t DEFAULT_TIMEOUT_MS = 10000;  /// Thời gian giữ đèn mặc định 10 s sau chuyển động hợp lệ cuối cùng (FR2).
constexpr uint32_t NEIGHBOR_HOLD_MS = 5000;  /// Pre-light: vùng liền kề được giữ sáng 5 s (FR4).
uint32_t timeoutMs = DEFAULT_TIMEOUT_MS;  /// Thời gian giữ đang dùng; đổi được 3–300 s bằng lệnh TIMEOUT=X, không cần nạp lại firmware (FR3).
bool preLight = false;  /// Pre-light mặc định TẮT để demo đúng từng vùng.
constexpr uint32_t SCAN_MS = 20;  /// Chu kỳ quét PIR 20 ms (NFR1): độ trễ bật đèn ≈ 300 ms lọc + tối đa 20 ms quét.
constexpr uint8_t ZONE_COUNT = 3;  /// Mô hình kho có 3 vùng A, B, C.
constexpr uint8_t SERIAL_BUDGET = 32;  /// Mỗi vòng loop() chỉ đọc tối đa 32 ký tự Serial → không chặn việc quét PIR.

struct Zone {  /// Toàn bộ trạng thái của MỘT vùng kho.
  uint8_t pirPin, ledPin;  /// Chân GPIO đọc PIR và chân GPIO điều khiển relay của vùng.
  bool motionValid, lastRaw, ledState, manualOverride;  /// motionValid = đã qua lọc 300 ms; lastRaw = mức PIR lần quét trước; ledState = đèn đang bật; manualOverride = đang ở chế độ thủ công.
  uint32_t rawHighSince, lastMotionAt;  /// rawHighSince = lúc PIR vừa lên HIGH (để đếm 300 ms); lastMotionAt = lần cuối có chuyển động hợp lệ (để đếm thời gian giữ).
  bool ownHold, neighborHold;  /// ownHold = đèn đang giữ sáng do chính vùng này; neighborHold = đang giữ sáng do pre-light của vùng bên cạnh.
  uint32_t lastNeighborAt;  /// Lần cuối vùng bên cạnh còn chuyển động (đếm 5 s pre-light).
  uint64_t onMs;  /// Tổng số ms đèn vùng này đã sáng trong phiên (64 bit nên không tràn) → gửi lên dưới tên on_ms.
};

Zone zones[ZONE_COUNT] = {  /// Bảng 3 vùng: {chân PIR, chân relay, các cờ ban đầu = false, các mốc thời gian = 0}.
  // PIR OUT / relay IN active-HIGH (npn); COM-NO cap nguon LED qua 220 ohm.
  {23, 18, false, false, false, false, 0, 0},  /// Vùng A – lối kệ: PIR OUT → GPIO 23, relay IN ← GPIO 18 (LED đỏ).
  {22, 19, false, false, false, false, 0, 0},  /// Vùng B – khu phân loại: PIR → GPIO 22, relay ← GPIO 19 (LED vàng).
  {21,  5, false, false, false, false, 0, 0}  /// Vùng C – cửa xuất: PIR → GPIO 21, relay ← GPIO 5 (LED xanh). GPIO 5 là chân strapping, mạch thật đổi sang GPIO 25.
};

uint32_t lastScan = 0;  /// Mốc lần quét PIR gần nhất, so với SCAN_MS.
char cmd[32];  /// Bộ đệm dòng lệnh gõ trên Serial: tối đa 31 ký tự + '\0'.
uint8_t cmdIdx = 0;  /// Số ký tự đã gõ trong dòng hiện tại.
bool discardLine = false;  /// Dòng đang gõ bị lỗi (quá dài hoặc có ký tự lạ) → bỏ cả dòng khi Enter.
bool previousWasCR = false;  /// Nhớ ký tự '\r' vừa nhận để bỏ qua '\n' của cặp CRLF.

enum class EscapeState : uint8_t { NONE, START, CSI, SS3 };  /// Trạng thái giải mã chuỗi điều khiển ANSI của terminal (ví dụ phím Delete gửi ESC [ 3 ~).
EscapeState escapeState = EscapeState::NONE;  /// Ban đầu không ở trong chuỗi ESC nào.
char escapeParams[16];  /// Phần tham số của chuỗi CSI (ví dụ "3" của ESC [ 3 ~).
uint8_t escapeLength = 0;  /// Độ dài phần tham số đã nhận.
uint32_t escapeStartedAt = 0;  /// Thời điểm bắt đầu chuỗi ESC.
constexpr uint32_t ESCAPE_TIMEOUT_MS = 250;  /// Chuỗi ESC quá 250 ms chưa kết thúc thì hủy, tránh kẹt bộ giải mã.

// MQTT va Serial dung chung bo xu ly lenh; khong cap phat String dong.
bool stateDirty = true;  /// Cờ "trạng thái vừa đổi": cần gửi telemetry sớm (sau 100 ms) thay vì chờ heartbeat 2 s.
bool wifiReported = false;  /// Đã in thông báo Wi-Fi Connected chưa (tránh in lặp mỗi vòng).
bool mqttReported = false;  /// Tương tự cho MQTT.
uint32_t lastWifiAttempt = 0;  /// Mốc lần thử kết nối lại Wi-Fi (mỗi 10 s – NFR3).
uint32_t lastMqttAttempt = 0;  /// Mốc lần thử kết nối lại MQTT (mỗi 5 s – NFR3).
uint32_t lastTelemetry = 0;  /// Mốc lần gửi telemetry gần nhất.
char mqttClientId[40];  /// Client ID dạng dt45-<8 hex MAC>-<8 hex ngẫu nhiên>.

// QoS 1 co the giao lai command. Cache 8 ID gan nhat trong phien boot.
struct CommandReceipt {  /// Biên nhận của một lệnh có ID đã xử lý – dùng để chống thực hiện lặp khi QoS 1 giao lại (NFR2).
  char id[33];  /// ID lệnh, tối đa 32 ký tự + '\0'.
  char command[32];  /// Nội dung lệnh đã chuẩn hóa chữ hoa.
  bool accepted;  /// Lệnh đó có hợp lệ không (để trả lại đúng ACK cũ).
};
CommandReceipt receipts[8] = {};  /// Vòng đệm 8 biên nhận gần nhất trong phiên khởi động.
uint8_t receiptNext = 0;  /// Vị trí sẽ ghi biên nhận tiếp theo (0..7, quay vòng).
uint32_t usageLastAt = 0;  /// Mốc lần cộng dồn thời gian sáng gần nhất.
uint64_t sessionMs = 0;  /// Tổng thời gian phiên kể từ khi khởi động → session_ms.

// Cong don theo delta unsigned de van dung khi millis() quay vong.
void updateUsage(uint32_t now) {  /// Cộng thời gian trôi qua vào bộ đếm phiên và bộ đếm của từng đèn đang sáng.
  const uint32_t elapsed = now - usageLastAt;  /// Phép trừ số không dấu 32 bit: vẫn đúng khi millis() quay vòng sau ~49,7 ngày (NFR4, test T20).
  usageLastAt = now;  /// Dời mốc sang thời điểm hiện tại.
  sessionMs += elapsed;  /// Cộng vào thời gian phiên.
  for (auto &z : zones) if (z.ledState) z.onMs += elapsed;  /// Chỉ cộng cho đèn đang BẬT → on_ms dùng để ước tính mức tiết kiệm.
}
/// ▲ updateUsage(): cộng dồn thời gian phiên và thời gian sáng từng đèn; an toàn khi millis() quay vòng.

bool appendJson(char *buffer, size_t capacity, size_t &used, const char *format, ...) {  /// Ghi thêm chuỗi định dạng kiểu printf vào bộ đệm JSON tĩnh; trả false nếu sắp tràn.
  if (used >= capacity) return false;  /// Bộ đệm đã đầy → báo không vừa.
  va_list args;  /// Danh sách tham số biến đổi.
  va_start(args, format);  /// Bắt đầu đọc tham số sau 'format'.
  const int written = vsnprintf(buffer + used, capacity - used, format, args);  /// Ghi tiếp vào phần còn trống của bộ đệm.
  va_end(args);  /// Kết thúc đọc tham số.
  if (written < 0 || static_cast<size_t>(written) >= capacity - used) return false;  /// Lỗi định dạng hoặc bị cắt cụt → coi như không vừa, không gửi JSON hỏng.
  used += static_cast<size_t>(written);  /// Dời vị trí ghi.
  return true;  /// Ghi thành công.
}
/// ▲ appendJson(): ghép JSON vào bộ đệm tĩnh, phát hiện tràn – thay cho String/ArduinoJson để tránh phân mảnh heap.

bool publishSuffix(const char *suffix, const char *payload, bool retained = true) {  /// Publish một topic con dưới tiền tố của nhóm; mặc định retain = true.
  if (!client.connected()) return false;  /// Chưa kết nối broker → bỏ qua; logic đèn vẫn chạy tại ESP32.
  char topic[128];  /// Bộ đệm tên topic.
  snprintf(topic, sizeof(topic), "%s/%s", MQTT_PREFIX, suffix);  /// Ghép thành iot/nhom08/detai45/kho-c7e2/<suffix>.
  const bool ok = client.publish(topic, payload, retained);  /// Gửi QoS 0 (PubSubClient chỉ publish QoS 0); retained để client mới subscribe nhận ngay trạng thái cuối.
  if (!ok) Serial.printf("[MQTT] Publish failed: %s\r\n", topic);  /// Ghi log lỗi ra Serial.
  return ok;  /// Trả kết quả để hàm gọi biết có cần gửi lại không.
}
/// ▲ publishSuffix(): publish một topic con dưới tiền tố iot/nhom08/detai45/kho-c7e2.

void publishSnapshot(bool fullState) {  /// Gửi trạng thái: fullState = true gửi status + 9 topic vùng + telemetry; false chỉ gửi telemetry (heartbeat).
  if (!client.connected()) return;  /// Chưa có MQTT thì không gửi.
  updateUsage(millis());  /// Chốt bộ đếm thời gian sáng trước khi đóng gói số liệu.
  bool ok = true;  /// Gom kết quả của tất cả các lần publish.
  // Heartbeat chi can telemetry; cac topic retained con chi doi khi state doi.
  // Tranh gui lai 11 ban tin moi 2 giay qua gateway Wokwi.
  if (fullState) {  /// Chỉ gửi bộ topic retained khi trạng thái thật sự đổi.
    ok = publishSuffix("status", "online");  /// status = online (retained), đối xứng với bản tin LWT "offline".
    for (uint8_t i = 0; i < ZONE_COUNT; ++i) {  /// Duyệt 3 vùng.
      char suffix[32];  /// Bộ đệm phần đuôi topic.
      snprintf(suffix, sizeof(suffix), "zone%u/led", i + 1);  /// zoneN/led
      ok = publishSuffix(suffix, zones[i].ledState ? "ON" : "OFF") && ok;  /// Giá trị ON / OFF.
      snprintf(suffix, sizeof(suffix), "zone%u/motion", i + 1);  /// zoneN/motion
      ok = publishSuffix(suffix, zones[i].motionValid ? "MOTION_DETECTED" : "CLEAR") && ok;  /// Giá trị MOTION_DETECTED / CLEAR (sau lọc 300 ms).
      snprintf(suffix, sizeof(suffix), "zone%u/mode", i + 1);  /// zoneN/mode
      ok = publishSuffix(suffix, zones[i].manualOverride ? "MANUAL" : "AUTO") && ok;  /// Giá trị MANUAL / AUTO.
    }
  }
  char payload[896];  /// Bộ đệm JSON tĩnh 896 byte – không cấp phát động.
  size_t used = 0;  /// Số byte đã ghi.
  bool fits = appendJson(payload, sizeof(payload), used,  /// Phần đầu JSON telemetry:
      "{\"device\":\"%s\",\"uptime_ms\":%lu,\"timeout_ms\":%lu,\"prelight_enabled\":%s,\"prelight_hold_ms\":%lu,\"session_ms\":%llu,\"zones\":[",  /// device, uptime_ms, timeout_ms, prelight_enabled, prelight_hold_ms, session_ms, rồi mở mảng zones.
      mqttClientId, static_cast<unsigned long>(millis()), static_cast<unsigned long>(timeoutMs),  /// Client ID, thời gian chạy, thời gian giữ hiện tại.
      preLight ? "true" : "false", static_cast<unsigned long>(NEIGHBOR_HOLD_MS),  /// Trạng thái pre-light và thời gian giữ của pre-light.
      static_cast<unsigned long long>(sessionMs));  /// Tổng thời gian phiên (64 bit).
  for (uint8_t i = 0; i < ZONE_COUNT; ++i) {  /// Thêm từng vùng vào mảng zones.
    const Zone &z = zones[i];  /// Tham chiếu tới vùng i (không sao chép).
    fits = appendJson(payload, sizeof(payload), used,  /// Phần tử JSON của 1 vùng:
        "%s{\"id\":%u,\"pir\":%u,\"motion\":%s,\"led\":%s,\"mode\":\"%s\",\"on_ms\":%llu}",  /// id, pir (0/1 – mức thô), motion (đã lọc), led, mode, on_ms.
        i ? "," : "", i + 1, z.lastRaw ? 1 : 0, z.motionValid ? "true" : "false",  /// Dấu phẩy ngăn cách từ vùng thứ 2; id bắt đầu từ 1.
        z.ledState ? "true" : "false", z.manualOverride ? "MANUAL" : "AUTO",  /// Trạng thái đèn và chế độ.
        static_cast<unsigned long long>(z.onMs)) && fits;  /// Thời gian đèn đã sáng; '&& fits' giữ lại lỗi nếu có vùng nào không vừa.
  }
  fits = appendJson(payload, sizeof(payload), used, "]}") && fits;  /// Đóng mảng và đối tượng JSON.
  ok = fits && publishSuffix("telemetry", payload) && ok;  /// Chỉ publish khi JSON trọn vẹn; telemetry là topic retained.
  stateDirty = !ok;  /// Gửi lỗi → giữ cờ stateDirty để thử lại ở vòng sau.
  lastTelemetry = millis();  /// Mốc heartbeat tiếp theo tính từ đây.
  Serial.printf("[MQTT] TX telemetry %s\r\n", ok ? "OK" : "FAILED");  /// Log ra Serial để quan sát trong Wokwi.
}
/// ▲ publishSnapshot(): gửi trạng thái lên broker. Heartbeat 2 s chỉ gửi telemetry; khi có thay đổi gửi thêm status và 9 topic vùng.
///   Telemetry mẫu: {"device":"dt45-…","uptime_ms":53116,"timeout_ms":10000,"prelight_enabled":false,"prelight_hold_ms":5000,
///                  "session_ms":53100,"zones":[{"id":1,"pir":1,"motion":true,"led":true,"mode":"AUTO","on_ms":4200},…]}

void acknowledgeCommand(const char *id, const char *command, bool accepted, const char *reason) {  /// Gửi ACK (xác nhận) cho một lệnh lên topic event.
  char event[224];  /// Bộ đệm JSON của ACK.
  snprintf(event, sizeof(event),  /// Định dạng JSON:
      "{\"type\":\"command\",\"result\":\"%s\",\"id\":\"%s\",\"command\":\"%s\",\"reason\":\"%s\",\"uptime_ms\":%lu}",  /// type = command, result, id, command, reason, uptime_ms.
      accepted ? "OK" : "ERROR", id, accepted ? command : "", reason,  /// OK hoặc ERROR; nếu lỗi thì không lặp lại nội dung lệnh.
      static_cast<unsigned long>(millis()));  /// Thời điểm ESP32 xử lý.
  publishSuffix("event", event, false);  /// retain = false: ACK chỉ có ý nghĩa tức thời, không để broker lưu lại.
}
/// ▲ acknowledgeCommand(): ACK mẫu {"type":"command","result":"OK","id":"c-mvapjamd-3","command":"OFF1","reason":"","uptime_ms":53116}.

void mqttCallback(char *topic, byte *payload, unsigned int length) {  /// Callback PubSubClient gọi khi broker giao bản tin của topic đã subscribe.
  char commandTopic[128];  /// Topic lệnh mong đợi.
  snprintf(commandTopic, sizeof(commandTopic), "%s/command/all", MQTT_PREFIX);  /// iot/nhom08/detai45/kho-c7e2/command/all
  if (strcmp(topic, commandTopic)) return;  /// Topic khác → bỏ qua.
  // PubSubClient dung chung buffer RX/TX: copy truoc khi publish trong callback.
  char packet[96];  /// Sao chép payload ra bộ đệm riêng vì PubSubClient dùng chung buffer nhận/gửi.
  char id[33] = "";  /// ID lệnh; rỗng nếu lệnh gửi tay không có ID (ví dụ ON1 từ MQTTX).
  if (!length || length >= sizeof(packet)) {  /// Payload rỗng hoặc ≥ 96 byte → từ chối.
    Serial.println("[MQTT] ERROR: invalid packet length.");  /// Log lỗi.
    acknowledgeCommand("", "", false, "length");  /// ACK lỗi với lý do "length".
    return;
  }
  for (unsigned int i = 0; i < length; ++i) {  /// Kiểm tra từng byte của payload.
    if ((payload[i] < 32 && payload[i] != '\t' && payload[i] != '\r' && payload[i] != '\n') || payload[i] > 126) {  /// Chỉ nhận ký tự ASCII in được (32–126) và tab/CR/LF → chặn dữ liệu rác hoặc nhị phân.
      Serial.println("[MQTT] ERROR: invalid payload byte.");  /// Log lỗi.
      acknowledgeCommand("", "", false, "encoding");  /// ACK lỗi "encoding".
      return;
    }
    packet[i] = static_cast<char>(payload[i]);  /// Byte hợp lệ → chép vào bộ đệm.
  }
  packet[length] = '\0';  /// Kết thúc chuỗi C.
  char *command = packet;  /// Mặc định cả payload là lệnh (dạng cũ ON1).
  // Lenh cu: ON1. Dashboard moi: CMD|<id ASCII toi da 32>|ON1.
  if (!strncmp(packet, "CMD|", 4)) {  /// Dạng mới từ Node-RED: CMD|<id>|<lệnh>.
    char *separator = strchr(packet + 4, '|');  /// Tìm dấu '|' thứ hai.
    const size_t idLength = separator ? static_cast<size_t>(separator - (packet + 4)) : 0;  /// Độ dài phần ID.
    if (!separator || !idLength || idLength >= sizeof(id)) {  /// Không có ID hoặc ID dài quá 32 ký tự → lỗi.
      acknowledgeCommand("", "", false, "id");  /// ACK lỗi "id".
      return;
    }
    for (size_t i = 0; i < idLength; ++i) {  /// Kiểm tra từng ký tự của ID.
      const unsigned char c = static_cast<unsigned char>(packet[4 + i]);  /// Lấy ký tự thứ i của ID.
      if (!isalnum(c) && c != '-' && c != '_') {  /// ID chỉ gồm chữ, số, '-' hoặc '_' → chặn ký tự lạ.
        acknowledgeCommand("", "", false, "id");  /// ACK lỗi "id".
        return;
      }
    }
    memcpy(id, packet + 4, idLength);  /// Chép ID ra biến riêng.
    id[idLength] = '\0';  /// Kết thúc chuỗi ID.
    command = separator + 1;  /// Phần sau dấu '|' là lệnh.
  }
  if (!*command || strlen(command) >= 32) {  /// Lệnh rỗng hoặc ≥ 32 ký tự → lỗi.
    acknowledgeCommand(id, "", false, "length");  /// ACK lỗi "length" (có kèm ID để Node-RED ghép đúng lệnh).
    return;
  }
  while (*command && isspace(static_cast<unsigned char>(*command))) ++command;  /// Bỏ khoảng trắng đầu lệnh.
  size_t commandLength = strlen(command);  /// Độ dài lệnh.
  while (commandLength && isspace(static_cast<unsigned char>(command[commandLength - 1]))) command[--commandLength] = '\0';  /// Bỏ khoảng trắng cuối lệnh.
  char message[32];  /// Bản sao lệnh để chuẩn hóa.
  snprintf(message, sizeof(message), "%s", command);  /// Chép lệnh.
  for (size_t i = 0; i < commandLength; ++i) message[i] = static_cast<char>(toupper(static_cast<unsigned char>(message[i])));  /// Chuyển sang chữ hoa: on1 = ON1.
  Serial.printf("[MQTT] RX %s = %s (id=%s)\r\n", commandTopic, message, id);  /// Log lệnh nhận được.
  if (!strcmp(message, "ON")) snprintf(message, sizeof(message), "ALL_ON");  /// Tương thích lệnh cũ: ON = ALL_ON.
  if (!strcmp(message, "OFF")) snprintf(message, sizeof(message), "ALL_OFF");  /// OFF = ALL_OFF.
  if (*id) {  /// Lệnh có ID → kiểm tra trùng.
    for (const auto &receipt : receipts) {  /// Duyệt 8 biên nhận gần nhất.
      if (strcmp(receipt.id, id)) continue;  /// Khác ID → xét biên nhận khác.
      if (strcmp(receipt.command, message)) {  /// Cùng ID nhưng khác nội dung lệnh →
        acknowledgeCommand(id, message, false, "id_conflict");  /// xung đột ID, KHÔNG thực hiện.
      } else {
        acknowledgeCommand(id, message, receipt.accepted, receipt.accepted ? "duplicate" : "unknown_command");  /// Cùng ID, cùng lệnh (QoS 1 giao lại) → trả lại ACK cũ với lý do "duplicate", KHÔNG thực hiện lại.
        publishSnapshot();  /// Gửi lại trạng thái để Node-RED đồng bộ.
      }
      return;  /// Đã xử lý xong lệnh trùng.
    }
  }
  const bool accepted = handleCommand(message);  /// Thực hiện lệnh (cùng hàm với Serial).
  if (*id) {  /// Lệnh có ID → lưu biên nhận.
    auto &receipt = receipts[receiptNext];  /// Ô kế tiếp trong vòng đệm.
    snprintf(receipt.id, sizeof(receipt.id), "%s", id);  /// Lưu ID.
    snprintf(receipt.command, sizeof(receipt.command), "%s", message);  /// Lưu nội dung lệnh.
    receipt.accepted = accepted;  /// Lưu kết quả.
    receiptNext = (receiptNext + 1) % 8;  /// Tăng vị trí, quay vòng sau 8 ô.
  }
  acknowledgeCommand(id, message, accepted, accepted ? "" : "unknown_command");  /// Gửi ACK: OK, hoặc ERROR "unknown_command".
  if (accepted) publishSnapshot();  /// Thành công → gửi ngay trạng thái mới để dashboard cập nhật.
}
/// ▲ mqttCallback(): nhận lệnh từ topic command/all → kiểm tra độ dài, ký tự, ID → chống lặp bằng 8 ID gần nhất
///   → thực hiện lệnh → gửi ACK lên topic event → gửi trạng thái mới. Mỗi lệnh luôn có đúng một ACK.

void maintainNetwork(uint32_t now) {  /// Giữ kết nối Wi-Fi và MQTT; không bao giờ đứng chờ (không while/delay).
  if (WiFi.status() != WL_CONNECTED) {  /// Chưa có Wi-Fi:
    if (wifiReported) {  /// vừa mới mất Wi-Fi →
      Serial.println("[WiFi] Disconnected; local PIR/Serial control continues.");  /// báo một lần: logic PIR và lệnh Serial vẫn chạy tại chỗ.
      wifiReported = false;  /// Đặt lại cờ báo.
      mqttReported = false;  /// MQTT cũng coi như mất.
      espClient.stop();  /// Đóng socket TCP cũ.
      stateDirty = true;  /// Khi có mạng lại sẽ gửi đầy đủ trạng thái.
    }
    if (static_cast<uint32_t>(now - lastWifiAttempt) >= WIFI_RETRY_MS) {  /// Đủ 10 s kể từ lần thử trước →
      lastWifiAttempt = now;  /// ghi mốc thử,
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);  /// gọi kết nối lại (không đứng chờ kết quả),
      Serial.println("[WiFi] Retry connection.");  /// log.
    }
    return;  /// Thoát ngay: loop() vẫn quét PIR → đèn vẫn bật/tắt khi mất mạng (fail-safe, test M04).
  }
  if (!wifiReported) {  /// Vừa có Wi-Fi:
    wifiReported = true;  /// đặt cờ đã báo,
    Serial.println("[WiFi] Connected.");  /// log,
    lastMqttAttempt = now - MQTT_RETRY_MS;  /// lùi mốc để thử MQTT ngay, không chờ 5 s.
  }
  if (!client.connected()) {  /// Chưa kết nối broker:
    if (mqttReported) {  /// vừa mới mất broker →
      Serial.println("[MQTT] Disconnected; retry every 5 seconds.");  /// báo một lần.
      mqttReported = false;
      stateDirty = true;  /// Cần gửi lại trạng thái khi kết nối lại.
    }
    if (static_cast<uint32_t>(now - lastMqttAttempt) < MQTT_RETRY_MS) return;  /// Chưa đủ 5 s kể từ lần thử trước → chờ vòng sau.
    lastMqttAttempt = now;  /// Ghi mốc thử.
    char statusTopic[128], commandTopic[128];  /// Hai bộ đệm tên topic.
    snprintf(statusTopic, sizeof(statusTopic), "%s/status", MQTT_PREFIX);  /// Topic status – dùng làm topic LWT.
    snprintf(commandTopic, sizeof(commandTopic), "%s/command/all", MQTT_PREFIX);  /// Topic nhận lệnh.
    Serial.printf("[MQTT] Connecting to %s:%u as %s\r\n", MQTT_HOST, MQTT_PORT, mqttClientId);  /// Log broker và Client ID.
    if (!client.connect(mqttClientId, statusTopic, 1, true, "offline")) {  /// connect(ClientID, willTopic, willQoS = 1, willRetain = true, willMessage = "offline"): ESP32 rớt đột ngột thì broker tự gửi "offline".
      Serial.printf("[MQTT] Connect failed, rc=%d\r\n", client.state());  /// In mã lỗi (rc) để chẩn đoán.
      return;
    }
    if (!client.subscribe(commandTopic, 1)) {  /// Đăng ký nhận lệnh với QoS 1 (đảm bảo giao ít nhất 1 lần).
      Serial.println("[MQTT] Subscribe failed.");  /// Log lỗi.
      client.disconnect();  /// Ngắt kết nối để vòng sau thử lại từ đầu.
      return;
    }
    mqttReported = true;  /// Đánh dấu đã kết nối.
    Serial.printf("[MQTT] Connected; SUB %s\r\n", commandTopic);  /// Log đúng dòng mà hướng dẫn demo yêu cầu quan sát.
    publishSnapshot();  /// Vừa kết nối → gửi trạng thái đầy đủ (đồng bộ lại sau khi mất mạng, test M05).
  }
  client.loop();  /// Xử lý bản tin đến và gói keep-alive.
  const uint32_t elapsed = static_cast<uint32_t>(millis() - lastTelemetry);  /// Thời gian từ lần gửi telemetry trước.
  if ((stateDirty && elapsed >= 100) || elapsed >= TELEMETRY_MS) {  /// Có thay đổi và đã qua 100 ms (gom nhiều thay đổi liền nhau) HOẶC đủ 2 s heartbeat:
    publishSnapshot(stateDirty);  /// có thay đổi thì gửi đầy đủ, chỉ là heartbeat thì gửi mỗi telemetry.
  }
}
/// ▲ maintainNetwork(): tự kết nối lại Wi-Fi mỗi 10 s, MQTT mỗi 5 s; đăng ký LWT; gửi telemetry khi đổi trạng thái hoặc mỗi 2 s.
///   Hàm luôn trả về ngay nên mất mạng không làm chậm việc quét PIR.

void clearInputLine() {  /// Xóa dòng lệnh đang gõ (Ctrl+U, Ctrl+C).
  cmdIdx = 0;  /// Về đầu bộ đệm.
  cmd[0] = '\0';  /// Chuỗi rỗng.
  discardLine = false;  /// Bỏ cờ lỗi dòng.
  escapeState = EscapeState::NONE;  /// Hủy chuỗi ESC dang dở.
  escapeLength = 0;  /// Xóa tham số ESC.
  Serial.printf("\r\033[2K");  /// \r\033[2K: mã ANSI đưa con trỏ về đầu dòng và xóa dòng trên terminal.
}
/// ▲ clearInputLine(): đưa bộ nhập Serial về trạng thái sạch.

void eraseInputCharacter() {  /// Xử lý phím Backspace.
  if (discardLine) {  /// Dòng đang lỗi →
    clearInputLine();  /// xóa cả dòng.
  } else if (cmdIdx > 0) {  /// Còn ký tự →
    cmd[--cmdIdx] = '\0';  /// bỏ ký tự cuối,
    Serial.printf("\b \b");  /// "\b \b": lùi, ghi đè dấu cách, lùi lại → xóa ký tự trên màn hình.
  }
}
/// ▲ eraseInputCharacter(): xóa một ký tự khi nhấn Backspace/Delete.

bool consumeTerminalSequence(char c) {  /// Nhận diện chuỗi ESC (phím mũi tên, Delete...) để không lẫn vào nội dung lệnh. Trả true nếu ký tự đã được "nuốt".
  if (escapeState == EscapeState::NONE) {  /// Chưa ở trong chuỗi ESC:
    if (c != '\033') return false;  /// không phải ESC → để readSerialCommands xử lý như ký tự thường.
    escapeState = EscapeState::START;  /// Bắt đầu chuỗi ESC.
    escapeLength = 0;  /// Xóa tham số.
    escapeStartedAt = millis();  /// Ghi mốc để hủy nếu quá 250 ms.
    return true;  /// Đã nuốt ký tự ESC.
  }
  if (escapeState == EscapeState::START) {  /// Ký tự ngay sau ESC:
    if (c == '[' || c == 'O') {  /// '[' = CSI, 'O' = SS3 →
      escapeState = c == '[' ? EscapeState::CSI : EscapeState::SS3;  /// chuyển sang đọc tham số.
      return true;
    }
    escapeState = EscapeState::NONE;  /// Không phải chuỗi hợp lệ → hủy.
    return false;
  }
  const unsigned char value = static_cast<unsigned char>(c);  /// Ký tự trong phần thân chuỗi.
  if (value >= 0x40 && value <= 0x7e) {  /// 0x40–0x7E là ký tự kết thúc chuỗi.
    escapeParams[escapeLength] = '\0';  /// Kết thúc chuỗi tham số.
    if (escapeState == EscapeState::CSI && c == '~' && !strcmp(escapeParams, "3")) {  /// ESC [ 3 ~ = phím Delete →
      eraseInputCharacter();  /// xóa ký tự như Backspace.
    }
    escapeState = EscapeState::NONE;  /// Chuỗi đã kết thúc.
    return true;
  }
  if (value >= 0x20 && value <= 0x3f && escapeLength < sizeof(escapeParams) - 1) {  /// 0x20–0x3F là ký tự tham số (số, ';'...), còn chỗ thì
    escapeParams[escapeLength++] = c;  /// lưu lại.
    return true;
  }
  escapeState = EscapeState::NONE;  /// Ký tự lạ → hủy chuỗi.
  return false;
}
/// ▲ consumeTerminalSequence(): máy trạng thái nhỏ giải mã chuỗi ESC của terminal (NONE → START → CSI/SS3 → kết thúc).

void applyLed(uint8_t i, bool on) {  /// Bật/tắt relay của vùng i; chỉ ghi chân GPIO khi trạng thái thật sự đổi.
  Zone &z = zones[i];  /// Tham chiếu tới vùng.
  if (z.ledState != on) {  /// Chỉ xử lý khi đổi → không ghi GPIO và log lặp mỗi 20 ms.
    updateUsage(millis());  /// Chốt thời gian sáng trước khi đổi trạng thái.
    z.ledState = on;  /// Ghi trạng thái mới.
    digitalWrite(z.ledPin, on ? HIGH : LOW);  /// GPIO HIGH → relay kích mức cao đóng tiếp điểm COM–NO → đèn sáng; LOW → tắt.
    Serial.printf("[%lu ms] Zone %u LED %s\r\n",  /// Log thời điểm đổi đèn (dùng đối chiếu khi kiểm thử).
                  static_cast<unsigned long>(millis()), i + 1, on ? "ON" : "OFF");  /// Thời điểm, số vùng, ON/OFF.
    
    stateDirty = true;  /// Cần gửi telemetry sớm.
  }
}
/// ▲ applyLed(): điểm DUY NHẤT ghi chân relay; mọi thay đổi đèn (PIR, lệnh tay, AUTO) đều đi qua đây.

void printHelp() {  /// In danh sách lệnh lên Serial (lệnh HELP và lúc khởi động).
  Serial.println("Lenh: AUTO | ON1/OFF1 | ON2/OFF2 | ON3/OFF3 | ALL_ON | ALL_OFF | STATUS | HELP");  /// Lệnh điều khiển.
  Serial.println("Cau hinh: TIMEOUT=3..300 (giay) | PRELIGHT_ON | PRELIGHT_OFF; reset khi khoi dong lai.");  /// Lệnh cấu hình.
}
/// ▲ printHelp(): danh sách lệnh Serial.

void printStatus() {  /// In trạng thái hiện tại (lệnh STATUS).
  Serial.printf("[%lu ms] STATUS\r\n", static_cast<unsigned long>(millis()));  /// Thời điểm.
  Serial.printf("TIMEOUT=%lus PRELIGHT=%s\r\n", static_cast<unsigned long>(timeoutMs / 1000), preLight ? "ON" : "OFF");  /// Thời gian giữ và pre-light.
  for (uint8_t i = 0; i < ZONE_COUNT; ++i) {  /// Từng vùng:
    const Zone &z = zones[i];  /// tham chiếu vùng,
    Serial.printf("Zone %u: PIR=%u VALID=%u LED=%s MODE=%s\r\n",  /// mức PIR thô, chuyển động đã lọc,
                  i + 1, z.lastRaw ? 1 : 0, z.motionValid ? 1 : 0,  /// giá trị tương ứng,
                  z.ledState ? "ON" : "OFF", z.manualOverride ? "MANUAL" : "AUTO");  /// đèn và chế độ.
  }
}
/// ▲ printStatus(): in trạng thái 3 vùng ra Serial.

bool handleCommand(char *line) {  /// Bộ xử lý lệnh dùng chung cho Serial và MQTT; trả true nếu lệnh hợp lệ và đã thực hiện.
  while (*line && isspace(static_cast<unsigned char>(*line))) ++line;  /// Bỏ khoảng trắng đầu.
  size_t length = strlen(line);  /// Độ dài.
  while (length && isspace(static_cast<unsigned char>(line[length - 1]))) {  /// Bỏ khoảng trắng cuối.
    line[--length] = '\0';  /// Cắt ký tự cuối.
  }
  if (!length) return false;  /// Dòng rỗng → không hợp lệ.
  for (size_t i = 0; i < length; ++i) {  /// Chuyển sang chữ hoa.
    line[i] = static_cast<char>(toupper(static_cast<unsigned char>(line[i])));  /// Từng ký tự.
  }

  if (!strcmp(line, "AUTO")) {  /// AUTO: trả cả 3 vùng về điều khiển theo PIR.
    const uint32_t now = millis();  /// Mốc thời gian hiện tại.
    for (uint8_t i = 0; i < ZONE_COUNT; ++i) {  /// Từng vùng:
      Zone &z = zones[i];  /// tham chiếu vùng,
      if (z.manualOverride && z.ledState) { z.lastMotionAt = now; z.ownHold = true; }  /// vùng đang bật tay → giữ thêm một khoảng thời gian giữ rồi mới tắt, tránh tắt đột ngột khi còn người.
      z.manualOverride = false;  /// Xóa cờ thủ công.
    }
    Serial.println(">> AUTO: Cả 3 vùng về chế độ tự động.");  /// Phản hồi trên Serial.
  } else if (!strcmp(line, "ALL_ON") || !strcmp(line, "ALL_OFF")) {  /// ALL_ON / ALL_OFF:
    const bool on = !strcmp(line, "ALL_ON");  /// bật hay tắt,
    for (uint8_t i = 0; i < ZONE_COUNT; ++i) {  /// cho cả 3 vùng:
      zones[i].manualOverride = true;  /// chuyển sang thủ công (PIR không còn quyết định đèn),
      applyLed(i, on);  /// bật/tắt đèn.
    }
  } else if (length == 3 && !strncmp(line, "ON", 2) && line[2] >= '1' && line[2] <= '3') {  /// ON1..ON3:
    const uint8_t i = line[2] - '1';  /// đổi '1'..'3' thành chỉ số 0..2,
    zones[i].manualOverride = true;  /// vùng đó sang thủ công,
    applyLed(i, true);  /// bật đèn.
  } else if (length == 4 && !strncmp(line, "OFF", 3) && line[3] >= '1' && line[3] <= '3') {  /// OFF1..OFF3:
    const uint8_t i = line[3] - '1';  /// chỉ số vùng,
    zones[i].manualOverride = true;  /// sang thủ công,
    applyLed(i, false);  /// tắt đèn.
  } else if (!strncmp(line, "TIMEOUT=", 8)) {  /// TIMEOUT=X (giây):
    // Khong dung atol: tu choi so am, so thap phan, hau to va tran so.
    const char *digits = line + 8;  /// phần số sau dấu '=',
    uint32_t seconds = 0;  /// giá trị đang đọc.
    if (!*digits || strlen(digits) > 3) return false;  /// Rỗng hoặc hơn 3 chữ số → từ chối.
    for (; *digits; ++digits) {  /// Đọc từng chữ số:
      if (*digits < '0' || *digits > '9' || seconds > 300) return false;  /// chỉ nhận 0–9; chặn tràn số sớm.
      seconds = seconds * 10 + (*digits - '0');  /// Tích lũy giá trị thập phân.
    }
    if (seconds < 3 || seconds > 300) return false;  /// Ngoài 3–300 giây → từ chối.
    timeoutMs = seconds * 1000;  /// Áp dụng ngay, đổi sang ms.
  } else if (!strcmp(line, "PRELIGHT_ON") || !strcmp(line, "PRELIGHT_OFF")) {  /// PRELIGHT_ON / PRELIGHT_OFF:
    preLight = !strcmp(line, "PRELIGHT_ON");  /// bật/tắt tính năng,
    if (!preLight) for (auto &z : zones) z.neighborHold = false;  /// tắt thì bỏ ngay các giữ sáng do vùng bên cạnh.
  } else if (!strcmp(line, "STATUS")) {  /// STATUS:
    printStatus();  /// in trạng thái,
    stateDirty = true;  /// và gửi lại trạng thái lên MQTT.
  } else if (!strcmp(line, "HELP")) {  /// HELP:
    printHelp();  /// in danh sách lệnh.
  } else {  /// Lệnh khác:
    Serial.println(">> ERROR: Lenh khong hop le.");  /// báo lỗi trên Serial,
    return false;  /// trả false → ACK "unknown_command".
  }
  stateDirty = true;  /// Lệnh hợp lệ → cần gửi trạng thái mới.
  return true;  /// Thành công.
}
/// ▲ handleCommand(): AUTO | ALL_ON | ALL_OFF | ONx | OFFx | TIMEOUT=3..300 | PRELIGHT_ON/OFF | STATUS | HELP.
///   Thứ tự ưu tiên khi quyết định đèn: thủ công > (quy tắc kho vắng ở Node-RED gửi AUTO) > tự động theo PIR.

void readSerialCommands() {  /// Đọc lệnh gõ tay trong Serial Monitor của Wokwi mà không chặn vòng lặp.
  if (escapeState != EscapeState::NONE &&  /// Chuỗi ESC treo
      static_cast<uint32_t>(millis() - escapeStartedAt) >= ESCAPE_TIMEOUT_MS) {  /// quá 250 ms →
    escapeState = EscapeState::NONE;  /// hủy.
  }
  for (uint8_t count = 0; count < SERIAL_BUDGET && Serial.available() > 0; ++count) {  /// Đọc tối đa 32 ký tự mỗi vòng.
    const char c = static_cast<char>(Serial.read());  /// Đọc 1 ký tự.
    if (c == '\n' && previousWasCR) {  /// '\n' ngay sau '\r' (cặp CRLF) →
      previousWasCR = false;  /// bỏ qua,
      continue;
    }
    previousWasCR = c == '\r';  /// nhớ có phải '\r' không.
    if (c == 21 || c == 3) {  /// Ctrl+U (21) hoặc Ctrl+C (3) →
      clearInputLine();  /// xóa dòng.
      continue;
    }
    if (consumeTerminalSequence(c)) continue;  /// Ký tự thuộc chuỗi ESC đã được xử lý.
    if (c == '\n' || c == '\r') {  /// Enter:
      Serial.printf("\r\n");  /// xuống dòng trên terminal,
      if (discardLine) {  /// dòng có lỗi →
        Serial.println(">> ERROR: Lỗi dòng lệnh.");  /// báo lỗi,
      } else if (cmdIdx) {  /// có nội dung →
        cmd[cmdIdx] = '\0';  /// kết thúc chuỗi,
        handleCommand(cmd);  /// thực hiện lệnh.
      }
      cmdIdx = 0;  /// Sẵn sàng cho dòng mới.
      discardLine = false;  /// Bỏ cờ lỗi.
    } else if (c == '\b' || c == 127) {  /// Backspace (8) hoặc DEL (127) →
      eraseInputCharacter();  /// xóa ký tự.
    } else if (!discardLine) {  /// Ký tự thường, dòng chưa lỗi:
      const unsigned char value = static_cast<unsigned char>(c);  /// mã ký tự,
      if ((value < 32 && c != '\t') || value > 126 || cmdIdx >= sizeof(cmd) - 1) {  /// ký tự điều khiển lạ, ngoài ASCII hoặc dòng dài quá 31 ký tự →
        discardLine = true;  /// đánh dấu bỏ cả dòng,
        Serial.printf("\r\n>> INPUT ERROR (0x%02X): Backspace/Ctrl+U de nhap lai.\r\n", value);  /// hướng dẫn cách nhập lại.
      } else {
        cmd[cmdIdx++] = c;  /// Lưu ký tự,
        Serial.printf("%c", c == '\t' ? ' ' : c);  /// echo lên terminal (tab hiện thành dấu cách).
      }
    }
  }
}
/// ▲ readSerialCommands(): bộ nhập dòng lệnh không chặn, có echo, Backspace, Delete, Ctrl+U và xử lý CRLF.

void scanZones(uint32_t now) {  /// Quét 3 PIR và quyết định đèn; được loop() gọi mỗi 20 ms.
  for (uint8_t i = 0; i < ZONE_COUNT; ++i) {  /// LƯỢT 1 – đọc cảm biến từng vùng:
    Zone &z = zones[i];  /// tham chiếu vùng,
    const bool raw = digitalRead(z.pirPin) == HIGH;  /// đọc mức PIR hiện tại,
    if (raw != z.lastRaw) {  /// PIR vừa đổi mức →
      Serial.printf("[%lu ms] Zone %u PIR=%u\r\n",  /// log thời điểm đổi,
                    static_cast<unsigned long>(now), i + 1, raw ? 1 : 0);
      if (raw) z.rawHighSince = now;  /// vừa lên HIGH → bắt đầu đếm 300 ms.
    }
    if (raw != z.lastRaw) stateDirty = true;  /// Đổi mức → cần báo trạng thái.
    z.lastRaw = raw;  /// Nhớ mức cho lần quét sau.

    const bool valid = raw && static_cast<uint32_t>(now - z.rawHighSince) >= DEBOUNCE_MS;  /// BỘ LỌC: hợp lệ khi HIGH liên tục ≥ 300 ms; phép trừ không dấu an toàn khi millis() tràn (test T02, T03).
    if (valid != z.motionValid) {  /// Trạng thái hợp lệ đổi →
      Serial.printf("[%lu ms] Zone %u VALID=%u\r\n",  /// log,
                    static_cast<unsigned long>(now), i + 1, valid ? 1 : 0);
      
      stateDirty = true;  /// cần báo trạng thái.
    }
    z.motionValid = valid;  /// Lưu kết quả lọc.
    if (valid) { z.lastMotionAt = now; z.ownHold = true; }  /// Còn chuyển động hợp lệ → làm mới mốc và bật cờ giữ sáng.
  }
  // Luot 2: chi nhin motion cua hang xom, khong nhin den -> khong bat day chuyen.  /// Chỉ xét chuyển động THẬT của hàng xóm, không xét đèn hàng xóm.
  for (uint8_t i = 0; i < ZONE_COUNT; ++i) {  /// LƯỢT 2 – quyết định đèn từng vùng:
    Zone &z = zones[i];  /// tham chiếu vùng,
    if (z.ownHold && static_cast<uint32_t>(now - z.lastMotionAt) >= timeoutMs) z.ownHold = false;  /// hết thời gian giữ kể từ chuyển động cuối → bỏ cờ giữ của chính vùng (test T06: còn sáng ở 9 999 ms, tắt ở 10 000 ms).
    const bool neighbor = (i > 0 && zones[i - 1].motionValid) ||  /// Vùng trước (i-1)
                          (i + 1 < ZONE_COUNT && zones[i + 1].motionValid);  /// hoặc vùng sau (i+1) có chuyển động hợp lệ.
    if (preLight && neighbor) { z.lastNeighborAt = now; z.neighborHold = true; }  /// Pre-light bật và hàng xóm có chuyển động → giữ sáng, ghi mốc.
    if (!preLight || static_cast<uint32_t>(now - z.lastNeighborAt) >= NEIGHBOR_HOLD_MS) z.neighborHold = false;  /// Pre-light tắt hoặc đã quá 5 s → bỏ giữ do hàng xóm.
    if (z.manualOverride) continue;  /// THỦ CÔNG ưu tiên cao nhất: PIR không được đổi đèn của vùng thủ công.
    applyLed(i, z.ownHold || z.neighborHold);  /// Đèn sáng nếu đang giữ do chính vùng HOẶC do hàng xóm; ngược lại tắt.
  }
}
/// ▲ scanZones(): lõi điều khiển tại biên (edge). Trạng thái một vùng: IDLE → DEBOUNCING (PIR HIGH < 300 ms)
///   → ACTIVE (HIGH ≥ 300 ms, đèn bật) → HOLD (hết chuyển động, giữ 10 s) → IDLE (tắt). PRELIGHT_HOLD: sáng 5 s do vùng bên cạnh.
///   MANUAL: lệnh tay ghi đè cho tới khi có AUTO.

void setup() {  /// Chạy một lần khi cấp điện hoặc khởi động lại.
  memset(receipts, 0, sizeof(receipts));  /// Xóa toàn bộ biên nhận ID.
  receiptNext = 0;  /// Về ô đầu.
  timeoutMs = DEFAULT_TIMEOUT_MS;  /// Thời gian giữ về mặc định 10 s.
  preLight = false;  /// Pre-light về tắt.
  sessionMs = 0;  /// Bộ đếm phiên về 0.
  usageLastAt = millis();  /// Mốc cộng dồn bắt đầu từ bây giờ.
  Serial.begin(115200);  /// Serial 115200 bps (tốc độ của Serial Monitor).
  for (uint8_t i = 0; i < ZONE_COUNT; ++i) {  /// Cấu hình chân từng vùng:
    zones[i].onMs = 0;  /// bộ đếm thời gian sáng về 0,
    zones[i].ownHold = zones[i].neighborHold = false;  /// bỏ các cờ giữ sáng,
    pinMode(zones[i].pirPin, INPUT_PULLDOWN);  /// PIR: INPUT_PULLDOWN → không có tín hiệu thì chân chắc chắn ở mức LOW.
    digitalWrite(zones[i].ledPin, LOW);  /// Ghi LOW TRƯỚC khi đặt OUTPUT để relay không nháy lúc khởi động.
    pinMode(zones[i].ledPin, OUTPUT);  /// Chân relay là đầu ra.
  }

  // Wokwi co the dung cung eFuse MAC cho nhieu mo phong. Nonce moi moi boot
  // tranh client takeover; giu nguyen ID nay khi reconnect trong cung phien.
  snprintf(mqttClientId, sizeof(mqttClientId), "dt45-%08lx-%08lx",  /// Client ID = dt45-<8 hex thấp của MAC>-<8 hex ngẫu nhiên>:
           static_cast<unsigned long>(ESP.getEfuseMac() & 0xffffffffULL),  /// phần MAC giúp nhận ra thiết bị,
           static_cast<unsigned long>(esp_random()));  /// phần ngẫu nhiên tránh 2 bản mô phỏng trùng MAC đá nhau khỏi broker.
  espClient.setTimeout(1); // TCP timeout 1s; DNS co the mat them thoi gian.  /// Không treo lâu khi mạng có vấn đề.
  client.setServer(MQTT_HOST, MQTT_PORT);  /// broker.emqx.io:1883.
  client.setCallback(mqttCallback);  /// Hàm nhận lệnh.
  client.setBufferSize(1024);  /// Bộ đệm 1024 byte, đủ cho telemetry (~600 byte).
  client.setSocketTimeout(1);  /// Timeout socket 1 s.
  client.setKeepAlive(15);  /// Keep-alive 15 s: broker phát hiện ESP32 rớt sau khoảng 1,5 × 15 s rồi gửi LWT.
  WiFi.mode(WIFI_STA);  /// Chế độ trạm (máy khách Wi-Fi).
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD); // Khong cho trong while/delay.  /// Gọi kết nối một lần, kết quả được kiểm tra trong maintainNetwork().
  lastWifiAttempt = millis();  /// Mốc thử Wi-Fi.
  lastMqttAttempt = millis() - MQTT_RETRY_MS;  /// Lùi mốc để thử MQTT ngay khi có Wi-Fi.
  lastTelemetry = millis();  /// Mốc heartbeat.
  lastScan = millis();  /// Mốc quét PIR.
  Serial.println("DT45 - Nhom 08 - Final MQTT + Node-RED Dashboard");  /// Banner khởi động.
  Serial.println("Serial input V3: ECHO ON");  /// Phiên bản bộ nhập Serial.
  Serial.printf("MQTT: %s:%u | prefix: %s\r\n", MQTT_HOST, MQTT_PORT, MQTT_PREFIX);  /// Broker và tiền tố topic đang dùng.
  printHelp();  /// In danh sách lệnh.
}
/// ▲ setup(): cấu hình chân, Client ID, MQTT (broker, callback, buffer, keep-alive) và Wi-Fi; không có vòng chờ nào.

void loop() {  /// Vòng lặp chính: không có delay(), mọi việc chạy theo mốc millis().
  updateUsage(millis());  /// Cộng dồn thời gian sáng.
  readSerialCommands();  /// Đọc lệnh Serial (tối đa 32 ký tự).
  const uint32_t now = millis();  /// Thời điểm hiện tại.
  if (static_cast<uint32_t>(now - lastScan) >= SCAN_MS) {  /// Đủ 20 ms kể từ lần quét trước →
    lastScan = now;  /// ghi mốc,
    scanZones(now);  /// quét PIR và quyết định đèn.
  }
  maintainNetwork(millis());  /// Duy trì Wi-Fi/MQTT và gửi telemetry; mất mạng không ảnh hưởng việc quét PIR.
}
/// ▲ loop(): chạy liên tục hàng nghìn lần mỗi giây; ba việc độc lập: đọc Serial, quét PIR mỗi 20 ms, duy trì mạng.
