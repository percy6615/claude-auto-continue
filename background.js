// background.js — service worker (MV3)
// 多時段排程：每個時段有自己的時間與文字（可各自指定對話）。

const SLOT_PREFIX = "cac-slot-";

const DEFAULTS = {
  conversationUrls: [],   // 預設對話（時段未填網址時用）
  defaultText: "繼續",
  sendDelayMs: 4000,
  betweenConvosMs: 8000,
  bufferSec: 45,
  schedule: [],           // [{ id, when, text, url, enabled }]
  selectors: {
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

function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

async function getConfig(){
  const { config } = await chrome.storage.local.get("config");
  const c = config || {};
  return { ...DEFAULTS, ...c, selectors: { ...DEFAULTS.selectors, ...(c.selectors||{}) } };
}

async function patchSlotStatus(id, patch){
  const { status } = await chrome.storage.local.get("status");
  const s = status || {};
  s.slots = s.slots || {};
  s.slots[id] = { ...(s.slots[id]||{}), ...patch, updatedAt: Date.now() };
  await chrome.storage.local.set({ status: s });
}

async function clearAllSlotAlarms(){
  const all = await chrome.alarms.getAll();
  await Promise.all(
    all.filter(a=>a.name.startsWith(SLOT_PREFIX)).map(a=>chrome.alarms.clear(a.name))
  );
}

async function armSchedule(){
  const cfg = await getConfig();
  await clearAllSlotAlarms();
  const now = Date.now();
  let count = 0;
  for (const slot of (cfg.schedule||[])){
    if (slot.enabled === false) continue;
    if (!slot.when || slot.when <= now) continue;          // 過期或未填時間者跳過
    await chrome.alarms.create(SLOT_PREFIX + slot.id, { when: slot.when + cfg.bufferSec*1000 });
    count++;
  }
  return count;
}

chrome.alarms.onAlarm.addListener(async (alarm)=>{
  if (!alarm.name.startsWith(SLOT_PREFIX)) return;
  const id = alarm.name.slice(SLOT_PREFIX.length);
  await runSlot(id, "alarm");
});

async function findOrCreateTab(url){
  const base = u => (u||"").split("#")[0];
  const tabs = await chrome.tabs.query({ url: "https://claude.ai/*" });
  let tab = tabs.find(t => base(t.url).startsWith(base(url)));
  if (tab){
    await chrome.tabs.update(tab.id, { active: true });
    if (base(tab.url) !== base(url)) await chrome.tabs.update(tab.id, { url });
    return tab.id;
  }
  if (tabs[0]){ await chrome.tabs.update(tabs[0].id, { active: true, url }); return tabs[0].id; }
  const created = await chrome.tabs.create({ url, active: true });
  return created.id;
}

async function pingContent(tabId, timeoutMs=20000){
  const start = Date.now();
  while (Date.now()-start < timeoutMs){
    try { const res = await chrome.tabs.sendMessage(tabId, { action:"ping" }); if (res && res.ok) return true; }
    catch(e){}
    await wait(700);
  }
  return false;
}

async function sendToTab(tabId, text, selectors){
  try {
    const res = await chrome.tabs.sendMessage(tabId, { action:"sendMessage", text, selectors });
    return res || { ok:false, error:"content script 無回應" };
  } catch(e){ return { ok:false, error:String(e) }; }
}

async function doSendJob(text, urls, cfg){
  urls = (urls||[]).map(s=>s.trim()).filter(Boolean);
  if (urls.length === 0) return { ok:false, error:"沒有可用的對話 URL（時段未填、預設也空）", results:[] };
  const results = [];
  for (let i=0;i<urls.length;i++){
    const url = urls[i];
    try {
      const tabId = await findOrCreateTab(url);
      const ready = await pingContent(tabId);
      if (!ready){ results.push({ url, ok:false, error:"content script 未就緒" }); continue; }
      await wait(cfg.sendDelayMs);
      const r = await sendToTab(tabId, text, cfg.selectors);
      results.push({ url, ...r });
    } catch(e){ results.push({ url, ok:false, error:String(e) }); }
    if (i < urls.length-1) await wait(cfg.betweenConvosMs);
  }
  const ok = results.length>0 && results.every(r=>r.ok);
  return { ok, results };
}

async function runSlot(id, trigger){
  const cfg = await getConfig();
  const slot = (cfg.schedule||[]).find(s=>s.id===id);
  if (!slot){
    await patchSlotStatus(id, { lastResult:{ ok:false, trigger, error:"找不到此時段", at:Date.now() } });
    return;
  }
  const urls = (slot.url && slot.url.trim()) ? [slot.url.trim()] : cfg.conversationUrls;
  const text = (slot.text && slot.text.trim()) ? slot.text : cfg.defaultText;
  const res = await doSendJob(text, urls, cfg);
  await patchSlotStatus(id, { lastResult:{ ...res, trigger, text, at:Date.now() } });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse)=>{
  (async()=>{
    try {
      if (msg.action === "armSchedule"){
        const count = await armSchedule();
        sendResponse({ ok:true, count });
      } else if (msg.action === "cancelAll"){
        await clearAllSlotAlarms();
        sendResponse({ ok:true });
      } else if (msg.action === "testSend"){
        const cfg = await getConfig();
        const urls = (msg.url && msg.url.trim()) ? [msg.url.trim()] : cfg.conversationUrls;
        const text = (msg.text && msg.text.trim()) ? msg.text : cfg.defaultText;
        const result = await doSendJob(text, urls, cfg);
        sendResponse({ ok:true, result });
      } else if (msg.action === "getStatus"){
        const { status } = await chrome.storage.local.get("status");
        const alarms = await chrome.alarms.getAll();
        const slotAlarms = {};
        for (const a of alarms){
          if (a.name.startsWith(SLOT_PREFIX)) slotAlarms[a.name.slice(SLOT_PREFIX.length)] = a.scheduledTime;
        }
        sendResponse({ ok:true, status: status||{}, slotAlarms });
      } else {
        sendResponse({ ok:false, error:"unknown action" });
      }
    } catch(e){ sendResponse({ ok:false, error:String(e) }); }
  })();
  return true; // 非同步回應
});