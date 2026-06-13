// popup.js — 多時段

const $ = (id) => document.getElementById(id);

function newId(){ return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
function toLocalInput(ms){
  if (!ms) return "";
  const d = new Date(ms - new Date().getTimezoneOffset()*60000);
  return d.toISOString().slice(0,16);
}
function fromLocalInput(v){ if (!v) return null; const t = new Date(v).getTime(); return isNaN(t) ? null : t; }
function fmt(ms){ return ms ? new Date(ms).toLocaleString() : "—"; }

function addSlotRow(slot){
  slot = slot || {};
  const id = slot.id || newId();
  const node = $("slotTpl").content.firstElementChild.cloneNode(true);
  node.dataset.id = id;
  node.querySelector(".en").checked = slot.enabled !== false;
  node.querySelector(".when").value = toLocalInput(slot.when);
  node.querySelector(".text").value = slot.text || $("defaultText").value || "繼續";
  node.querySelector(".url").value = slot.url || "";

  node.querySelector(".del").onclick = () => node.remove();
  node.querySelector(".test").onclick = async () => {
    await saveConfig();
    const ss = node.querySelector(".sstatus");
    ss.textContent = "測試送出中…";
    const res = await chrome.runtime.sendMessage({
      action: "testSend",
      text: node.querySelector(".text").value,
      url: node.querySelector(".url").value
    });
    const r = res && res.result;
    if (r && r.ok) ss.innerHTML = "<span class='ok'>測試成功</span>";
    else ss.innerHTML = "<span class='bad'>測試失敗：" + ((r && (r.error || (r.results||[]).map(x=>x.error||x.note).join("; "))) || "未知") + "</span>";
  };

  $("slots").appendChild(node);
  return node;
}

function gatherSlots(){
  return Array.from($("slots").children).map(node => ({
    id: node.dataset.id,
    enabled: node.querySelector(".en").checked,
    when: fromLocalInput(node.querySelector(".when").value),
    text: node.querySelector(".text").value,
    url: node.querySelector(".url").value.trim()
  }));
}

function gatherConfig(){
  const lines = (id) => $(id).value.split("\n").map(s=>s.trim()).filter(Boolean);
  return {
    conversationUrls: lines("urls"),
    defaultText: $("defaultText").value || "繼續",
    sendDelayMs: parseInt($("sendDelay").value,10) || 4000,
    schedule: gatherSlots(),
    selectors: { editor: lines("selEditor"), sendButton: lines("selSend") }
  };
}

async function saveConfig(){ await chrome.storage.local.set({ config: gatherConfig() }); }

async function loadConfig(){
  const { config } = await chrome.storage.local.get("config");
  const c = config || {};
  $("urls").value = (c.conversationUrls || []).join("\n");
  $("defaultText").value = c.defaultText || "繼續";
  $("selEditor").value = ((c.selectors && c.selectors.editor) || [
    "div.ProseMirror[contenteditable='true']",
    "div[contenteditable='true'].ProseMirror",
    "[contenteditable='true']"
  ]).join("\n");
  $("selSend").value = ((c.selectors && c.selectors.sendButton) || [
    "button[aria-label*='Send' i]",
    "button[aria-label*='送出']",
    "button[data-testid*='send' i]",
    "fieldset button[type='submit']"
  ]).join("\n");
  $("sendDelay").value = c.sendDelayMs != null ? c.sendDelayMs : 4000;
  $("slots").innerHTML = "";
  (c.schedule || []).forEach(addSlotRow);
}

async function refreshDetected(){
  const { detected } = await chrome.storage.local.get("detected");
  if (detected && detected.rawText){
    $("detectedText").innerHTML =
      "原文：<code>" + detected.rawText.replace(/</g,"&lt;").slice(0,180) + "</code><br>" +
      "解析重置時間：" + (detected.resetMs ? fmt(detected.resetMs) : "<span class='bad'>解析失敗，請手動填</span>");
  } else {
    $("detectedText").textContent = "（按「重新掃描」）";
  }
}

async function refreshStatus(){
  const res = await chrome.runtime.sendMessage({ action: "getStatus" });
  const status = (res && res.status) || {};
  const slotAlarms = (res && res.slotAlarms) || {};
  const slotStatus = status.slots || {};

  // 全域摘要
  const armedCount = Object.keys(slotAlarms).length;
  $("statusText").innerHTML = armedCount
    ? "<span class='ok'>" + armedCount + " 個時段已排程</span>"
    : "目前沒有排程";

  // 各時段
  Array.from($("slots").children).forEach(node => {
    const id = node.dataset.id;
    const ss = node.querySelector(".sstatus");
    let html = "";
    if (slotAlarms[id]) html += "⏰ " + fmt(slotAlarms[id]) + " 觸發　";
    const lr = slotStatus[id] && slotStatus[id].lastResult;
    if (lr){
      html += "上次(" + (lr.trigger||"") + ")：" + (lr.ok ? "<span class='ok'>成功</span>" : "<span class='bad'>失敗</span>");
      if (!lr.ok){
        const err = lr.error || (lr.results||[]).map(x=>x.error||x.note).filter(Boolean).join("; ");
        if (err) html += " " + err;
      }
    }
    ss.innerHTML = html;
  });
}

$("addSlot").onclick = () => { addSlotRow({}); };

$("addDetected").onclick = async () => {
  const { detected } = await chrome.storage.local.get("detected");
  addSlotRow({ when: detected && detected.resetMs ? detected.resetMs : Date.now() + 5*3600*1000 });
};

$("rescan").onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/claude\.ai\//.test(tab.url || "")){
    $("detectedText").innerHTML = "<span class='bad'>請先切到 claude.ai 分頁再掃描。</span>"; return;
  }
  try { await chrome.tabs.sendMessage(tab.id, { action: "rescan" }); } catch(e){}
  setTimeout(refreshDetected, 400);
};

$("save").onclick = async () => { await saveConfig(); $("statusText").textContent = "已儲存。"; };

$("arm").onclick = async () => {
  await saveConfig();
  const res = await chrome.runtime.sendMessage({ action: "armSchedule" });
  if (res && res.ok) $("statusText").innerHTML = "<span class='ok'>已排程 " + res.count + " 個時段</span>（過期或未填時間者略過）";
  setTimeout(refreshStatus, 300);
};

$("cancel").onclick = async () => {
  await chrome.runtime.sendMessage({ action: "cancelAll" });
  setTimeout(refreshStatus, 200);
};

(async function init(){
  await loadConfig();
  if ($("slots").children.length === 0) addSlotRow({});
  await refreshDetected();
  await refreshStatus();
})();