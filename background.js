// background.js — service worker (MV3)
// 負責：排程 alarm、到時開啟/聚焦對話分頁、請 content script 送出訊息。

const ALARM_NAME = "claude-auto-continue";

const DEFAULTS = {
  conversationUrls: [],     // 一行一個 https://claude.ai/chat/<uuid>
  messageText: "繼續",
  sendDelayMs: 4000,        // 頁面載入後、送出前等待（讓對話與輸入框 render）
  betweenConvosMs: 8000,    // 多個對話之間的間隔
  bufferSec: 45,            // 在重置時間之後再多等這幾秒才動作（保險）
  selectors: {
    // 可在 popup「進階」覆寫；先放常見猜測，校準後請換成你的真實 selector
    editor: [
      "div.ProseMirror[contenteditable='true']",
      "div[contenteditable='true'].ProseMirror",
      "[contenteditable='true']"
    ],
    sendButton: [
      "button[aria-label*='Send' i]",
      "button[aria-label*='送出']",
      "button[data-testid*='send' i]",
      "fieldset button[type='submit']",
      "button:has(svg)"
    ]
  }
};

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getConfig() {
  const { config } = await chrome.storage.local.get("config");
  const c = config || {};
  return {
    ...DEFAULTS,
    ...c,
    selectors: { ...DEFAULTS.selectors, ...(c.selectors || {}) }
  };
}

async function setStatus(patch) {
  const { status } = await chrome.storage.local.get("status");
  await chrome.storage.local.set({
    status: { ...(status || {}), ...patch, updatedAt: Date.now() }
  });
}

async function arm(resetTimeMs) {
  const cfg = await getConfig();
  const when = resetTimeMs + cfg.bufferSec * 1000;
  await chrome.alarms.clear(ALARM_NAME);
  await chrome.alarms.create(ALARM_NAME, { when });
  await setStatus({ armed: true, nextFire: when, lastResult: null });
  return when;
}

async function cancel() {
  await chrome.alarms.clear(ALARM_NAME);
  await setStatus({ armed: false, nextFire: null });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  await setStatus({ armed: false, nextFire: null });
  await runContinueJob("alarm");
});

async function findOrCreateTab(url) {
  const tabs = await chrome.tabs.query({ url: "https://claude.ai/*" });
  // 已經在這個對話的分頁
  let tab = tabs.find(t => t.url && t.url.split("#")[0].startsWith(url.split("#")[0]));
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    if (tab.url.split("#")[0] !== url.split("#")[0]) {
      await chrome.tabs.update(tab.id, { url });
    }
    return tab.id;
  }
  // 重用任何 claude.ai 分頁
  if (tabs[0]) {
    await chrome.tabs.update(tabs[0].id, { active: true, url });
    return tabs[0].id;
  }
  // 否則開新分頁
  const created = await chrome.tabs.create({ url, active: true });
  return created.id;
}

async function pingContent(tabId, timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { action: "ping" });
      if (res && res.ok) return true;
    } catch (e) { /* content script 尚未就緒 */ }
    await wait(700);
  }
  return false;
}

async function sendToTab(tabId, text, selectors) {
  try {
    const res = await chrome.tabs.sendMessage(tabId, { action: "sendMessage", text, selectors });
    return res || { ok: false, error: "content script 無回應" };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

async function runContinueJob(trigger) {
  const cfg = await getConfig();
  const urls = (cfg.conversationUrls || []).map(s => s.trim()).filter(Boolean);
  if (urls.length === 0) {
    await setStatus({ lastResult: { ok: false, trigger, error: "尚未設定對話 URL", at: Date.now() } });
    return;
  }
  const results = [];
  for (let i = 0; i < urls.length; i++) {
    const url = urls[i];
    try {
      const tabId = await findOrCreateTab(url);
      const ready = await pingContent(tabId);
      if (!ready) { results.push({ url, ok: false, error: "content script 未就緒（頁面可能未載入完成）" }); continue; }
      await wait(cfg.sendDelayMs);
      const r = await sendToTab(tabId, cfg.messageText, cfg.selectors);
      results.push({ url, ...r });
    } catch (e) {
      results.push({ url, ok: false, error: String(e) });
    }
    if (i < urls.length - 1) await wait(cfg.betweenConvosMs);
  }
  const ok = results.length > 0 && results.every(r => r.ok);
  await setStatus({ lastResult: { ok, trigger, results, at: Date.now() } });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.action === "arm") {
        const when = await arm(msg.resetTimeMs);
        sendResponse({ ok: true, when });
      } else if (msg.action === "cancel") {
        await cancel();
        sendResponse({ ok: true });
      } else if (msg.action === "testNow") {
        await runContinueJob("test");
        const { status } = await chrome.storage.local.get("status");
        sendResponse({ ok: true, status });
      } else if (msg.action === "getStatus") {
        const { status } = await chrome.storage.local.get("status");
        const alarm = await chrome.alarms.get(ALARM_NAME);
        sendResponse({ ok: true, status: status || {}, alarm: alarm || null });
      } else {
        sendResponse({ ok: false, error: "unknown action" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();
  return true; // 非同步回應
});
