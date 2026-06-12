User: 我看不懂這專案的程式碼運行架構 請詳細說明

GitHub Copilot: Optimizing tool selection...了解，先讀取專案核心檔案，確認擴充功能的運作方式。

Read [](file:///home/percy6615/%E4%B8%8B%E8%BC%89/claude-auto-continue/manifest.json)

Read [](file:///home/percy6615/%E4%B8%8B%E8%BC%89/claude-auto-continue/background.js)

Read [](file:///home/percy6615/%E4%B8%8B%E8%BC%89/claude-auto-continue/popup.js)

Read [](file:///home/percy6615/%E4%B8%8B%E8%BC%89/claude-auto-continue/README.md)

## 專案運作架構概覽

這個專案是一個 Chrome 擴充功能，目的是在 `claude.ai` 的用量限制重置後，自動到指定對話頁面送出一條訊息（預設是「繼續」）。

主要組成：

1. manifest.json
2. background.js
3. content.js
4. popup.html / popup.js
5. README.md

---

## 1. manifest.json：入口與權限

manifest.json 定義了擴充功能的基本架構：

- `manifest_version: 3`
- `background.service_worker: "background.js"`
  - 代表後台邏輯由 service worker 執行
- `action.default_popup: "popup.html"`
  - 點擊工具列圖示會打開設定介面
- `content_scripts`
  - 把 content.js 注入到所有 `https://claude.ai/*` 的頁面
- 權限
  - `alarms`：排程未來時間觸發
  - `storage`：儲存設定、狀態、偵測結果
  - `tabs`：開啟/切換 chrome 分頁
  - `host_permissions`：允許對 `https://claude.ai/*` 網站執行 content script

---

## 2. background.js：排程與控制中心

background.js 是整個擴充的「大腦」，它負責以下工作：

- 讀寫設定與狀態
  - 透過 `chrome.storage.local.get/set`
  - `config`：使用者設定的對話網址、訊息內容、延遲、selector
  - `status`：排程狀態、最後一次執行結果
- 設置/取消排程
  - `arm(resetTimeMs)`：把重置時間加上 buffer，再建立 `chrome.alarms`
  - `cancel()`：清除 alarm
- 處理 alarm 觸發
  - `chrome.alarms.onAlarm.addListener(...)`
  - 觸發後呼叫 `runContinueJob("alarm")`
- 找到或建立對話頁
  - `findOrCreateTab(url)`
  - 先找現有 `claude.ai` 分頁，重用或開新分頁
- 與 content script 通訊
  - `pingContent(tabId)`：確認 content.js 已經載入且回應
  - `sendToTab(tabId, text, selectors)`：傳訊息給 content script 要它送出訊息
- 批次處理多個對話
  - `conversationUrls` 可設定多行 URL
  - 逐一開分頁送出，並在對話間加 `betweenConvosMs` 間隔

簡單流程：

- 使用者在 popup 按「Arm」
- popup 發訊息給 background：`{ action: "arm", resetTimeMs }`
- background 設定 alarm
- 到時間後 alarm 觸發
- background 開啟/切換對話頁面
- background 確認 content script 準備好
- background 發 `sendMessage` 給頁面
- content script 送出文字並回傳結果
- background 紀錄最後結果到 storage

---

## 3. content.js：在 claude.ai 頁面裡執行

content.js 是注入到 `claude.ai` 頁面裡的腳本，負責兩件事：

### A. 偵測用量限制橫幅
- `scanForLimitBanner()`
  - 掃描頁面上所有 `div, section, span, p, li`
  - 找含有「limit」「reset」「重置」「恢復」之類提示字眼的文字
- `parseResetTime(text)`
  - 嘗試從這段文字萃取時間
  - 支援像 `8:30 PM`、`下午 8:30`、`22:30` 等格式
  - 轉成未來的 timestamp
- `detectAndStore()`
  - 找到橫幅文字後，把 `rawText`、`resetMs` 存到 `chrome.storage.local.detected`
- DOM 變動觀察
  - `MutationObserver` 監聽頁面變動，延遲掃描防抖
  - 一進頁面就執行一次檢測

### B. 送出訊息
- `insertText(editor, text)`
  - 嘗試用 `document.execCommand("insertText")`
  - 若失敗，再 dispatch `beforeinput` / `input`
  - 最後備援直接修改 `editor.textContent`
- `clickSend(selectors)`
  - 先找送出按鈕並點擊
  - 若找不到就用 Enter 鍵模擬送出
- `doSend(text, selectors)`
  - 先取得 editor、插入文字
  - 等 500ms
  - 呼叫 `clickSend`
  - 檢查 editor 是否已清空，回傳是否成功

### C. 與 background / popup 通訊
`chrome.runtime.onMessage.addListener(...)`：
- `ping`：回傳 `{ ok: true }`，讓 background 確認 content script 已啟動
- `rescan`：重新掃描限制橫幅，回傳檢測結果
- `sendMessage`：執行 `doSend(...)`，送出訊息到對話框

---

## 4. popup.html / popup.js：使用者介面

這是你點擊工具列圖示後看到的設定頁。

popup.js 主要做：

- 讀取儲存的設定，填入欄位
- 儲存新的設定到 `chrome.storage.local.config`
- 顯示 `detected` 的橫幅文字與解析出來的重置時間
- 顯示 background 的排程狀態與最後結果
- 提供按鈕：
  - `rescan`：要求 content script 重新掃描頁面
  - `useDetected`：把 content script 偵測到的時間填入「重置時間」
  - `save`：儲存設定
  - `arm`：開始排程
  - `test`：立即執行一次送出測試
  - `cancel`：取消排程

它跟 background 的通訊方式：
- `chrome.runtime.sendMessage({ action: "arm", resetTimeMs })`
- `chrome.runtime.sendMessage({ action: "cancel" })`
- `chrome.runtime.sendMessage({ action: "testNow" })`
- `chrome.runtime.sendMessage({ action: "getStatus" })`

---

## 5. 典型使用流程

1. 你打開 `claude.ai` 的對話頁
2. content.js 被注入，開始偵測限制提示
3. 你打開擴充 popup
4. 輸入要自動送出的對話 URL（可多個）
5. 如果 popup 有偵測到限制橫幅，按「重新掃描」或「使用偵測值」
6. 按「Arm」設定排程
7. 在重置時間 + 45 秒後，background.js 的 alarm 觸發
8. background 開啟/聚焦對話頁面，確認 content.js 準備好
9. background 傳 `sendMessage` 給 content.js
10. content.js 在頁面裡把文字寫進輸入框、送出
11. 結果寫回 storage，popup 顯示最後狀態

---

## 6. 關鍵資料流與儲存

- `chrome.storage.local.config`
  - conversationUrls
  - messageText
  - sendDelayMs
  - selectors.editor
  - selectors.sendButton

- `chrome.storage.local.status`
  - armed
  - nextFire
  - lastResult

- `chrome.storage.local.detected`
  - rawText
  - resetMs
  - at

---

## 7. 重點提醒

- 這個擴充不是 API 版的自動化，它是模擬你在 `claude.ai` 頁面內「打字 + 按送出」
- 如果 content.js 找不到輸入框或送出鈕，程式就會失敗；這正是你要用「立即測試送出」確認的原因
- `selectors` 可以在 popup 裡改成你實際頁面的 CSS selector
- `alarm` 只能在 Chrome 開著 / service worker 活動時生效

---

## 8. 簡化理解

- manifest.json：告訴 Chrome「這個擴充要做什麼」
- background.js：負責時間到後的自動執行與分頁控制
- content.js：負責在 claude.ai 頁面內偵測限制與送訊息
- popup.js：負責設定、顯示狀態、叫 background 做事

如果你要，我可以再幫你把每個檔案「逐行重點」拆解一次。