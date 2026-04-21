# 展場名片交換 App

展場上放一隻手機，客人拍名片 → AI 自動辨識 → 存進 Lark 多維表格 → 自動寄出客製問候信。電腦大螢幕同步顯示剛交換的名片。

## 架構一覽

```
[手機 PWA /]  ─ 拍照 ─→  [Claude Haiku 4.5 Vision]  ─→  確認欄位
     │                                                     │
     ▼                                                     ▼
[Express server.js] ───→ [Storage Adapter: Lark Bitable] ───→ 寫入一筆記錄
     │                                                     │
     ├──→ [Claude 生成客製 greeting 信] → [Resend 寄信] → 更新信件狀態
     │
     └──→ [SSE /api/display/stream] → [大螢幕 /display.html] 即時顯示
```

**Storage Adapter 設計**：目前實作 Lark Bitable，之後要加 Airtable / Google Sheets / Notion 只要新寫一個 adapter（同介面：`saveCard`、`updateEmailStatus`、`listRecentRecords`），主程式不用改。

## 檔案結構

```
tradeshow-card-app/
  server.js              Express API (scan / archive / records / SSE / setup / health)
  lib/
    claude.js            Claude Vision OCR + greeting 生成
    lark.js              Lark Bitable adapter（含 schema 自動建立）
    resend.js            Resend 寄信（無 key 時自動降級為 dry-run）
  public/
    index.html + app.js + style.css     手機 PWA（拍照 → 確認 → 送出）
    display.html + display.js           大螢幕即時 feed
    manifest.json + icon.svg            PWA 設定
  .env                   密鑰（已 gitignore，不會進版控）
  .env.example           範本
```

## 第一次啟動

```bash
cd tradeshow-card-app
npm install
npm start
```

服務起來後：
- 手機掃描頁：<http://localhost:3000/>
- 大螢幕顯示頁：<http://localhost:3000/display.html>
- 健康檢查：<http://localhost:3000/api/health>

**第一次使用要先初始化 Bitable 欄位**（idempotent，重跑沒副作用）：

```bash
curl -X POST http://localhost:3000/api/setup
```

會自動在你的 Bitable 建立 11 個欄位：姓名 / 英文名 / 公司 / 職稱 / Email / 電話 / 地址 / 名片照片 / 掃描時間 / 信件狀態 / 備註。

## 展場現場怎麼跑

1. **手機**（放在展位架上）：Safari 開 `http://<你的電腦IP>:3000/`，「加到主畫面」變成 PWA kiosk
2. **電腦**（給客人看）：Chrome 全螢幕打開 `http://localhost:3000/display.html`
3. 客人按「拍攝名片」→ AI 辨識 → 客人確認欄位 → 送出
4. 大螢幕立刻浮現他的名片資訊，幾秒後顯示「已寄」
5. 下一位客人

> 💡 手機跟電腦要連同一個 Wi-Fi。`<你的電腦IP>` 用 `ipconfig getifaddr en0`（Mac）查。

## 密鑰設定（`.env`）

```env
ANTHROPIC_API_KEY=sk-ant-...
LARK_APP_ID=cli_...
LARK_APP_SECRET=...
LARK_BITABLE_APP_TOKEN=...     # 從 Bitable URL: /base/<這段>
LARK_BITABLE_TABLE_ID=tbl...   # URL ?table=<這段>
LARK_REGION=sg                 # 或 "feishu"（中國站）

RESEND_API_KEY=                # 沒填就是 dry-run
EMAIL_FROM=Horizon AI <service@horizon-ai.ai>
EMAIL_REPLY_TO=grace.wu@horizon-ai.ai

EVENT_NAME=XXX AI 展
BOOTH_OWNER_NAME=Grace Wu
BOOTH_OWNER_TITLE=AI 數位轉型策略總監
BOOTH_COMPANY=Horizon AI
```

沒 `RESEND_API_KEY` 時，程式會把「原本要寄的信」印在 console 給你看，不會真的寄——這樣可以先把流程跑通再開啟發信。

