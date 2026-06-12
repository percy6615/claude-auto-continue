// content.js — 在 claude.ai 頁面內執行
// 負責：(1) 偵測限制橫幅、解析重置時間  (2) 把訊息打進輸入框並送出

function qsFirst(selList) {
  for (const sel of selList || []) {
    try { const el = document.querySelector(sel); if (el) return el; } catch (e) {}
  }
  return null;
}

// ---------- 送出訊息 ----------

function insertText(editor, text) {
  editor.focus();
  let ok = false;
  // 方法 1：execCommand insertText（會觸發 ProseMirror 認得的 input 事件）
  try { ok = document.execCommand("insertText", false, text); } catch (e) { ok = false; }

  // 方法 2：後援——dispatch beforeinput / input
  if (!ok || (editor.textContent || "").indexOf(text) === -1) {
    try {
      editor.dispatchEvent(new InputEvent("beforeinput", {
        inputType: "insertText", data: text, bubbles: true, cancelable: true
      }));
      if ((editor.textContent || "").indexOf(text) === -1) {
        editor.textContent = text; // 最後手段：直接塞
      }
      editor.dispatchEvent(new InputEvent("input", {
        inputType: "insertText", data: text, bubbles: true
      }));
    } catch (e) {}
  }
}

async function clickSend(selectors) {
  let btn = qsFirst(selectors.sendButton);
  // 送出鈕常在偵測到輸入前是 disabled，等一下再抓
  for (let i = 0; i < 12 && (!btn || btn.disabled); i++) {
    await new Promise(r => setTimeout(r, 200));
    btn = qsFirst(selectors.sendButton);
  }
  if (btn && !btn.disabled) { btn.click(); return "button"; }

  // 後援：在輸入框送 Enter（非 Shift）
  const editor = qsFirst(selectors.editor);
  if (editor) {
    editor.focus();
    const opts = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
    editor.dispatchEvent(new KeyboardEvent("keydown", opts));
    editor.dispatchEvent(new KeyboardEvent("keyup", opts));
    return "enter";
  }
  return null;
}

async function doSend(text, selectors) {
  const editor = qsFirst(selectors.editor);
  if (!editor) {
    return { ok: false, error: "找不到輸入框（editor selector 不對）", selectorsTried: selectors.editor };
  }
  insertText(editor, text);
  await new Promise(r => setTimeout(r, 500));

  const method = await clickSend(selectors);
  if (!method) {
    return { ok: false, error: "找不到送出鈕，且 Enter 後援失敗", selectorsTried: selectors.sendButton };
  }
  await new Promise(r => setTimeout(r, 1200));
  const cleared = ((qsFirst(selectors.editor) || {}).textContent || "").trim() === "";
  return {
    ok: true,
    method,
    cleared,
    note: cleared ? "輸入框已清空，研判已送出。" : "輸入框未清空，可能未送出——請檢查 selector / 看 console。"
  };
}

// ---------- 偵測限制橫幅 ----------

const LIMIT_HINTS = [
  /usage limit/i, /message limit/i, /limit reached/i, /will reset/i, /resets? (at|in)/i,
  /限制/, /上限/, /額度/, /用量/, /重置/, /恢復/
];

function scanForLimitBanner() {
  const nodes = document.querySelectorAll("div, section, span, p, li");
  for (const el of nodes) {
    const t = (el.innerText || "").trim();
    if (!t || t.length > 300) continue;
    const hinted = LIMIT_HINTS.some(re => re.test(t));
    const hasTimeish = /reset|重置|恢復|until|至|點|:|\d\s*(am|pm)/i.test(t);
    if (hinted && hasTimeish) return t;
  }
  return null;
}

function parseResetTime(text) {
  if (!text) return null;
  const t = text.replace(/：/g, ":");
  let hh = null, mm = 0;

  let m = t.match(/(\d{1,2}):(\d{2})\s*([AaPp][Mm])/);
  if (m) {
    hh = parseInt(m[1], 10); mm = parseInt(m[2], 10);
    const pm = /p/i.test(m[3]);
    if (pm && hh < 12) hh += 12;
    if (!pm && hh === 12) hh = 0;
  } else {
    const cm = t.match(/(凌晨|上午|中午|下午|晚上)\s*(\d{1,2}):?(\d{2})?/);
    if (cm) {
      hh = parseInt(cm[2], 10); mm = cm[3] ? parseInt(cm[3], 10) : 0;
      if (/下午|晚上/.test(cm[1]) && hh < 12) hh += 12;
      if (/中午/.test(cm[1])) hh = 12;
      if (/凌晨/.test(cm[1]) && hh === 12) hh = 0;
    } else {
      const h24 = t.match(/(\d{1,2}):(\d{2})/);
      if (h24) { hh = parseInt(h24[1], 10); mm = parseInt(h24[2], 10); }
    }
  }
  if (hh == null || isNaN(hh)) return null;

  const now = new Date();
  const d = new Date(now);
  d.setHours(hh, mm || 0, 0, 0);
  if (d.getTime() < now.getTime() - 2 * 60 * 1000) d.setDate(d.getDate() + 1); // 已過則視為明天
  return d.getTime();
}

function detectAndStore() {
  const raw = scanForLimitBanner();
  if (!raw) return null;
  const resetMs = parseResetTime(raw);
  chrome.storage.local.set({ detected: { rawText: raw, resetMs, at: Date.now() } });
  return { rawText: raw, resetMs };
}

// 載入時掃一次 + 觀察 DOM 變化（debounce）
let scanTimer = null;
function scheduleScan() {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(detectAndStore, 800);
}
try {
  detectAndStore();
  const mo = new MutationObserver(scheduleScan);
  mo.observe(document.documentElement, { childList: true, subtree: true });
} catch (e) {}

// ---------- 訊息處理 ----------

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "ping") { sendResponse({ ok: true }); return true; }
  if (msg.action === "rescan") {
    const r = detectAndStore();
    sendResponse({ ok: true, rawText: r && r.rawText, resetMs: r && r.resetMs });
    return true;
  }
  if (msg.action === "sendMessage") {
    doSend(msg.text, msg.selectors).then(r => sendResponse(r));
    return true; // 非同步
  }
  return false;
});
