// Follow-Up Generator (MV3 popup)
// IMPORTANT: set this to your worker
const WORKER_URL = "https://follow-up-bot.sethutsman.workers.dev/";

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);

function setStatus(msg) {
  const el = $("status");
  if (el) el.textContent = msg || "";
}

async function copyText(text) {
  if (!text) return;
  await navigator.clipboard.writeText(text);
}

function normalizeReminders(reminders) {
  if (!Array.isArray(reminders)) return "";
  return reminders.map(r => `- ${String(r)}`).join("\n");
}

function blankOutputs() {
  $("followup_best").textContent = "";
  $("followup_soft").textContent = "";
  $("followup_neutral").textContent = "";
  $("followup_assertive").textContent = "";
  $("reminders").textContent = "";
}

function setOutputs(out) {
  $("followup_best").textContent = out.followup_best || "";
  $("followup_soft").textContent = out.followup_soft || "";
  $("followup_neutral").textContent = out.followup_neutral || "";
  $("followup_assertive").textContent = out.followup_assertive || "";
  $("reminders").textContent = normalizeReminders(out.reminders || []);
}

// ---------- persistence ----------
const STORAGE_KEY = "followup_popup_state_v2";

function getStateFromUI() {
  return {
    stage: $("stage").value || "",
    customer: $("customer").value || "",
    vehicle: $("vehicle").value || "",

    lead_source: $("lead_source").value || "",
    budget: $("budget").value || "",
    timeline: $("timeline").value || "",
    trade: $("trade").value || "",
    objections: $("objections").value || "",

    days_since: $("days_since").value || "",
    last_message: $("last_message").value || "",
    last_was_question: $("last_was_question").value || "",
    tone: $("tone").value || "",

    raw_note: $("raw_note").value || "",

    include_followup: $("include_followup").checked,
    include_reminders: $("include_reminders").checked,

    outputs: {
      followup_best: $("followup_best").textContent || "",
      followup_soft: $("followup_soft").textContent || "",
      followup_neutral: $("followup_neutral").textContent || "",
      followup_assertive: $("followup_assertive").textContent || "",
      reminders: $("reminders").textContent || "",
    }
  };
}

function applyStateToUI(state) {
  if (!state) return;

  $("stage").value = state.stage ?? "";
  $("customer").value = state.customer ?? "";
  $("vehicle").value = state.vehicle ?? "";

  $("lead_source").value = state.lead_source ?? "";
  $("budget").value = state.budget ?? "";
  $("timeline").value = state.timeline ?? "";
  $("trade").value = state.trade ?? "";
  $("objections").value = state.objections ?? "";

  $("days_since").value = state.days_since ?? "";
  $("last_message").value = state.last_message ?? "";
  $("last_was_question").value = state.last_was_question ?? "";
  $("tone").value = state.tone ?? "";
  $("raw_note").value = state.raw_note ?? "";

  $("include_followup").checked = state.include_followup ?? true;
  $("include_reminders").checked = state.include_reminders ?? true;

  if (state.outputs) {
    $("followup_best").textContent = state.outputs.followup_best || "";
    $("followup_soft").textContent = state.outputs.followup_soft || "";
    $("followup_neutral").textContent = state.outputs.followup_neutral || "";
    $("followup_assertive").textContent = state.outputs.followup_assertive || "";
    $("reminders").textContent = state.outputs.reminders || "";
  }
}

async function saveState() {
  await chrome.storage.local.set({ [STORAGE_KEY]: getStateFromUI() });
}

async function loadState() {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  return res[STORAGE_KEY];
}

function wireAutoSave() {
  const ids = [
    "stage","customer","vehicle",
    "lead_source","budget","timeline","trade","objections",
    "days_since","last_message","last_was_question","tone","raw_note",
    "include_followup","include_reminders"
  ];
  ids.forEach((id) => {
    const el = $(id);
    if (!el) return;
    el.addEventListener("input", () => saveState());
    el.addEventListener("change", () => saveState());
  });
}

// ---------- MV3 scripting helpers ----------
async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function execInTab(func, args = []) {
  const tab = await getActiveTab();
  if (!tab?.id) throw new Error("No active tab.");
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func,
    args
  });
  return results?.[0]?.result;
}

async function getSelectionText() {
  return execInTab(() => window.getSelection ? String(window.getSelection().toString() || "") : "");
}

// Best-effort scrape (you'll likely refine selectors for VinSolutions later)
async function scrapeBestEffort() {
  return execInTab(() => {
    const text = (sel) => document.querySelector(sel)?.textContent?.trim() || "";
    const customer = text("[data-testid='customer-name']") || text(".customerName") || "";
    const vehicle = text("[data-testid='vehicle']") || text(".vehicle") || "";
    return { customer, vehicle };
  });
}

