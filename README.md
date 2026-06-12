# Claude Auto-Continue（claude.ai）

5 小時用量限制重置後，自動到你指定的 claude.ai 對話送出「繼續」。
跑在你**已登入的真實 Chrome 分頁**裡，做的事跟你手動一樣（打字、按送出）。

> 注意：在 claude.ai 介面以程式自動送訊息，可能與其使用條款（限制自動化／機器人存取）相衝突。
> 本工具不繞過用量限制——限制照樣生效，只是在重置後替你補送一句。風險請自行評估。
> 真正的無人值守用途，官方支援的路是 API（但 API 看不到你 claude.ai 上的既有對話）。

---

## 安裝

1. 解壓本資料夾。
2. Chrome 開 `chrome://extensions`。
3. 右上角開啟「**開發人員模式**」。
4. 點「**載入未封裝項目**」，選擇整個 `claude-auto-continue` 資料夾。
5. 釘選工具列上的圖示方便使用。

---

## 使用

1. 撞到限制時，先在 claude.ai 打開**那個要續的對話**，從網址列複製 `https://claude.ai/chat/...`。
2. 點擴充圖示開 popup：
   - 貼上對話網址（可多行＝多個對話）。
   - 「送出的訊息」維持「繼續」。
   - 按「**重新掃描使用中分頁**」抓限制橫幅上的重置時間；抓不到就在「重置時間」欄手動填（直接照橫幅上的時間填）。
   - 按「**Arm**」。到時間 Chrome 會自動開／聚焦該對話並送出。
3. **第一次務必先按「立即測試送出」**：在你現在開著的 claude.ai 分頁立刻試打字＋送出，確認 selector 正確，不用等 5 小時。

> 限制：**Chrome 必須保持執行**，alarm 才會觸發、才能開分頁送出。整台電腦／Chrome 關掉就不會動。

---

## 校準（重要，請回傳給我）

我看不到你的畫面，claude.ai 的 class 名稱也會改版。如果「立即測試送出」失敗，請從 DevTools 抓三樣東西貼回給我，我把 selector 鎖死：

**A. 輸入框 selector**
- 在 claude.ai 對話框按右鍵 →「檢查」。
- 在 Elements 找到包住游標的可編輯 `div`（通常 `class` 含 `ProseMirror`、且 `contenteditable="true"`）。
- 右鍵該節點 → Copy → **Copy selector**，貼回給我。

**B. 送出鈕 selector**
- 對訊息框右邊的送出箭頭按右鍵 →「檢查」。
- 找到那顆 `<button>`（記下它的 `aria-label` 或 `data-testid`）。
- Copy → **Copy selector**，貼回給我。

**C. 限制橫幅文字**
- 撞到限制時，把那段「已達上限 / 將於 X 重置」的**整段文字**原樣貼給我（中英文都要原樣）。

拿到 A/B 後，你也可以自己到 popup 的「進階」把真實 selector 貼上去並儲存，立即生效。

---

## 疑難排解

- **看 service worker log**：`chrome://extensions` → 本擴充 →「服務工作」(service worker) 連結 → Console。
- **看頁面 log**：在 claude.ai 分頁按 F12 → Console（content script 的訊息在這）。
- 「測試送出」說輸入框未清空 → selector 多半不對，走上面的校準。
- 改了程式碼後，回 `chrome://extensions` 按本擴充的「重新整理」。

## 檔案
- `manifest.json` — 權限與進入點
- `background.js` — 排程 alarm、開分頁、協調送出
- `content.js` — 偵測限制橫幅、打字進 ProseMirror、按送出
- `popup.html` / `popup.js` — 設定介面
