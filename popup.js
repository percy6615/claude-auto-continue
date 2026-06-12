// popup.js

const $ = (id) => document.getElementById(id);

function toLocalInput(ms) {
  if (!ms) return "";
  const d = new Date(ms - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}
function fromLocalInput(v) {
  if (!v) return null;
  const t = new Date(v).getTime();
  return isNaN(t) ? null : t;
}
function fmt(ms) {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

async function loadConfig() {
  const { config } = await chrome.storage.local.get("config");
  const c = config || {};
  $("urls").value = (c.conversationUrls || []).join("\n");
  $("msg").value = c.messageText || "繼續";
  $("selEditor").value = (c.selectors && c.selectors.editor ? c.selectors.editor : [
    "div.ProseMirror[contenteditable='true']",
    "div[contenteditable='true'].ProseMirror",
    "[contenteditable='true']"
  ]).join("\n");
  $("selSend").value = (c.selectors && c.selectors.sendButton ? c.selectors.sendButton : [
    "button[aria-label*='Send' i]",
    "button[aria-label*='送出']",
    "button[data-testid*='send' i]",
    "fieldset button[type='submit']"
  ]).join("\n");
  $("sendDelay").value = c.sendDelayMs != null ? c.sendDelayMs : 4000;
}

function gatherConfig() {
  const lines = (id) => $(id).value.split("\n").map(s => s.trim()).filter(Boolean);
  return {
    conversationUrls: lines("urls"),
    messageText: $("msg").value || "繼續",
    sendDelayMs: parseInt($("sendDelay").value, 10) || 4000,
    selectors: { editor: lines("selEditor"), sendButton: lines("selSend") }
  };
}

async function saveConfig() {
  await chrome.storage.local.set({ config: gatherConfig() });
}

async function refreshDetected() {
  const { detected } = await chrome.storage.local.get("detected");
  if (detected && detected.rawText) {
    $("detectedText").innerHTML =
      "原文：<code>" + detected.rawText.replace(/</g, "&lt;").slice(0, 200) + "</code><br>" +
      "解析重置時間：" + (detected.resetMs ? fmt(detected.resetMs) : "<span class='bad'>解析失敗，請手動填</span>");
    if (detected.resetMs && !$("resetAt").value) $("resetAt").value = toLocalInput(detected.resetMs);
  } else {
    $("detectedText").textContent = "（尚無，按「重新掃描」）";
  }
}

async function refreshStatus() {
  const res = await chrome.runtime.sendMessage({ action: "getStatus" });
  const s = (res && res.status) || {};
  let html = "";
  if (s.armed && s.nextFire) html += "<span class='ok'>已排程</span>，預定觸發：" + fmt(s.nextFire) + "<br>";
  else html += "未排程<br>";
  if (s.lastResult) {
    const r = s.lastResult;
    html += "上次（" + (r.trigger || "") + " @ " + fmt(r.at) + "）：" +
      (r.ok ? "<span class='ok'>成功</span>" : "<span class='bad'>失敗</span>") + "<br>";
    if (r.error) html += "錯誤：" + r.error + "<br>";
    if (r.results) {
      for (const x of r.results) {
        html += "• " + (x.ok ? "✅" : "❌") + " " +
          (x.method ? "(" + x.method + ") " : "") + (x.error || x.note || "") + "<br>";
      }
    }
  }
  $("statusText").innerHTML = html;
}

$("rescan").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/claude\.ai\//.test(tab.url || "")) {
    $("detectedText").innerHTML = "<span class='bad'>請先切到 claude.ai 分頁再掃描。</span>";
    return;
  }
  try { await chrome.tabs.sendMessage(tab.id, { action: "rescan" }); } catch (e) {}
  setTimeout(refreshDetected, 400);
};

$("useDetected").onclick = async () => {
  const { detected } = await chrome.storage.local.get("detected");
  if (detected && detected.resetMs) $("resetAt").value = toLocalInput(detected.resetMs);
};

$("save").onclick = async () => { await saveConfig(); $("statusText").textContent = "已儲存。"; };

$("arm").onclick = async () => {
  await saveConfig();
  const ms = fromLocalInput($("resetAt").value);
  if (!ms) { $("statusText").innerHTML = "<span class='bad'>請先填重置時間。</span>"; return; }
  const res = await chrome.runtime.sendMessage({ action: "arm", resetTimeMs: ms });
  if (res && res.ok) $("statusText").innerHTML = "<span class='ok'>已排程</span>，觸發：" + fmt(res.when);
  setTimeout(refreshStatus, 300);
};

$("test").onclick = async () => {
  await saveConfig();
  $("statusText").textContent = "測試送出中…";
  await chrome.runtime.sendMessage({ action: "testNow" });
  setTimeout(refreshStatus, 500);
};

$("cancel").onclick = async () => {
  await chrome.runtime.sendMessage({ action: "cancel" });
  setTimeout(refreshStatus, 200);
};

(async function init() {
  await loadConfig();
  await refreshDetected();
  await refreshStatus();
})();
