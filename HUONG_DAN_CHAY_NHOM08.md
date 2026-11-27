# Hướng dẫn chạy đồ án chiếu sáng kho

> Mở file này trong VS Code, nhấn **Ctrl+Shift+V** để xem hướng dẫn có định dạng. Các lệnh bên dưới chạy trong terminal PowerShell ở thư mục project.

Nhóm 08   •   Đề tài 45   •   Dành cho máy Windows   •   Ngày 15 tháng 10 năm 2026

Làm lần lượt các bước trong tài liệu này để chạy mô phỏng 3 vùng chiếu sáng, nhận dữ liệu MQTT và điều khiển bằng dashboard. Cần có Internet khi chạy MQTT. Các dấu hiệu đạt ở mỗi bước là những gì cần quan sát trên máy của bạn.

### Các thành phần làm việc với nhau

| Thành phần | Vai trò |
| --- | --- |
| ESP32 trên Wokwi | Đọc 3 cảm biến PIR, điều khiển 3 relay và 3 LED đại diện cho đèn. |
| MQTT broker EMQX | Máy chủ trung gian chuyển dữ liệu và lệnh giữa ESP32 với máy tính. |
| MQTTX | Ứng dụng xem bản tin MQTT và thử gửi lệnh trực tiếp. |
| Node-RED | Nhận dữ liệu, gửi lệnh, chạy quy tắc và ghi nhật ký. |
| Dashboard | Giao diện người dùng do Node-RED cung cấp trong trình duyệt. |

### Chuẩn bị phần mềm lần đầu