## Resend 設定（讓信能真的寄出）

### Step 1 · 註冊並拿 API Key
1. <https://resend.com> 註冊（用 `grace.wu@horizon-ai.ai` 或任何常用信箱）
2. 左側 **API Keys** → **Create API Key** → 取名 `tradeshow-app`
3. 複製 key（只顯示一次），填到 `.env` 的 `RESEND_API_KEY=`

### Step 2 · 驗證 horizon-ai.ai domain
1. Resend 左側 **Domains** → **Add Domain** → 填 `horizon-ai.ai`
2. Resend 會給你 3 組 DNS 記錄：
   - 1 組 **MX**（回信用）
   - 1 組 **TXT (SPF)**
   - 1 組 **TXT (DKIM)**
3. 到你買 `horizon-ai.ai` 的 DNS 管理後台（可能是 Cloudflare、Gandi、GoDaddy 等），把這 3 筆記錄加進去
4. 回 Resend 按 **Verify DNS Records**，等到全部顯示綠燈（通常 5-30 分鐘）
5. 驗證完後，`service@horizon-ai.ai` 就可以發信了

**不做這步的風險**：預設會用 Resend 的測試 domain 發，顯示為 `onboarding@resend.dev`，客人收到會懷疑是釣魚信或進垃圾信匣。

不確定你 domain 在哪買？到終端機跑：`whois horizon-ai.ai | grep -i registrar`

## API 端點參考

| Method | Path | 用途 |
|---|---|---|
| POST | `/api/scan` | `multipart/form-data` with `image` → 回傳辨識結果 JSON |
| POST | `/api/archive` | `multipart/form-data` with `card` (JSON string) + `image` → 寫入 Bitable，背景寄信 |
| GET  | `/api/records` | 最近 20 筆紀錄（給大螢幕初始載入） |
| GET  | `/api/display/stream` | SSE 推播新名片事件 |
| POST | `/api/setup` | 初始化 Bitable 欄位（idempotent） |
| GET  | `/api/health` | 診斷各家服務狀態 |

## 產品化下一步（之後賣給其他商家）

1. **多商家支援**：把 `.env` 搬進資料庫（每個商家一組 Lark / Resend 設定），App 前端加「商家選擇器」
2. **更多 Adapter**：`lib/airtable.js`、`lib/sheets.js`、`lib/notion.js`、`lib/hubspot.js`——全部實作同一個 interface（`saveCard` / `updateEmailStatus` / `listRecentRecords`）
3. **後台頁面**：商家登入 → 填連接器設定 → 編輯 greeting 信 prompt → 下載 CSV
4. **kiosk 模式**：若要更穩，轉 React Native 包成 iPad app，走 guided access 鎖定畫面
5. **離線佇列**：展場 Wi-Fi 常斷，客戶端加 IndexedDB 佇列，連上線再同步

## 安全提醒

- `.env` **絕對不要** commit（已放進 `.gitignore`）
- Lark App Secret、Anthropic Key、Resend Key 都等同密碼，外洩就馬上到各家後台 revoke 重生
- 展場拍到的名片是個資，建議 App 上加一句「同意接收後續聯繫」的勾選欄（GDPR／個資法）

## 疑難排解

| 問題 | 處理 |
|---|---|
| `Lark auth failed: app ticket is invalid` | `.env` 的 `LARK_APP_ID` / `LARK_APP_SECRET` 沒對上 |
| `Lark ... failed: code 1254xxx` | Lark App 沒有這張 Bitable 的權限，到 Lark Open Platform 把 App 加進 Bitable 協作者 |
| 照片拍完一直轉圈 | 檢查 `ANTHROPIC_API_KEY`，或 console 看是否回 non-JSON |
| 信件進垃圾信匣 | Domain DNS（SPF/DKIM）沒設或沒 verify |
| 大螢幕沒更新 | SSE 連線斷了，瀏覽器會自動重連；也可手動 reload |
