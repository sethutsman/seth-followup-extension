// Follow-Up Generator (MV3 popup)
// IMPORTANT: set this to your worker
const WORKER_URL = "https://follow-up-bot.sethutsman.workers.dev/";

// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const getText = (id) => $(id)?.textContent || "";
const setText = (id, value) => {
  const el = $(id);
  if (el) el.textContent = value ?? "";
};

const OUTPUT_FIELDS = [
  "followup_best",
  "followup_soft",
  "followup_neutral",
  "followup_assertive",
  "reminders",
];

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
function normalizeList(items) {
  if (!Array.isArray(items)) return "";
  return items.map(x => `- ${String(x)}`).join("\n");
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return "";
  return tags.map(t => String(t)).join(", ");
}

function normalizeGhost(ghost) {
  // ghost is {a,b} or strings; show as two bullets if present
  if (!ghost) return "";
  const a = String(ghost.a || "").trim();
  const b = String(ghost.b || "").trim();
  const parts = [];
  if (a) parts.push(`- ${a}`);
  if (b) parts.push(`- ${b}`);
  return parts.join("\n");
}

function blankOutputs() {
  OUTPUT_FIELDS.forEach((id) => setText(id, ""));

  // system mode fields
  setText("sys_mode", "—");
  setText("sys_health", "—");
  setText("reasoning_tags", "");
  setText("next_actions", "");
  setText("ghost_busters", "");
  const ghostCard = document.getElementById("ghostCard");
  if (ghostCard) ghostCard.style.display = "none";
}


function setOutputs(out) {
  // existing
  setText("followup_best", out.followup_best || "");
  setText("followup_soft", out.followup_soft || "");
  setText("followup_neutral", out.followup_neutral || "");
  setText("followup_assertive", out.followup_assertive || "");
  setText("reminders", normalizeReminders(out.reminders || []));

  // system mode
  setText("sys_mode", out.mode || "—");
  setText("sys_health", out.deal_health || "—");
  setText("reasoning_tags", normalizeTags(out.reasoning_tags || []));
  setText("next_actions", normalizeList(out.next_actions || []));

  const ghostText = normalizeGhost(out.ghost_busters || {});
  setText("ghost_busters", ghostText);

  const ghostCard = document.getElementById("ghostCard");
  if (ghostCard) ghostCard.style.display = (out.mode === "ghost" && ghostText) ? "block" : "none";
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
      followup_best: getText("followup_best"),
      followup_soft: getText("followup_soft"),
      followup_neutral: getText("followup_neutral"),
      followup_assertive: getText("followup_assertive"),
      reminders: getText("reminders"),

      sys_mode: getText("sys_mode") || "—",
      sys_health: getText("sys_health") || "—",
      reasoning_tags: getText("reasoning_tags"),
      next_actions: getText("next_actions"),
      ghost_busters: getText("ghost_busters"),
      ghost_visible: (document.getElementById("ghostCard")?.style.display || "none"),
    },
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
    setText("followup_best", state.outputs.followup_best || "");
    setText("followup_soft", state.outputs.followup_soft || "");
    setText("followup_neutral", state.outputs.followup_neutral || "");
    setText("followup_assertive", state.outputs.followup_assertive || "");
    setText("reminders", state.outputs.reminders || "");
    setText("sys_mode", state.outputs.sys_mode || "—");
    setText("sys_health", state.outputs.sys_health || "—");
    setText("reasoning_tags", state.outputs.reasoning_tags || "");
    setText("next_actions", state.outputs.next_actions || "");
    setText("ghost_busters", state.outputs.ghost_busters || "");

    const ghostCard = document.getElementById("ghostCard");
    if (ghostCard) {
      ghostCard.style.display = state.outputs.ghost_visible || "none";
    }
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
  return execInTab(() => {
    const selection = window.getSelection ? String(window.getSelection().toString() || "") : "";
    if (selection) return selection;

    const active = document.activeElement;
    const isInput = active && active.tagName === "INPUT";
    const isTextArea = active && active.tagName === "TEXTAREA";
    if (isInput || isTextArea) {
      const type = isInput ? (active.getAttribute("type") || "text").toLowerCase() : "textarea";
      const supportsSelection = isTextArea || ["text", "search", "url", "email", "tel", "number"].includes(type);
      if (supportsSelection && typeof active.selectionStart === "number" && typeof active.selectionEnd === "number") {
        return String(active.value || "").slice(active.selectionStart, active.selectionEnd);
      }
    }

    return "";
  });
}

