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
];

// All input field IDs, in order
const INPUT_FIELDS = [
  "stage", "customer", "vehicle",
  "lead_source", "budget", "timeline", "trade", "objections",
  "days_since", "last_message", "last_was_question", "tone", "raw_note",
  "include_followup",
];
const CHECKBOX_FIELDS = new Set(["include_followup"]);

function setStatus(msg) {
  const el = $("status");
  if (el) el.textContent = msg || "";
}

async function copyText(text) {
  if (!text) return;
  await navigator.clipboard.writeText(text);
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

function setGhostVisible(visible) {
  const ghostCard = $("ghostCard");
  if (ghostCard) ghostCard.style.display = visible ? "block" : "none";
}

function blankOutputs() {
  OUTPUT_FIELDS.forEach((id) => setText(id, ""));
  setText("sys_mode", "—");
  setText("sys_health", "—");
  setText("reasoning_tags", "");
  setText("next_actions", "");
  setText("ghost_busters", "");
  setGhostVisible(false);
}

function setOutputs(out) {
  setText("followup_best", out.followup_best || "");
  setText("followup_soft", out.followup_soft || "");
  setText("followup_neutral", out.followup_neutral || "");
  setText("followup_assertive", out.followup_assertive || "");
  setText("sys_mode", out.mode || "—");
  setText("sys_health", out.deal_health || "—");
  setText("reasoning_tags", normalizeTags(out.reasoning_tags || []));
  setText("next_actions", normalizeList(out.next_actions || []));

  const ghostText = normalizeGhost(out.ghost_busters || {});
  setText("ghost_busters", ghostText);
  setGhostVisible(out.mode === "ghost" && !!ghostText);
}


// ---------- persistence ----------
const STORAGE_KEY = "followup_popup_state_v2";

function getStateFromUI() {
  const state = {};
  for (const id of INPUT_FIELDS) {
    const el = $(id);
    if (!el) continue;
    state[id] = CHECKBOX_FIELDS.has(id) ? el.checked : (el.value || "");
  }

  state.outputs = {
    followup_best: getText("followup_best"),
    followup_soft: getText("followup_soft"),
    followup_neutral: getText("followup_neutral"),
    followup_assertive: getText("followup_assertive"),
    sys_mode: getText("sys_mode") || "—",
    sys_health: getText("sys_health") || "—",
    reasoning_tags: getText("reasoning_tags"),
    next_actions: getText("next_actions"),
    ghost_busters: getText("ghost_busters"),
    ghost_visible: ($("ghostCard")?.style.display || "none"),
  };

  return state;
}

function applyStateToUI(state) {
  if (!state) return;

  for (const id of INPUT_FIELDS) {
    const el = $(id);
    if (!el) continue;
    if (CHECKBOX_FIELDS.has(id)) {
      el.checked = state[id] ?? true;
    } else {
      el.value = state[id] ?? "";
    }
  }

  if (state.outputs) {
    const o = state.outputs;
    setText("followup_best", o.followup_best || "");
    setText("followup_soft", o.followup_soft || "");
    setText("followup_neutral", o.followup_neutral || "");
    setText("followup_assertive", o.followup_assertive || "");
    setText("sys_mode", o.sys_mode || "—");
    setText("sys_health", o.sys_health || "—");
    setText("reasoning_tags", o.reasoning_tags || "");
    setText("next_actions", o.next_actions || "");
    setText("ghost_busters", o.ghost_busters || "");
    setGhostVisible(o.ghost_visible === "block");
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
  for (const id of INPUT_FIELDS) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener("input", () => saveState());
    el.addEventListener("change", () => saveState());
  }
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
    const readText = (el) => {
      if (!el) return "";
      if (typeof el.value === "string") return el.value.trim();
      return el.textContent?.trim() || "";
    };
    const fromSelectors = (selectors) => {
      for (const sel of selectors) {
        const value = readText(document.querySelector(sel));
        if (value) return value;
      }
      return "";
    };

    const customer = fromSelectors([
      "[data-testid='customer-name']",
      ".customerName",
      "[name*='customer']",
      "[id*='customer']",
      "[aria-label*='Customer']",
    ]);
    const vehicle = fromSelectors([
      "[data-testid='vehicle']",
      ".vehicle",
      "[name*='vehicle']",
      "[id*='vehicle']",
      "[aria-label*='Vehicle']",
    ]);
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
    };
  }

  // Legacy: {mode, options:[{label,text}]}
  if (json && Array.isArray(json.options)) {
    const out = { followup_soft: "", followup_neutral: "", followup_assertive: "", followup_best: "" };
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
    setStatus("Add Raw Note OR Lead's last message (one of them is required).");
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

    last_message,
    days_since: Number($("days_since").value || 0),
    last_was_question: $("last_was_question").value.trim(),
    tone: $("tone").value.trim(),

    include_followup: $("include_followup").checked,
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
  const best = getText("followup_best").trim();
  const soft = getText("followup_soft").trim();
  const neutral = getText("followup_neutral").trim();
  const assertive = getText("followup_assertive").trim();

  const parts = [];
  if (best) parts.push(`BEST:\n${best}`);
  if (soft) parts.push(`\nSOFT:\n${soft}`);
  if (neutral) parts.push(`\nNEUTRAL:\n${neutral}`);
  if (assertive) parts.push(`\nASSERTIVE:\n${assertive}`);

  return parts.join("\n");
}

function buildActionsPack() {
  const nextActions = getText("next_actions").trim();
  const tags = getText("reasoning_tags").trim();

  const parts = [];
  if (tags) parts.push(`TAGS:\n${tags}`);
  if (nextActions) parts.push(`\nNEXT ACTIONS:\n${nextActions}`);

  // Ghost busters only if visible + present
  const ghost = getText("ghost_busters").trim();
  if ($("ghostCard")?.style.display !== "none" && ghost) {
    parts.push(`\nGHOST BUSTERS:\n${ghost}`);
  }

  return parts.join("\n");
}

function buildEverythingPack() {
  const mode = getText("sys_mode").trim();
  const health = getText("sys_health").trim();

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
    return;
  }

  if (t?.id === "btnCopyBest") {
    const best = getText("followup_best").trim();
    if (!best) return setStatus("Nothing to copy.");
    await copyText(best);
    setStatus("Copied Best.");
    return;
  }

  if (t?.id === "btnCopyFollowups") {
    const pack = buildFollowupsPack();
    if (!pack) return setStatus("No follow-ups to copy yet.");
    await copyText(pack);
    setStatus("Copied all follow-ups.");
    return;
  }

  if (t?.id === "btnCopyActions") {
    const pack = buildActionsPack();
    if (!pack) return setStatus("No reminders/actions to copy yet.");
    await copyText(pack);
    setStatus("Copied reminders + actions.");
    return;
  }

  if (t?.id === "btnCopyAll") {
    const pack = buildEverythingPack();
    if (!pack) return setStatus("Nothing to copy yet.");
    await copyText(pack);
    setStatus("Copied everything.");
    return;
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
    return;
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
    return;
  }

  const key = t?.dataset?.copy;
  if (key) {
    const text = getText(key).trim();
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