1. Cài VS Code tại [code.visualstudio.com/download](https://code.visualstudio.com/download). Trong Extensions, cài PlatformIO IDE và Wokwi Simulator.

2. Cài Node.js 24 LTS tại [nodejs.org/en/download](https://nodejs.org/en/download). Cài xong, đóng rồi mở lại VS Code để terminal nhận Node.js và npm.

3. Cài MQTTX Desktop tại [mqttx.app](https://mqttx.app). MQTTX dùng để kiểm tra MQTT; dashboard vẫn chạy khi MQTTX đã đóng.

4. Với Wokwi, nhấn F1 → Wokwi: Request a new License, đăng nhập và làm theo trang kích hoạt. Xem [hướng dẫn Wokwi](https://docs.wokwi.com/vscode/getting-started) nếu chưa kích hoạt được.

5. Nhận nguyên thư mục code của nhóm. Trong VS Code chọn File → Open Folder → chọn Demo_Nhom08, rồi chọn Terminal → New Terminal.

Trong terminal PowerShell, kiểm tra các lệnh sau. Hai lệnh đầu cần in ra số phiên bản; lệnh cuối cần trả về True.

```
node --version
npm.cmd --version
Test-Path .\node-red\start.ps1
```

Máy của bạn có thể đặt project ở ổ C hoặc D. Chạy các lệnh trong tài liệu tại thư mục có platformio.ini, src và node-red; không cần dùng đúng đường dẫn của máy bạn khác.

## 1 Build và chạy mô phỏng Wokwi

### Build firmware

1. Chờ PlatformIO khởi tạo project và tải thư viện ở lần mở đầu tiên.

2. Nhấn F1 → PlatformIO: Build. Chờ terminal hiển thị SUCCESS. Nếu dùng PlatformIO terminal, có thể chạy pio run.

Sau khi build, phải có hai file dưới đây. Wokwi đã được cấu hình đọc đúng hai file này; không cần đổi wokwi.toml.

```
.pio\build\esp32doit-devkit-v1\firmware.bin
.pio\build\esp32doit-devkit-v1\firmware.elf
```

### Mở Wokwi và kiểm tra kết nối

3. Nhấn F1 → Wokwi: Start Simulator. Giữ mô phỏng chạy. Mạch hiện tại có 3 PIR bên trái, 3 relay và 3 LED đỏ, vàng, xanh cho vùng 1, 2, 3.

4. Mở phần terminal/Serial của Wokwi. Chờ xuất hiện các dòng tương tự dưới đây.

```
[WiFi] Connected.
[MQTT] Connected; SUB iot/nhom08/detai45/kho-c7e2/command/all
[MQTT] TX telemetry OK
```

Wi-Fi mô phỏng đã đặt là Wokwi-GUEST, mật khẩu trống. Telemetry là bản tin trạng thái gửi khoảng mỗi 2 giây. MQTT đang dùng broker.emqx.io, cổng 1883.

5. Bấm vào terminal Wokwi, gõ AUTO rồi Enter. Bấm cảm biến PIR vùng 1 → Simulate Motion. Đèn đỏ vùng 1 cần sáng; thử tương tự với 2 vùng còn lại.

PIR Wokwi mặc định giữ tín hiệu khoảng 5 giây. Firmware chỉ công nhận HIGH đủ 300 ms, rồi giữ đèn khoảng 10 giây sau chuyển động hợp lệ cuối cùng. Từ lúc bấm Simulate Motion đến lúc đèn tắt có thể khoảng 15 giây; dashboard cập nhật theo bản tin nhận được.

### Các lệnh có thể gõ trong Serial

| Lệnh rồi Enter | Tác dụng |
| --- | --- |
| ON1 / OFF1 | Bật hoặc tắt thủ công vùng 1. Vùng 2 và 3 dùng ON2/OFF2, ON3/OFF3. |
| ALL_ON / ALL_OFF | Bật hoặc tắt thủ công cả 3 vùng. |
| AUTO | Đưa cả 3 vùng về chế độ tự động theo PIR. |
| STATUS / HELP | Xem trạng thái hiện tại hoặc danh sách lệnh. |

Ở chế độ Thủ công, cảm biến không đổi trạng thái đèn. Sau khi thử ON/OFF, dùng AUTO để thử PIR tiếp. Mỗi lần sửa code phải build lại, dừng Wokwi và chạy mô phỏng lại.

## 2 Chạy Node RED và mở dashboard

### Khởi động bằng script của project

1. Trong VS Code, bấm dấu + ở vùng Terminal để mở thêm một terminal PowerShell. Giữ Wokwi tiếp tục chạy.

2. Chạy đúng lệnh sau tại thư mục project.

```
powershell -ExecutionPolicy Bypass -File .\node-red\start.ps1
```

Lần đầu, script tự cài Node-RED 4.1.7 vào .pio/node-red-runtime nên có thể mất vài phút. Máy cần Node.js, npm và Internet. Script tự nạp flows.json và chuẩn bị mã điều khiển; không cần cài Node-RED toàn cục hay gói node-red-dashboard.

3. Giữ terminal này mở. Chờ Node-RED báo Started flows. Terminal cũng in ba dòng bắt đầu như sau.

```
Node-RED: http://127.0.0.1:1880
Dashboard: http://127.0.0.1:1880/dashboard
Ma dieu khien dashboard:
```

Sau dấu hai chấm ở dòng Ma dieu khien dashboard là mã của phiên đang chạy. Cuộn terminal lên để tìm nếu dòng này đã trôi khỏi màn hình.

### Mở đúng địa chỉ

| Địa chỉ trên máy chạy Node-RED | Dùng để làm gì |
| --- | --- |
| http://127.0.0.1:1880/dashboard | Trang người dùng để xem cảm biến, đèn, quy tắc và nhật ký. |
| http://127.0.0.1:1880 | Trang biên tập flow Node-RED để xem các node và Debug. |

Dashboard của project dùng đường dẫn /dashboard. Địa chỉ 127.0.0.1 là máy đang mở trình duyệt; gửi riêng địa chỉ này cho bạn khác sẽ không mở được dashboard trên máy bạn.

### Mở quyền điều khiển

4. Mở Chrome hoặc Edge → nhập http://127.0.0.1:1880/dashboard. Ban đầu góc trên bên phải ghi Chỉ xem.

5. Bấm Mở điều khiển. Quay về terminal chạy Node-RED, sao chép chỉ chuỗi mã sau Ma dieu khien dashboard:, dán vào ô Mã điều khiển rồi bấm Mở điều khiển trong hộp thoại.

6. Đợi thông báo Thiết bị đang gửi dữ liệu và có trạng thái của đủ 3 vùng. Khi đã có quyền và dữ liệu trực tiếp, các nút bật/tắt mới dùng được.

Mã này do script tạo, không phải mật khẩu MQTT hay tài khoản Node-RED. Sau khi khởi động một phiên mới, lấy mã được in trong terminal hiện tại. Tải lại trang có thể cần nhập lại mã.

Dấu hiệu đạt: nhìn thấy trạng thái đèn, PIR và chế độ; gửi lệnh thành công và có dòng ESP32 đã xác nhận. Muốn dừng Node-RED, bấm Ctrl+C tại terminal đang chạy.

## 3 Thao tác trên dashboard

### Thử bật và tắt thủ công

1. Nếu quy tắc Tiết kiệm khi kho vắng đang bật, bấm Tắt quy tắc để thử thủ công trước.

2. Bấm Bật vùng 1. Vùng 1 chuyển sang Thủ công, LED đỏ ở Wokwi sáng. Dòng lệnh gần nhất cần chuyển sang ESP32 đã xác nhận.

3. Bấm Tắt vùng 1, rồi thử vùng 2 và 3. Có thể dùng Bật tất cả và Tắt tất cả để điều khiển cả kho.

Ba thẻ đầu trang lần lượt cho biết kết nối thiết bị, số vùng có chuyển động và số đèn đang sáng. Trạng thái sáng/tắt lấy từ ESP32; ACK nghĩa là ESP32 đã phản hồi lệnh.

### Thử tự động theo chuyển động

1. Bấm Tự động để đưa cả 3 vùng về AUTO.

2. Quay sang Wokwi, bấm PIR vùng 1 → Simulate Motion. Đèn vùng 1 sáng; vùng khác không tự sáng nếu không có chuyển động ở vùng đó.

3. Chờ PIR về 0, rồi chờ thêm khoảng 10 giây. Đèn cần tắt nếu không có chuyển động mới. Lặp lại cho vùng 2 và 3.

Khi chuyển từ Thủ công sang Tự động, đèn đang sáng có thể được giữ thêm tối đa khoảng 10 giây nếu kho vắng. Điều này là hành vi được cài trong firmware.

### Thử quy tắc tiết kiệm khi kho vắng

1. Tại Quy tắc tự động → Tiết kiệm khi kho vắng, đặt Thời gian vắng là 30, bấm Lưu thời gian rồi Bật quy tắc. Quy tắc này mặc định tắt mỗi lần khởi tạo flow.

2. Bấm Bật vùng 1 để có ít nhất một đèn bật thủ công. Chờ cả 3 PIR bằng 0 và Chuyển động đều không còn; không kích PIR thêm.

3. Quan sát dòng đếm vắng. Sau khoảng 30 giây đủ điều kiện, Node-RED gửi AUTO cho cả 3 vùng. Nhật ký hiện sự kiện tự động và ACK.

4. Nếu vẫn không có chuyển động, đèn đang sáng tắt sau thời gian giữ thêm khoảng 10 giây. Tổng thời gian từ lúc bật thủ công có thể dài hơn 40 giây nếu PIR chưa về 0.

Thời gian vắng cho phép từ 15 đến 300 giây. Có chuyển động hoặc thiếu dữ liệu trực tiếp sẽ làm lại/hủy đếm. Khi thử xong, tắt quy tắc nếu muốn giữ đèn ở chế độ thủ công.

### Thử mất kết nối và phục hồi

Khi thiết bị đang online, dừng Wokwi và giữ Node-RED chạy. Sau khoảng 15 giây không có dữ liệu mới, dashboard báo offline và khóa nút điều khiển đèn. Chạy lại Wokwi, chờ Wi-Fi/MQTT kết nối và dữ liệu mới; dashboard phải phục hồi. Trạng thái đèn khi khởi động lại có thể khác trước vì ESP32 đã khởi động lại.

> **Vì sao chờ 15 giây?** Wokwi thường chạy chậm hơn thời gian thực (xem % tốc độ ở góc mô phỏng; log của nhóm cho thấy khoảng 15–60%). ESP32 gửi telemetry mỗi 2 giây *mô phỏng*, nên thực tế có thể cách nhau 5–13 giây. Ngưỡng cũ 6 giây làm dashboard báo offline liên tục, từ chối lệnh và khiến quy tắc kho vắng không bao giờ đếm đủ. Muốn đổi ngưỡng, đặt biến môi trường trước khi chạy launcher, ví dụ `$env:DT45_LIVE_WINDOW_MS = '20000'` (tối thiểu 3000). Các thời gian ở ESP32 như giữ đèn 10 giây cũng tính theo thời gian mô phỏng, nên nhìn bằng đồng hồ thật sẽ dài hơn.

## 4 Kết nối và thử lệnh bằng MQTTX

MQTTX là công cụ thử riêng. Dashboard kết nối broker thông qua Node-RED, nên không cần mở MQTTX mới điều khiển được đèn. Khi thử phần này, giữ Wokwi chạy và tắt quy tắc tiết kiệm để dễ quan sát.

### Tạo kết nối

Mở MQTTX Desktop → bấm dấu + tạo kết nối → nhập các ô sau rồi bấm Connect.

| Ô trong MQTTX | Giá trị |
| --- | --- |
| Name | Nhom08_DeTai45 |
| Host | Chọn mqtt://, ô địa chỉ nhập broker.emqx.io |
| Port | 1883 |
| Client ID | Giữ mã tự sinh của MQTTX; mỗi máy dùng mã khác nhau. |
| Username và Password | Để trống cả hai. |
| SSL/TLS | Tắt. |
| MQTT Version | 3.1.1 |
| Auto Reconnect | Bật. |

### Đăng ký xem dữ liệu

Sau khi Connected, bấm New Subscription hoặc dấu + ở danh sách Subscription. Nhập topic sau, chọn QoS 1 rồi xác nhận.

```
iot/nhom08/detai45/kho-c7e2/#
```

Dấu # nhận tất cả topic phía dưới prefix của nhóm. Cần thấy telemetry cập nhật khoảng mỗi 2 giây. status=online hoặc một bản tin retained xuất hiện một lần chưa đủ chứng minh ESP32 vẫn đang chạy; hãy xem uptime_ms tăng qua các bản tin mới.

### Gửi lệnh từ MQTTX

Trong vùng Publish, chọn Plaintext. Nhập đúng topic dưới đây, QoS 1 và Retain OFF. Không thêm dấu ngoặc kép vào nội dung lệnh.

```
iot/nhom08/detai45/kho-c7e2/command/all
```

Gửi ON1 → đèn vùng 1 sáng; gửi OFF1 → đèn tắt; gửi AUTO → cả 3 vùng về tự động. Có thể thử ALL_ON và ALL_OFF.

Xem topic iot/nhom08/detai45/kho-c7e2/event: lệnh hợp lệ có result là OK. Telemetry và trạng thái đèn trên dashboard cũng cần đổi theo.

Lệnh Plaintext ON1 không có mã ID theo dõi như lệnh dashboard. Vì vậy vùng Lệnh gần nhất trên dashboard có thể không ghi lệnh MQTTX; hãy kiểm tra event và trạng thái thiết bị.

## 5 Xem flow và lấy nhật ký demo

### Quan sát Node RED

1. Mở http://127.0.0.1:1880. Tab flow có tên DT45 - Nhom08 - He thong hoan chinh đã được script nạp sẵn. Lần chạy bình thường không cần import lại hay bấm Deploy.

2. Bấm biểu tượng Debug ở thanh bên phải. Khi Wokwi online, xem TRANG THAI 3 VUNG, LENH DA GUI và LICH SU / ACK / RULE.

3. Muốn thử lệnh trong flow, bấm nút vuông nhỏ bên trái node Inject ON1 hoặc OFF1, rồi AUTO. Các lệnh Inject cũng yêu cầu có dữ liệu ESP32 trực tiếp trong 15 giây gần nhất.

Node BAT rule 30s và TAT rule 30s dùng để bật/tắt quy tắc từ flow. Dashboard đã có các nút tương đương, thuận tiện hơn khi trình diễn.

Nếu cần minh họa import và flow chưa tồn tại: menu ≡ → Import → chọn file node-red/flows.json → Import → Deploy. Giữ một bản flow điều khiển cùng prefix; nạp trùng có thể sinh lệnh lặp. Nếu dashboard thiếu mã quyền, quay lại dùng script start.ps1.

### Nhật ký và xác nhận lệnh

Cuối dashboard có Nhật ký sự kiện và nút Tải nhật ký phiên. Nút tải chỉ lấy phần nhật ký còn giữ trong bộ nhớ của phiên hiện tại; file được ghi liên tục nằm tại:

```
node-red\logs\events.jsonl
```

Mỗi dòng là một bản ghi JSON có thời gian và sự kiện. Có thể xem trong VS Code. Các sự kiện cần tìm khi demo gồm command_sent, command có result=OK, automation, DEVICE_OFFLINE và DEVICE_ONLINE.

Nếu một lệnh chưa có ACK sau 12 giây, dashboard cảnh báo timeout. Cảnh báo PIR HIGH kéo dài mặc định dùng ngưỡng 120 giây; có thể chỉnh trong **Cảnh báo & ca làm việc**. Đây là dấu hiệu cần kiểm tra, không kết luận cảm biến hỏng và không tự tắt đèn.

Muốn xem thống kê ACK và độ trễ của log bằng terminal:

```
node .\tools\log_summary.cjs .\node-red\logs\events.jsonl
```

### Các bước demo cho cả nhóm

Thực hiện và tự đánh dấu sau khi quan sát:

- [ ] Build SUCCESS, Wokwi có Wi-Fi/MQTT Connected và telemetry mới.

- [ ] MQTTX subscribe đúng prefix, thấy uptime_ms tăng; ON1/OFF1 có event OK.

- [ ] Dashboard online, nhập mã điều khiển và bật/tắt được từng vùng.

- [ ] AUTO hoạt động đúng 3 PIR; đèn tắt sau khoảng 10 giây kể từ hết chuyển động.

- [ ] Quy tắc 30 giây gửi AUTO khi có đèn thủ công và cả kho vắng.

- [ ] Dừng/chạy lại Wokwi làm dashboard báo offline rồi phục hồi; có nhật ký.

Khi kết thúc, tắt quy tắc, bấm Tự động rồi dừng Wokwi; Ctrl+C để dừng Node-RED và Disconnect trong MQTTX.

## 6 Xử lý lỗi và gửi project cho bạn

| Hiện tượng | Cách xử lý |
| --- | --- |
| node hoặc npm không được nhận diện | Cài Node.js 24 LTS, đóng/mở lại VS Code rồi kiểm tra node --version và npm.cmd --version. |
| Không tìm thấy start.ps1 | Mở đúng thư mục có platformio.ini và node-red. Dùng Test-Path .\node-red\start.ps1; cần ra True. |
| Không có firmware hoặc Wokwi chạy code cũ | PlatformIO: Build cho tới SUCCESS; dừng và mở lại Wokwi. Kiểm tra đường dẫn firmware.bin trong wokwi.toml. |
| Wokwi yêu cầu license | F1 → Wokwi: Request a new License; đăng nhập và hoàn tất kích hoạt theo trang Wokwi. |
| Node-RED báo EADDRINUSE hoặc port 1880 in use | Tìm terminal Node-RED đang chạy và Ctrl+C để dừng bản đó; chạy lại script project. Chỉ đóng tiến trình mà bạn biết là Node-RED của mình. |
| Mở /dashboard bị 404 hoặc thấy flow trống | Kiểm tra đúng cổng 1880 và script node-red/start.ps1. Bản Node-RED mở bằng lệnh node-red riêng có thể chưa nạp flow của nhóm. |
| Không thấy hoặc nhập sai mã điều khiển | Cuộn terminal đang chạy Node-RED lên tìm Ma dieu khien dashboard:. Chỉ lấy chuỗi mã phía sau dấu hai chấm của phiên hiện tại. |
| Dashboard offline hoặc nút bị mờ | Giữ Wokwi chạy, kiểm tra MQTT Connected và telemetry mới; sau đó mở quyền điều khiển. Dữ liệu cũ/retained hoặc sai định dạng không mở được điều khiển đèn. |
| MQTTX kết nối nhưng không thấy dữ liệu | Dùng đúng broker.emqx.io:1883, subscribe prefix có /#; kiểm tra Wokwi đang MQTT Connected. Nếu broker lỗi, kiểm tra Internet rồi chờ kết nối lại. |
| Bấm PIR mà đèn không đổi hoặc đèn chưa tắt | Đưa vùng về AUTO. Chờ PIR hết HIGH rồi thêm khoảng 10 giây. Ở Thủ công, PIR không thay đổi đèn. |
| Lệnh MQTTX không hoạt động | Publish vào /command/all đúng prefix; Plaintext ON1 hoặc OFF1, QoS 1, Retain OFF. Kiểm tra event và dữ liệu mới từ ESP32. |

### Wokwi báo TX telemetry OK nhưng dashboard vẫn offline

Trước tiên, kiểm tra có bạn hoặc cửa sổ khác đang chạy cùng project hay không. Firmware cũ tạo MQTT Client ID chỉ từ MAC của ESP32. Nếu các bản mô phỏng dùng cùng MAC, chúng sẽ trùng Client ID và có thể làm broker ngắt kết nối qua lại. Bản sửa ngày 16 tháng 10 năm 2026 bổ sung giá trị ngẫu nhiên mỗi lần khởi động để giảm nguy cơ trùng ID; ID được giữ nguyên khi kết nối lại trong cùng phiên. Các bản dùng chung topic vẫn có thể trộn dữ liệu và cùng nhận lệnh điều khiển.

Sau khi nhận bản sửa, build lại rồi dừng/chạy lại Wokwi. Dòng Connecting sẽ dùng ID dạng dt45-xxxxxxxx-xxxxxxxx. Nếu vẫn thấy esp32-dt45-100100c40a24, mô phỏng đang chạy firmware cũ. Bản sửa cũng chỉ gửi một bản tin telemetry ở mỗi nhịp khi trạng thái không đổi, giúp giảm lưu lượng qua gateway; vẫn gửi đủ các topic trạng thái khi có thay đổi hoặc kết nối lại.

1. Dừng các mô phỏng khác dùng cùng project, chỉ giữ một ESP32 Wokwi và một flow Node-RED điều khiển bộ topic của nhóm.
2. Dừng rồi chạy lại Wokwi đang giữ. Giữ Node-RED chạy và chờ khoảng 10 giây để có dữ liệu mới.
3. Kiểm tra dashboard cập nhật liên tục, tuổi dữ liệu thường chỉ vài giây. Nếu cần bật/tắt, bấm Mở điều khiển và nhập mã ở terminal Node-RED.

Dòng TX telemetry OK là kết quả gửi ở phía firmware; cần nhìn dữ liệu mới trên dashboard để xác nhận toàn bộ đường truyền đã hoạt động. Bản tin retained được broker lưu lại có thể vẫn xuất hiện khi ESP32 đã mất kết nối.

Nếu muốn nhiều máy chạy demo độc lập cùng lúc, mỗi bản cần Client ID và topic prefix riêng, đồng bộ giữa ESP32, Node-RED và MQTTX. Chỉ đổi Client ID vẫn có thể trộn dữ liệu nếu dùng chung topic.

### Gửi đúng các file cho máy khác

Gửi nguyên project có src, include, node-red, platformio.ini, diagram.json và wokwi.toml, kèm tài liệu này. Không chỉ gửi main.cpp. Có thể bỏ .pio khi chuyển máy vì PlatformIO sẽ build lại và start.ps1 sẽ cài Node-RED lại.

Project hiện chỉ mở dashboard trên máy chạy Node-RED vì settings.js dùng 127.0.0.1. Bạn nhận project cần chạy các bước trên máy của mình.

Chỉ chạy một mô phỏng ESP32 và một flow điều khiển cùng prefix tại một thời điểm. Nếu nhiều bạn chạy đồng thời, dữ liệu có thể xen lẫn; nên luân phiên chạy. Broker công cộng này phục vụ demo, không gửi thông tin nhạy cảm.

Thông số và thao tác được đối chiếu với code hiện tại. Hướng dẫn cài đặt tham khảo các trang chính thức bên dưới.

[Node.js phù hợp với Node-RED](https://nodered.org/docs/faq/node-versions)

[Kích hoạt Wokwi trong VS Code](https://docs.wokwi.com/vscode/getting-started)

[Thao tác cảm biến PIR Wokwi](https://docs.wokwi.com/parts/wokwi-pir-motion-sensor)

## 7 Thử nghiệm tuần 7 và tuần 8 theo kế hoạch của thầy

Đối chiếu sheet **Kế hoạch 10 tuần - 60h**, dòng tuần 7 và tuần 8: tuần 7 cần ít nhất **2 luật tự động và 1 tình huống bất thường/cảnh báo**, kèm bằng chứng thử nghiệm; tuần 8 cần **tích hợp đầu cuối hai chiều**. Hai tuần này không có yêu cầu bắt buộc giả lập tấn công mạng. Kiểm tra truy cập không có quyền là phần bảo mật bổ sung.

### Chuẩn bị trước khi thử

Giữ một Wokwi và một flow Node-RED cho bộ topic của nhóm. Mở dashboard, chờ thiết bị online, bấm **Mở điều khiển** rồi nhập mã từ terminal Node-RED. Tắt **Tiết kiệm khi kho vắng**, bấm **Tự động**, chờ cả 3 PIR về 0 và các đèn tắt để có trạng thái ban đầu rõ ràng.

### Tuần 7 kiểm tra luật tự động và tình huống lỗi

**Bài T7-1 — Luật đèn theo chuyển động tại ESP32**

1. Trên dashboard, bấm **Tự động**.
2. Trong Wokwi, bấm PIR vùng 1 → **Simulate Motion**.
3. Kiểm tra chỉ đèn vùng 1 bật. Không gửi ON1 trong bài này vì cần chứng minh cảm biến tự điều khiển đèn.
4. Không kích PIR thêm. Khi PIR hết HIGH, đợi khoảng 10 giây theo thời gian ESP32 để đèn tự tắt. Wokwi mặc định giữ PIR HIGH khoảng 5 giây, nên tổng thời gian từ lúc bấm có thể khoảng 15 giây mô phỏng; máy chạy mô phỏng chậm sẽ cần chờ lâu hơn ngoài thực tế.
5. Thử tương tự vùng 2 và vùng 3 để chứng minh các vùng hoạt động độc lập.

**Bài T7-2 — Luật tiết kiệm khi kho vắng tại Node-RED**

1. Trong **Tiết kiệm khi kho vắng**, đặt thời gian **30**, bấm **Lưu thời gian** và **Bật quy tắc**.
2. Bấm **Bật vùng 1** để có một đèn sáng ở chế độ **Thủ công**.
3. Giữ cả 3 PIR bằng 0 và không còn chuyển động. Quan sát đếm vắng trên dashboard.
4. Sau khoảng 30 giây đủ điều kiện, cả 3 vùng phải chuyển về **Tự động**; nhật ký có sự kiện `automation` và lệnh `AUTO` được ESP32 xác nhận.
5. Nếu kho vẫn vắng, đèn đang sáng tắt sau thời gian giữ thêm khoảng 10 giây của ESP32. Sau đó **Tắt quy tắc** để chuẩn bị bài tiếp theo.

**Bài T7-3 — Thiết bị ngừng gửi dữ liệu và tự phục hồi**

1. Khi dashboard đang online, bấm nút vuông **Stop** của Wokwi; giữ Node-RED chạy.
2. Chờ khoảng 6–8 giây. Dashboard phải báo mất kết nối, nút điều khiển đèn bị khóa và nhật ký có `DEVICE_OFFLINE`.
3. Chạy lại Wokwi. Sau khi nhận telemetry mới, dashboard phải online trở lại; nhật ký có `DEVICE_ONLINE`.

Bài T7-3 kiểm tra mất dữ liệu từ thiết bị. Dừng toàn bộ Wokwi cũng dừng ESP32, nên bài này không dùng để chứng minh cảm biến vẫn điều khiển đèn cục bộ khi chỉ mất mạng.

### Tuần 8 kiểm tra đường đi hai chiều

**Bài T8-1 — Từ cảm biến lên dashboard**

1. Đặt các vùng ở **Tự động**, tắt quy tắc tiết kiệm và giữ Wokwi chạy.
2. Kích PIR vùng 2 trên Wokwi.
3. Kiểm tra đèn vàng vùng 2 bật và dashboard hiển thị đúng vùng đang có chuyển động/đèn sáng.
4. Nếu mở MQTTX, xem topic `iot/nhom08/detai45/kho-c7e2/telemetry`: vùng có `id: 2` phải đổi PIR, motion và led tương ứng.

Luồng cần giải thích khi demo: PIR → ESP32 → MQTT → Node-RED → dashboard.

**Bài T8-2 — Từ dashboard xuống đèn**

1. Bấm **Bật vùng 1** trên dashboard. Quan sát đèn đỏ thật trong Wokwi sáng, chế độ vùng 1 là **Thủ công** và dòng lệnh có **ESP32 đã xác nhận**.
2. Bấm **Tắt vùng 1**, kiểm tra đèn tắt và có xác nhận mới.
3. Thử **Bật tất cả**, **Tắt tất cả** rồi **Tự động**. Kiểm tra cả 3 vùng đúng trạng thái sau mỗi thao tác.

Luồng cần giải thích khi demo: dashboard → API Node-RED → MQTT command → ESP32 → relay/LED → ACK và telemetry trở về dashboard. Đọc trạng thái trên giao diện và quan sát đèn trong Wokwi cùng lúc.

### Kiểm tra bảo mật bổ sung nếu muốn minh họa truy cập không có quyền

Để mô phỏng người không có mã cố gửi lệnh, mở terminal PowerShell của máy đang chạy Node-RED và gửi **một yêu cầu tới API localhost**, không kèm token:

```powershell
try {
    Invoke-WebRequest -UseBasicParsing -Method Post `
        -Uri 'http://127.0.0.1:1880/dt45/api/command' `
        -ContentType 'application/json' -Body '{"command":"ON1"}'
} catch {
    if ($null -ne $_.Exception.Response) {
        'HTTP ' + [int]$_.Exception.Response.StatusCode
    } else {
        throw
    }
}
```

Kết quả mong đợi là **HTTP 403**, tức API từ chối yêu cầu thiếu quyền và không gửi lệnh ON1 xuống ESP32. Chuẩn bị các vùng yên, ở AUTO và đèn tắt để quan sát rõ. Nếu nhận HTTP 503, kiểm tra lại việc khởi động Node-RED bằng `node-red/start.ps1` để có mã điều khiển.

Phần này chỉ chứng minh kiểm tra token của dashboard/API. MQTT hiện dùng broker công cộng, chưa xác thực người gửi lệnh trực tiếp vào topic command; vì vậy không gọi hệ thống là đã chống được giả mạo lệnh MQTT hoặc mọi kiểu tấn công.

### Ghi bằng chứng sau mỗi bài

Ghi mã bài, thao tác, kết quả mong đợi, kết quả thực tế và đạt/chưa đạt. Lưu ảnh hoặc video thể hiện cả Wokwi và dashboard, cùng các dòng tương ứng trong `node-red/logs/events.jsonl`. Chỉ đánh dấu đạt sau khi tự quan sát kết quả; kiểm thử dùng thiết bị giả không thay cho phần demo Wokwi thực tế.

## 8 Kế hoạch thực hiện tuần 7 đến tuần 10

Kế hoạch này áp dụng cho **Nhóm 08, đề tài 45: chiếu sáng kho theo khu vực xe nâng**, dựa trên code hiện tại và sheet **Kế hoạch 10 tuần - 60h** của thầy. Thời lượng là **6 giờ mỗi sinh viên mỗi tuần**, tương đương **24 giờ mỗi sinh viên trong 4 tuần này**. Các mốc thời lượng bên dưới bám theo kế hoạch của thầy; số lần lặp và thời lượng demo là đề xuất để nhóm tổ chức công việc.

Code hiện đã có điều khiển PIR, MQTT hai chiều, dashboard, quy tắc kho vắng, cảnh báo và ACK. Nhóm cần chạy các bài thử trên bản firmware mới, sửa lỗi phát hiện được và thu bằng chứng thực tế trước khi đánh dấu hoàn thành từng tuần.

### Tổng quan công việc và điều kiện hoàn thành

| Tuần | Phân bổ 6 giờ mỗi sinh viên | Kết quả cần có |
| --- | --- | --- |
| 7 | 3h hoàn thiện luật tự động; 2h tình huống bất thường; 1h kiểm tra timer, ngưỡng và trạng thái | Ít nhất 2 luật tự động và 1 tình huống lỗi/cảnh báo chạy được, có bằng chứng thử nghiệm. |
| 8 | 3h tích hợp toàn hệ thống; 2h thử luồng hai chiều; 1h sửa lỗi tích hợp | Demo được cảm biến → dashboard và dashboard → đèn, hoạt động ổn định. |
| 9 | 2h xây dựng và chạy test case; 2h sửa lỗi, tăng độ ổn định; 2h hoàn thiện tài liệu | Kết quả kiểm thử, kiến trúc và wiring đúng bản code cuối, topic map, flow, source và video nháp. |
| 10 | 2h kiểm thử hồi quy cuối; 2h live demo; 2h trình bày, Q&A và hoàn thiện báo cáo | Bộ demo cuối, simulation, source, báo cáo, video, slide/poster và từng thành viên giải thích được hệ thống. |

### Tuần 7 hoàn thiện tự động hóa và cảnh báo

**Phần 3 giờ về luật tự động**

1. Đọc `src/main.cpp` để hiểu luật thứ nhất: PIR hợp lệ bật đúng vùng, đèn tự tắt sau thời gian giữ 10 giây. Xác định bộ lọc 300 ms và phân biệt AUTO với MANUAL.
2. Đọc `node-red/functions/rule.js` để hiểu luật thứ hai: có đèn bật thủ công, cả kho vắng đủ 30 giây thì Node-RED gửi AUTO cho cả 3 vùng.
3. Làm bài **T7-1** và **T7-2** ở phần 7. Nên lặp lại mỗi bài 3 lần, thử đủ cả 3 vùng.
4. Khi đang đếm vắng, thử kích một PIR. Kiểm tra quy tắc hủy đợt đếm cũ và chỉ đếm lại khi đủ điều kiện kho vắng.

**Phần 2 giờ về tình huống bất thường**

Làm bài **T7-3**: dừng Wokwi, quan sát cảnh báo offline và nút điều khiển bị khóa; sau đó chạy lại để kiểm tra phục hồi. Ghi rõ đây là bài thiết bị ngừng gửi dữ liệu. Chọn bài này làm tình huống cảnh báo chính của tuần 7 vì dễ quan sát và lặp lại.

**Phần 1 giờ về ngưỡng và trạng thái**

Kiểm tra rằng ON/OFF đưa vùng vào MANUAL, PIR không đổi đèn của vùng đang MANUAL, và AUTO khôi phục điều khiển cảm biến. Phân biệt thời gian ESP32/Wokwi với thời gian trên máy chạy Node-RED: rule 30 giây chạy ở Node-RED, còn bộ giữ đèn 10 giây chạy ở ESP32.

**Đủ để chốt tuần 7 khi:** nhóm tự chạy được 2 luật và 1 tình huống cảnh báo; có ảnh/video cùng các sự kiện tương ứng; giải thích được điều kiện bắt đầu, hủy đếm và kết thúc của mỗi luật.

### Tuần 8 tích hợp hai chiều từ đầu đến cuối

**Phần 3 giờ về tích hợp**

1. Build firmware mới, chỉ chạy một mô phỏng cho bộ topic của nhóm, khởi động Node-RED bằng `node-red/start.ps1` rồi mở dashboard.
2. Kiểm tra broker và prefix khớp giữa ESP32, flow và MQTTX. Dòng Connecting của firmware mới có Client ID dạng `dt45-xxxxxxxx-xxxxxxxx`.
3. Kiểm tra dữ liệu trực tiếp đang cập nhật; bản tin lưu retained hoặc chỉ có `status=online` chưa đủ để kết luận thiết bị còn gửi dữ liệu.
4. Mở quyền điều khiển dashboard bằng mã của phiên Node-RED hiện tại.

**Phần 2 giờ về hai chiều truyền tin**

- Làm bài **T8-1**: kích PIR → ESP32 xử lý → MQTT có telemetry mới → Node-RED nhận → dashboard hiển thị đúng vùng và trạng thái đèn.
- Làm bài **T8-2**: bấm nút trên dashboard → Node-RED tạo lệnh có ID → MQTT chuyển lệnh → ESP32 đổi relay/LED → ACK và telemetry trở lại dashboard.
- Thử bật/tắt từng vùng, bật/tắt tất cả và trở về AUTO. Nên chạy 3 vòng, mỗi lệnh chờ xác nhận và trạng thái thiết bị trước khi gửi lệnh kế tiếp.

**Phần 1 giờ sửa lỗi tích hợp**

Với lỗi gặp được, xác định tầng đang lỗi: không có dữ liệu từ ESP32, MQTT sai broker/topic, Node-RED từ chối vì dữ liệu cũ, hay dashboard chưa mở quyền. Ghi cách tái hiện, nguyên nhân, cách sửa và kết quả thử lại. Dùng mục 6 của tài liệu để xử lý lỗi kết nối thường gặp.

**Đủ để chốt tuần 8 khi:** quan sát được cả hai chiều trên cùng phiên demo, trạng thái giao diện khớp đèn trong Wokwi và lệnh có ACK. Dùng thao tác Serial hoặc chỉ MQTTX riêng lẻ chưa thể hiện đầy đủ đường đi qua dashboard.

### Tuần 9 kiểm thử hệ thống và hoàn thiện tài liệu

**Phần 2 giờ chạy test case**

Dùng bảng sau làm danh sách tối thiểu. Cột thực tế do nhóm điền sau khi chạy; các kết quả mong đợi không phải kết quả đã đo.

| Mã bài | Thao tác | Kết quả mong đợi | Kết quả thực tế và đạt/chưa đạt |
| --- | --- | --- | --- |
| T7-1 | AUTO, kích lần lượt PIR 1/2/3 | Đúng vùng sáng; tự tắt sau thời gian giữ khi hết chuyển động | Chưa ghi nhận |
| T7-2 | MANUAL ON, bật quy tắc kho vắng 30 giây | Gửi AUTO khi đủ điều kiện; đèn tắt sau thời gian giữ nếu kho vẫn vắng | Chưa ghi nhận |
| T7-3 | Dừng và chạy lại Wokwi | Có offline, khóa điều khiển và phục hồi khi nhận dữ liệu mới | Chưa ghi nhận |
| T8-1 | Kích PIR và xem telemetry/dashboard | Dữ liệu trực tiếp và giao diện khớp cảm biến, đèn | Chưa ghi nhận |
| T8-2 | Bật/tắt từng vùng và tất cả từ dashboard | Đúng LED, đúng chế độ và có ACK cho từng lệnh | Chưa ghi nhận |
| T9-1 | Bật thủ công một vùng rồi kích PIR vùng đó | PIR vẫn được đọc nhưng không thay đổi đèn đang MANUAL | Chưa ghi nhận |
| T9-2 | Kích PIR khi quy tắc đang đếm kho vắng | Hủy đợt đếm cũ; chỉ bắt đầu lại khi kho thực sự vắng | Chưa ghi nhận |
| T9-3 | Dùng MQTTX gửi một lệnh sai như ON4 vào topic command của nhóm, Retain OFF | ESP32 trả event ERROR; đèn không đổi do lệnh sai | Chưa ghi nhận |
| T9-4 | Gửi API không có token theo ví dụ phần 7 | HTTP 403; API không phát lệnh điều khiển xuống ESP32 | Chưa ghi nhận |

Chạy các kiểm thử có sẵn tại thư mục project:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\verify.ps1
```

Lệnh này tạo lại export flow, build ESP32, chạy host test C++, test Function Node-RED, test thống kê log và E2E dùng thiết bị giả. Cần Node.js/npm, PlatformIO, MSVC C++ Build Tools, Internet cho bài MQTT và cổng 1881 trống cho server kiểm thử. Kết quả lưu ở `.pio/final-checks/<thời điểm chạy>/`.

Nếu đang kiểm tra phần không cần mạng, dùng:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\verify.ps1 -SkipNetwork
```

Phải ghi rõ bài MQTT/E2E bị bỏ qua khi dùng `-SkipNetwork`. Bài E2E tự động dùng Node-RED/broker thật nhưng **thiết bị giả**, nên vẫn cần các bài Wokwi thực tế bên trên. Nếu sửa Function/HTML và tạo lại `flows.json`, khởi động lại Node-RED để nạp bản flow đang kiểm tra.

**Phần 2 giờ sửa lỗi và kiểm tra độ ổn định**

Sửa từng lỗi tái hiện được, chạy lại bài liên quan, rồi chạy hồi quy khi đã chốt sửa đổi. Nên giữ một phiên Wokwi/dashboard hoạt động 10–15 phút, quan sát tuổi dữ liệu, kết nối và phản hồi lệnh. Ghi cả các lần gián đoạn và cách phục hồi nếu có.

Muốn thống kê ACK và độ trễ của file log đang lưu:

```powershell
node .\tools\log_summary.cjs .\node-red\logs\events.jsonl
```

Công cụ đọc **toàn bộ file**, gồm cả các phiên cũ. Khi đưa số liệu vào báo cáo, ghi rõ khoảng thời gian và tập bản ghi đã dùng. RTT ACK là thời gian từ Node-RED gửi lệnh đến ACK khớp đầu tiên; không gọi đó là độ trễ cảm biến hay tỷ lệ mất gói mạng. Chỉ ghi những số liệu đã đo được.

**Phần 2 giờ hoàn thiện tài liệu**

Đối chiếu sơ đồ 4 tầng, wiring, GPIO, topic/payload, luật tự động và hướng dẫn chạy với code cuối. Kiểm tra README còn trỏ đến file hoặc công cụ đã bị xóa hay không. Chuẩn bị kết quả kiểm thử, source, flow export và video demo nháp theo yêu cầu của thầy. Dùng số liệu thực tế để cập nhật báo cáo; các mục tiêu hoặc tính toán trong đề cương phải được phân biệt với kết quả thực nghiệm.

**Đủ để chốt tuần 9 khi:** các lỗi ảnh hưởng bài demo chính đã được xử lý, có kết quả kiểm thử thực tế, tài liệu khớp phiên bản code và chạy lại được từ đầu.

### Tuần 10 kiểm thử cuối và nghiệm thu

**Phần 2 giờ kiểm thử hồi quy cuối**

Giữ phiên bản ổn định đã kiểm tra ở tuần 9. Chạy lại bộ kiểm thử phù hợp và các bài Wokwi T7/T8. Kiểm tra Internet, broker, license Wokwi, mã mở quyền và các file trên đúng máy sẽ trình diễn. Thử mở project từ đầu theo hướng dẫn để phát hiện thiếu thư viện hoặc sai đường dẫn.

**Phần 2 giờ dành cho live demo**

Đề xuất chuẩn bị một kịch bản khoảng 5–7 phút; điều chỉnh theo thời lượng thầy cho phép:

1. Giới thiệu bài toán chiếu sáng kho và chỉ ra 4 tầng đang chạy.
2. Kích các PIR để thể hiện đèn đúng vùng và luật tự tắt.
3. Bật/tắt đèn từ dashboard, chỉ ra ID lệnh và ACK.
4. Bật quy tắc kho vắng 30 giây, quan sát chuyển về AUTO.
5. Dừng/chạy lại Wokwi để thể hiện cảnh báo và phục hồi.
6. Mở nhật ký, giải thích kết quả đã đo và các giới hạn còn lại.

Thử trước cách bố trí màn hình Wokwi, dashboard và Node-RED/MQTTX để người xem theo dõi. Có video và log đã ghi của đúng phiên bản làm bằng chứng dự phòng; không dùng chúng để tuyên bố live demo đang thành công nếu phiên trực tiếp có lỗi.

**Phần 2 giờ về trình bày và Q&A**

Theo kế hoạch của thầy, nhóm chuẩn bị simulation project, source, báo cáo, video và slide/poster; mọi thành viên cần giải thích được toàn bộ luồng. Nên luyện trả lời các câu sau:

- Vì sao dùng bộ lọc 300 ms và thời gian giữ đèn 10 giây?
- AUTO và MANUAL khác nhau thế nào? Vì sao AUTO áp dụng cả 3 vùng?
- Hai luật tự động chạy ở đâu, điều kiện nào làm hủy đếm kho vắng?
- Vì sao cần ACK có ID và kiểm tra dữ liệu trực tiếp thay cho dữ liệu retained?
- Khi dashboard báo offline, phần nào còn chạy và phần nào bị khóa?
- Quyền dashboard/API bảo vệ được gì? Vì sao MQTT công cộng vẫn cần xác thực/ACL nếu triển khai có bảo vệ lệnh MQTT?
- Nếu không có Internet trong buổi trình diễn, nhóm kiểm tra được những phần nào và chưa chứng minh được phần nào?

**Đủ để chốt tuần 10 khi:** có live demo theo điều kiện nghiệm thu, đủ các mục nộp thầy yêu cầu và từng thành viên trả lời được Q&A. Chỉ lập kế hoạch hoặc có code chạy được chưa thay cho các bước kiểm thử và nghiệm thu này.

### Phân công trong nhóm

Nếu có 3 người: một người phụ trách firmware/Wokwi; một người phụ trách MQTT/Node-RED; một người phụ trách dashboard, ghi kết quả và tài liệu. Mỗi người chạy bài thử phần mình và cùng kiểm tra đường đi xuyên suốt hệ thống.

Nếu có 2 người: một người phụ trách thiết bị và kết nối; người còn lại phụ trách Node-RED và dashboard. Cả hai cùng làm kiểm thử, ghi bằng chứng và luyện Q&A. Mỗi sinh viên ghi thời gian làm việc thực tế của mình để đối chiếu mức tối thiểu 6 giờ/tuần.

## 9. Các cải tiến phần mềm và cách thử

Mạch vẫn dùng 3 PIR. Để nhận phiên bản mới: **Build PlatformIO**, dừng rồi chạy lại Wokwi; trong terminal Node-RED cũ bấm **Ctrl+C**, sau đó chạy lại:

```powershell
powershell -ExecutionPolicy Bypass -File .\node-red\start.ps1
```

Mở lại `http://127.0.0.1:1880/dashboard`, tải lại trang và mở quyền điều khiển bằng mã từ terminal mới. Chỉ giữ một thiết bị và một flow dùng bộ topic này. Nếu vẫn thấy giao diện cũ, kiểm tra đúng terminal đang chạy project và đúng địa chỉ dashboard. Nếu cài đặt đèn bị khóa dù thiết bị online, firmware còn cũ hoặc bạn chưa mở quyền.

### 9.1. Đổi thời gian giữ đèn từ dashboard/MQTT

1. Tắt rule **Tiết kiệm khi kho vắng**; bấm **Tự động** và bảo đảm pre-light tắt.
2. Trong **Cài đặt đèn**, nhập `15` ở thời gian giữ → **Áp dụng**.
3. Xem nhật ký xác nhận `TIMEOUT=15` và dòng quy tắc hiển thị 15 giây. Kích PIR vùng 1. Khi PIR về LOW và không có chuyển động mới, đèn tự tắt sau khoảng 15 giây mô phỏng.
4. Thử `3` hoặc `300`. Giá trị hợp lệ là số nguyên 3–300 giây. Giá trị như `2`, `301`, `15x`, số âm và số thập phân bị từ chối.

Thay timeout áp dụng ngay cho khoảng giữ hiện tại, tính từ chuyển động hợp lệ cuối cùng; giảm xuống thấp hơn thời gian đã trôi có thể làm đèn tắt ở lần quét kế tiếp. Mặc định khi khởi động lại là 10 giây. Giá trị trên giao diện lấy từ telemetry xác nhận của ESP32.

### 9.2. Pre-light: bật trước vùng liền kề

1. Bấm **Tự động**, chờ các PIR LOW và đèn tắt. Trong **Cài đặt đèn**, bấm **Bật pre-light** và chờ ESP32 xác nhận.
2. Kích PIR 1: vùng 1 và 2 sáng; vùng 3 không sáng. Kích PIR 3: vùng 3 và 2 sáng. PIR 2 có thể làm cả 3 vùng sáng vì vùng 1 và 3 đều liền kề.
3. Khi chuyển động ở vùng gốc kết thúc, vùng được bật trước giữ thêm 5 giây; vùng gốc giữ theo timeout đang cài.
4. Bấm **Tắt vùng 2** để đưa vùng 2 vào MANUAL OFF. Kích PIR 1: vùng 2 vẫn tắt, vì điều khiển thủ công được ưu tiên.
5. Bấm **Tự động**, **Tắt pre-light**. Kiểm tra lại từng PIR chỉ điều khiển đèn đúng vùng.

Pre-light mặc định tắt và trở về tắt khi khởi động lại. Chức năng này dựa vào vùng liền kề, chưa suy luận được hướng di chuyển của xe nâng. Trước bài nghiệm thu “đúng vùng”, luôn tắt pre-light và đặt timeout lại 10 giây.

### 9.3. Thống kê thời gian sáng

Mục **Thời gian sáng & ước tính tiết kiệm** hiển thị thời gian phiên, tổng thời gian bật của 3 đèn và thời gian từng vùng. Bật đèn thủ công vài chục giây rồi tắt để thấy bộ đếm tăng và ngừng tăng theo đúng đèn. Bộ đếm tiếp tục tại ESP32 khi mất mạng; khi có mạng lại dashboard nhận số mới.

```text
Mức giảm (%) = 100 × (1 − tổng thời gian bật của 3 đèn / (3 × thời gian phiên))
```

Ví dụ, phiên 60 giây chỉ có một đèn sáng suốt 60 giây thì tổng thời gian sáng là 60 giây, so với mốc bật cả 3 đèn là 180 giây: giảm khoảng 66,7%. Đây là **ước tính theo thời gian bật với 3 đèn cùng công suất**, không phải kết quả đo kWh hoặc tỷ lệ tiết kiệm bảo đảm ngoài thực tế. Phiên quá ngắn có thể cho số phần trăm dao động; lúc mới khởi động chưa tính tỷ lệ. Wokwi dùng thời gian mô phỏng, có thể khác tốc độ đồng hồ máy tính. Khởi động lại ESP32 sẽ xóa bộ đếm; offline chỉ hiển thị số gần nhất.

### 9.4. Cảnh báo bất thường để thử tuần 7

**PIR giữ HIGH kéo dài:** mặc định cảnh báo sau 120 giây liên tục có dữ liệu trực tiếp. Để thử nhanh, đặt ngưỡng `10` giây rồi **Lưu cảnh báo**. Kích **Simulate Motion** nhiều lần, mỗi lần cách nhau dưới 5 giây mô phỏng, để PIR tiếp tục HIGH; xem cảnh báo vùng tương ứng trong banner và nhật ký. Dừng kích, khi PIR LOW sẽ có sự kiện phục hồi. Theo [tài liệu PIR Wokwi](https://docs.wokwi.com/parts/wokwi-pir-motion-sensor), cảm biến mặc định cho phép retrigger để kéo dài HIGH; cũng có thể tạm đặt `"delayTime":"30"` trong `attrs` của một PIR ở `diagram.json`, chạy lại mô phỏng để thử rồi trả về `attrs: {}`. Không cần đổi dây hoặc thêm cảm biến.

PIR HIGH lâu có thể do chuyển động liên tục hợp lệ. Cảnh báo chỉ nhắc kiểm tra, **không khóa hoặc tự tắt đèn**. Mất dữ liệu, dữ liệu sai hoặc khởi động lại sẽ ngắt chuỗi đếm. Ngưỡng Node-RED dùng đồng hồ máy tính.

**Đèn thủ công sáng khi kho vắng:** tắt rule tiết kiệm để không tự chuyển AUTO trước cảnh báo. Đặt thời gian cảnh báo kho vắng `15` giây → lưu. Chờ cả 3 PIR LOW, bấm **Bật vùng 1** và không kích thêm. Sau 15 giây liên tục có dữ liệu, banner/nhật ký báo `MANUAL_LIGHT_IDLE`. Đèn vẫn sáng thủ công. Kích PIR, tắt đèn hoặc chuyển AUTO để kết thúc điều kiện cảnh báo. Khi bật lại rule tiết kiệm, rule có thể chuyển AUTO trước khi đủ ngưỡng cảnh báo; đây là hành vi bình thường.

Mỗi cảnh báo chỉ ghi một lần trong một đợt, có sự kiện phục hồi khi điều kiện hết; không ghi lặp mỗi giây. Dashboard cho chỉnh ngưỡng PIR 5–3600 giây và kho vắng 15–300 giây.

### 9.5. Cảnh báo ngoài ca làm việc

1. Trong **Cảnh báo & ca làm việc**, bật **Cảnh báo chuyển động ngoài ca**.
2. Nhập giờ bắt đầu/kết thúc theo giờ Việt Nam. Ví dụ `08:00`–`17:00`; ca đêm dùng `22:00`–`06:00`. Hai giờ phải khác nhau, áp dụng hằng ngày; giờ bắt đầu thuộc ca, giờ kết thúc là ngoài ca.
3. Để thử, tạm đặt một khoảng ca không chứa giờ hiện tại → **Lưu cảnh báo**. Kích PIR, xem `AFTER_HOURS_MOTION` trong nhật ký và banner.
4. Chờ hết chuyển động để xem phục hồi. Đổi ca chứa giờ hiện tại và kích lại: không có cảnh báo ngoài ca mới.
5. Sau thử nghiệm, tắt cảnh báo ngoài ca hoặc đặt lại giờ sử dụng mong muốn; trả ngưỡng PIR về 120 giây và kho vắng 60 giây.

Chức năng chỉ cảnh báo có chuyển động ngoài ca, chưa xác định được ai hoặc có xâm nhập thật hay không. Không gửi lệnh tắt đèn. Mặc định cảnh báo ngoài ca tắt. Các cấu hình cảnh báo lưu trong phiên Node-RED; khởi động lại về mặc định.

### 9.6. Lệnh và dữ liệu mới để kiểm tra tuần 8

Trong MQTTX, publish **Retain OFF** vào `iot/nhom08/detai45/kho-c7e2/command/all`:

| Lệnh | Tác dụng |
| --- | --- |
| `TIMEOUT=15` | Đổi thời gian giữ đèn tại ESP32 thành 15 giây. |
| `PRELIGHT_ON` | Bật chức năng sáng trước vùng liền kề. |
| `PRELIGHT_OFF` | Tắt chức năng sáng trước. |
| `STATUS` | In trạng thái và cấu hình ra Wokwi Terminal. |

Các lệnh trên cũng dùng được trong Wokwi Terminal. Dashboard vẫn gửi dạng `CMD|id|command` để ghép ACK đúng lệnh và chống thực thi lặp. Telemetry bổ sung `prelight_enabled`, `prelight_hold_ms`, `session_ms` và `on_ms` trong từng vùng. `timeout_ms` phản ánh cấu hình hiện tại. API cấu hình cảnh báo là `POST /dt45/api/alerts`, yêu cầu mã điều khiển giống API command/rule.

Để kiểm thử hồi quy sau sửa code:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\verify.ps1
```

Các bài host kiểm tra logic firmware; bài MQTT E2E dùng thiết bị giả lập trên topic thử riêng. Kết quả đó cần kết hợp với thao tác PIR, đèn và dashboard trên Wokwi của nhóm, không thay thế bằng chứng chạy mạch. Sau các thử nghiệm, trả hệ thống về AUTO, timeout 10 giây, pre-light tắt, rule kho vắng tắt và cảnh báo ngoài ca tắt.

## 10. CSDL lịch sử (SQLite) và Telegram bot

Hai phần này được bổ sung ngày 21/11/2026. Cả hai chạy trong Node-RED, **không cần sửa firmware hay build lại Wokwi**. Chỉ cần dừng Node-RED (Ctrl+C) rồi chạy lại `node-red\start.ps1`.

### 10.1. CSDL lưu lịch sử

- **Công nghệ:** SQLite tích hợp sẵn trong Node.js (`node:sqlite`, cần Node.js 22.5+, khuyến nghị 24 LTS). Không cần cài server CSDL, vẫn chạy khi mất Internet.
- **File:** `node-red\data\dt45.sqlite` (đổi bằng biến môi trường `DT45_DB_FILE`). Terminal Node-RED in đường dẫn này khi khởi động. Dữ liệu còn nguyên sau khi tắt/mở lại Node-RED.
- **Tần suất ghi:** trạng thái 3 vùng được ghi **khi có thay đổi** hoặc **ít nhất 10 giây một lần** (`DT45_DB_SAMPLE_MS`); lệnh, ACK, cảnh báo, phục hồi, quy tắc tự động được ghi **ngay khi xảy ra**. Chỉ ghi telemetry trực tiếp, không ghi bản tin retained cũ.

| Bảng | Trường | Nội dung |
| --- | --- | --- |
| `telemetry_log` | id, ts, ts_ms, device, uptime_ms, zone_id, pir, motion, led, mode, on_ms, timeout_ms | Mỗi dòng là trạng thái **một vùng** tại một thời điểm |
| `event_log` | id, ts, ts_ms, type, code, zone_id, command, cmd_id, result, reason, source, detail | Mỗi dòng là một sự kiện; `detail` giữ nguyên JSON gốc |

**Xem lại lịch sử:**

1. Trên dashboard, cuộn tới **Lịch sử dữ liệu (CSDL SQLite)** → chọn *Trạng thái từng vùng*, *Sự kiện, lệnh, cảnh báo* hoặc *Thời gian sáng theo ngày* → chọn khoảng (1 giờ, 24 giờ, 7 ngày) và vùng → **Xem**. Bấm **Tải CSV** để mở bằng Excel. Người chỉ xem cũng dùng được (chỉ đọc).
2. Qua API: `http://127.0.0.1:1880/dt45/api/history?kind=telemetry&hours=24&zone=1` (`kind` = `telemetry` | `events` | `usage`; thêm `&type=alert` để lọc sự kiện; `&format=csv` để tải CSV).
3. Mở trực tiếp file `.sqlite` bằng DB Browser for SQLite, ví dụ:

```sql
SELECT ts, zone_id, pir, motion, led, mode FROM telemetry_log WHERE zone_id = 1 ORDER BY ts_ms DESC LIMIT 20;
SELECT ts, code, zone_id FROM event_log WHERE type = 'alert' ORDER BY ts_ms DESC;
```

Bảng *Thời gian sáng theo ngày* cộng thời gian giữa các mẫu liên tiếp khi đèn sáng; khoảng mất kết nối dài hơn 30 giây không được cộng. Đây vẫn là thời gian bật theo dữ liệu thiết bị, chưa phải số đo kWh.

### 10.2. Telegram bot

1. Trên Telegram, chat với **@BotFather** → `/newbot` → đặt tên → nhận **token**.
2. Sao chép `node-red\telegram.local.example.ps1` thành `node-red\telegram.local.ps1`, dán token vào `DT45_TELEGRAM_TOKEN`. File `.local` đã nằm trong `.gitignore`; **không đưa token lên slide, báo cáo hay GitHub**.
3. Chạy lại `node-red\start.ps1`. Terminal phải in `Telegram: BAT`. Dashboard, mục *Cảnh báo & ca làm việc*, ghi *Telegram: đang bật*.
4. Nhắn `/help` cho bot. Lần đầu bot trả lời *Chat ID … chưa được cấp quyền*: chép số Chat ID đó vào `DT45_TELEGRAM_CHAT_ID` (nhiều ID cách nhau dấu phẩy), rồi chạy lại `start.ps1`.

| Lệnh gửi bot | Tác dụng |
| --- | --- |
| `/status` | Trạng thái 3 vùng: đèn, chế độ, chuyển động, kết nối ESP32 |
| `/on1` `/off1` `/on2` `/off2` `/on3` `/off3` | Bật/tắt tay từng vùng |
| `/allon` `/alloff` | Bật/tắt cả kho (thủ công) |
| `/auto` | Trả 3 vùng về tự động theo PIR |
| `/help` | Danh sách lệnh |

- Lệnh Telegram đi qua **cùng node kiểm tra lệnh** với dashboard: chỉ gửi khi ESP32 có dữ liệu trực tiếp, có ID, QoS 1, chờ ACK. Bot trả lời *Đã gửi lệnh…* rồi *ESP32 đã xác nhận … · ACK … ms*.
- Bot tự gửi cảnh báo tới các chat được phép: mất dữ liệu ESP32, PIR giữ HIGH lâu, đèn bật tay khi kho vắng, chuyển động ngoài ca, lệnh thiếu ACK, quy tắc kho vắng gửi AUTO, và tin phục hồi.
- Chat **không** có trong `DT45_TELEGRAM_CHAT_ID` chỉ nhận thông báo từ chối; mọi lần thử được ghi vào nhật ký và CSDL (`type = telegram`).
- Bot đọc tin mỗi 3 giây (getUpdates, không cần webhook hay IP public). Cần Internet tới api.telegram.org.

### 10.3. Thêm vào kịch bản demo

- **Sau bước bật tay vùng B:** gửi `/status` rồi `/on1` từ điện thoại, chiếu màn hình điện thoại (hoặc Telegram Desktop) cạnh Wokwi: đèn vùng 1 sáng, bot báo đã xác nhận.
- **Ở bước mất kết nối:** khi dừng Wokwi, điện thoại nhận *[CẢNH BÁO] Mất dữ liệu từ ESP32*; chạy lại Wokwi, nhận *[PHỤC HỒI]*.
- **Ở bước nhật ký:** mở *Lịch sử dữ liệu* → *Sự kiện* → thấy lệnh từ Telegram (nguồn `telegram`), cảnh báo và ACK; chọn *Thời gian sáng theo ngày*; bấm **Tải CSV**.
- **Dự phòng:** nếu mạng phòng chặn Telegram, phần CSDL và dashboard vẫn chạy; dùng ảnh chụp tin nhắn bot đã chuẩn bị trước.

### 10.4. Kiểm thử phần mới

```powershell
node .\test\storage_telegram_test.cjs
node .\test\e2e_week68_test.cjs
```

`storage_telegram_test.cjs` (12 ca, không cần Internet) kiểm tra CSDL (ghi theo thay đổi/10 giây, mở lại vẫn còn dữ liệu, lọc theo vùng/loại, thời gian sáng theo ngày, CSV), API lịch sử và Telegram với API giả lập (phân quyền chat, không lộ token, chống gửi lặp). Bài E2E nay có 17 kiểm tra: thêm lệnh `/on2` từ Telegram đi qua MQTT tới thiết bị giả và nhận ACK, cảnh báo offline gửi lên Telegram, và API lịch sử đọc lại dữ liệu từ SQLite. Telegram trong E2E là máy chủ giả lập tại cổng 18299, không gửi tin thật.