// Best-effort scrape (you'll likely refine selectors for VinSolutions later)
async function scrapeBestEffort() {
  return execInTab(() => {
    const NAV_TAGS = new Set(["NAV", "HEADER", "ASIDE", "FOOTER"]);

    // Walk up to check if el is inside a nav/header/aside
    function inNavArea(el) {
      let node = el;
      while (node && node !== document.body) {
        if (NAV_TAGS.has(node.tagName)) return true;
        const role = node.getAttribute?.("role") || "";
        if (role === "navigation" || role === "banner" || role === "menubar") return true;
        node = node.parentElement;
      }
      return false;
    }

    // Only accept inputs, selects, or short text nodes that aren't nav items / anchors
    function readText(el) {
      if (!el) return "";
      if (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA") {
        return (el.value || "").trim();
      }
      if (el.tagName === "A") return ""; // skip nav links
      const text = el.textContent?.trim() || "";
      // Skip anything that looks like a nav label (very long or contains slashes/pipes)
      if (text.length > 60 || /[|/\\]/.test(text)) return "";
      return text;
    }

    function fromSelectors(selectors) {
      for (const sel of selectors) {
        const all = [...document.querySelectorAll(sel)];
        for (const el of all) {
          if (inNavArea(el)) continue;
          const value = readText(el);
          if (value) return value;
        }
      }
      return "";
    }

    const customer = fromSelectors([
      "#ContentPlaceHolder1_m_CustomerAndTaskInfo_m_CustomerInfo__CustomerName",
      ".CustomerInfo_CustomerName",
    ]);
    const vehicle = fromSelectors([
      "#ActiveLeadPanelWONotesAndHistory1_m_VehicleInfo",
    ]);
    const trade = fromSelectors([
      "#TradeIn1BasicInfo",
    ]);
    return { customer, vehicle, trade };
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
function buildFollowupsPack() {
  const best = $("followup_best").textContent.trim();
  const soft = $("followup_soft").textContent.trim();
  const neutral = $("followup_neutral").textContent.trim();
  const assertive = $("followup_assertive").textContent.trim();

  const parts = [];
  if (best) parts.push(`BEST:\n${best}`);
  if (soft) parts.push(`\nSOFT:\n${soft}`);
  if (neutral) parts.push(`\nNEUTRAL:\n${neutral}`);
  if (assertive) parts.push(`\nASSERTIVE:\n${assertive}`);

  return parts.join("\n");
}

function buildActionsPack() {
  const reminders = $("reminders").textContent.trim();
  const nextActions = $("next_actions").textContent.trim();
  const tags = $("reasoning_tags").textContent.trim();

  const parts = [];
  if (tags) parts.push(`TAGS:\n${tags}`);
  if (reminders) parts.push(`\nREMINDERS:\n${reminders}`);
  if (nextActions) parts.push(`\nNEXT ACTIONS:\n${nextActions}`);

  // Ghost busters only if visible + present
  const ghostCard = document.getElementById("ghostCard");
  const ghost = $("ghost_busters").textContent.trim();
  if (ghostCard && ghostCard.style.display !== "none" && ghost) {
    parts.push(`\nGHOST BUSTERS:\n${ghost}`);
  }

  return parts.join("\n");
}

function buildEverythingPack() {
  const mode = $("sys_mode").textContent.trim();
  const health = $("sys_health").textContent.trim();

  const header = [];
  if (mode && mode !== "—") header.push(`MODE: ${mode}`);
  if (health && health !== "—") header.push(`DEAL: ${health}`);

  const parts = [];
  if (header.length) parts.push(header.join(" | "));
  const followups = buildFollowupsPack();
  const actions = buildActionsPack();

  if (followups) parts.push(followups);
  if (actions) parts.push(actions);

  return parts.join("\n\n");
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

    if (t?.id === "btnCopyFollowups") {
    const pack = buildFollowupsPack();
    if (!pack) return setStatus("No follow-ups to copy yet.");
    await copyText(pack);
    setStatus("Copied all follow-ups.");
  }

  if (t?.id === "btnCopyActions") {
    const pack = buildActionsPack();
    if (!pack) return setStatus("No reminders/actions to copy yet.");
    await copyText(pack);
    setStatus("Copied reminders + actions.");
  }

  if (t?.id === "btnCopyAll") {
    const pack = buildEverythingPack();
    if (!pack) return setStatus("Nothing to copy yet.");
    await copyText(pack);
    setStatus("Copied everything.");
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
      if (data?.trade && !$("trade").value.trim()) $("trade").value = data.trade;
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
    else if (key === "next_actions") text = $("next_actions").textContent.trim();
    else if (key === "reasoning_tags") text = $("reasoning_tags").textContent.trim();
    else if (key === "ghost_busters") text = $("ghost_busters").textContent.trim();
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
