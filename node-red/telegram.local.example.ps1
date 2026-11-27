# Sao chep file nay thanh node-red\telegram.local.ps1 roi dien gia tri that.
# telegram.local.ps1 da nam trong .gitignore: KHONG dua token len slide, bao cao hay GitHub.
# 1. Tren Telegram, chat voi @BotFather -> /newbot -> dat ten -> nhan token dang 123456789:AA...
$env:DT45_TELEGRAM_TOKEN = 'DAN_TOKEN_TU_BOTFATHER_VAO_DAY'
# 2. Chat ID duoc phep dieu khien (nhieu ID cach nhau dau phay). Chua biet ID: de trong, chay Node-RED,
#    nhan /help cho bot -> bot tra loi kem Chat ID cua ban -> dien vao day va chay lai start.ps1.
$env:DT45_TELEGRAM_CHAT_ID = ''