// ---------- worker response normalization ----------
function normalizeWorkerResponse(json) {
  // Preferred shape: followup_* keys
  if (json && (json.followup_best || json.followup_soft || json.followup_neutral || json.followup_assertive)) {
    return {
      followup_best: json.followup_best || "",
      followup_soft: json.followup_soft || "",
      followup_neutral: json.followup_neutral || "",
      followup_assertive: json.followup_assertive || "",
      reminders: Array.isArray(json.reminders) ? json.reminders : [],
    };
  }

  // Legacy: {mode, options:[{label,text}]}
  if (json && Array.isArray(json.options)) {
    const out = { followup_soft:"", followup_neutral:"", followup_assertive:"", followup_best:"", reminders:[] };
    for (const opt of json.options) {
      const label = String(opt?.label || "").toLowerCase();
      const t = String(opt?.text || "").trim();
      if (!t) continue;
      if (label.includes("best")) out.followup_best = t;
      else if (label.includes("soft")) out.followup_soft = t;
      else if (label.includes("neutral")) out.followup_neutral = t;
      else if (label.includes("assert")) out.followup_assertive = t;
    }
    if (!out.followup_best) out.followup_best = out.followup_neutral || out.followup_soft || out.followup_assertive || "";
    out.reminders = Array.isArray(json.reminders) ? json.reminders : [];
    return out;
  }

  return null;
}

// ---------- main ----------
async function generate() {
  setStatus("Working...");
  blankOutputs();

  const raw_note = $("raw_note").value.trim();
  const last_message = $("last_message").value.trim();

  // Require at least something to work with
  if (!raw_note && !last_message) {
    setStatus("Add Raw Note OR Lead’s last message (one of them is required).");
    return;
  }

  const payload = {
    // Back-compat: always send raw_note, derived from last_message if needed
    raw_note: raw_note || last_message,

    stage: $("stage").value.trim(),
    customer: $("customer").value.trim(),
    vehicle: $("vehicle").value.trim(),

    lead_source: $("lead_source").value.trim(),
    budget: $("budget").value.trim(),
    timeline: $("timeline").value.trim(),
    trade: $("trade").value.trim(),
    objections: $("objections").value.trim(),

    last_message: last_message,
    days_since: Number($("days_since").value || 0),
    last_was_question: $("last_was_question").value.trim(),
    tone: $("tone").value.trim(),

    include_followup: $("include_followup").checked,
    include_reminders: $("include_reminders").checked,
  };

  console.log("PAYLOAD", payload);

  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const text = await res.text();
    console.log("STATUS", res.status);
    console.log("RAW RESPONSE", text);

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      setStatus("Worker did not return JSON. Check console.");
      return;
    }

    if (!res.ok) {
      setStatus(json?.error ? `Error: ${json.error}` : `Error: ${res.status}`);
      return;
    }

    const out = normalizeWorkerResponse(json);
    if (!out) {
      setStatus("Response shape not recognized. Check console.");
      return;
    }

    setOutputs(out);
    await saveState();
    setStatus("Done.");
  } catch (e) {
    console.error(e);
    setStatus("Network error. Check console.");
  }
}

// ---------- wiring ----------
document.addEventListener("click", async (e) => {
  const t = e.target;

  if (t?.id === "btnGenerate") {
    await generate();
  }

  if (t?.id === "btnCopyBest") {
    const best = $("followup_best").textContent.trim();
    if (!best) return setStatus("Nothing to copy.");
    await copyText(best);
    setStatus("Copied Best.");
  }

  if (t?.id === "btnSelection") {
    try {
      const sel = await getSelectionText();
      if (!sel) return setStatus("No selected text found.");
      $("raw_note").value = sel;
      await saveState();
      setStatus("Selected text inserted.");
    } catch (err) {
      console.error(err);
      setStatus("Selection failed (check permissions / active tab).");
    }
  }

  if (t?.id === "btnScrape") {
    try {
      const data = await scrapeBestEffort();
      if (data?.customer && !$("customer").value.trim()) $("customer").value = data.customer;
      if (data?.vehicle && !$("vehicle").value.trim()) $("vehicle").value = data.vehicle;
      await saveState();
      setStatus("Auto-fill attempted.");
    } catch (err) {
      console.error(err);
      setStatus("Auto-fill failed (needs selectors + permissions).");
    }
  }

  const key = t?.dataset?.copy;
  if (key) {
    let text = "";
    if (key === "reminders") text = $("reminders").textContent.trim();
    else text = $(key)?.textContent?.trim() || "";
    if (!text) return setStatus("Nothing to copy.");
    await copyText(text);
    setStatus(`Copied ${key}.`);
  }
});

// init
(async function init() {
  const state = await loadState();
  applyStateToUI(state);
  wireAutoSave();
})();
