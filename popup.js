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

function setStatus(msg) {
  const el = $("status");
  if (el) el.textContent = msg || "";
}

async function copyText(text) {
  if (!text) return;
  await navigator.clipboard.writeText(text);
}

// ---------- normalizers ----------
function normalizeArray(items) {
  if (!Array.isArray(items)) return "";
  return items.map(x => `- ${String(x)}`).join("\n");
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return "";
  return tags.map(t => String(t)).join(", ");
}

function normalizeGhost(ghost) {
  if (!ghost) return "";
  return [ghost.a, ghost.b]
    .map(v => String(v || "").trim())
    .filter(Boolean)
    .map(v => `- ${v}`)
    .join("\n");
}

// ---------- outputs ----------
const TEXT_OUTPUTS = [
  "followup_best", "followup_soft", "followup_neutral", "followup_assertive",
  "reminders", "reasoning_tags", "next_actions", "ghost_busters",
];

function blankOutputs() {
  TEXT_OUTPUTS.forEach(id => setText(id, ""));
  setText("sys_mode", "—");
  setText("sys_health", "—");
  const ghostCard = $("ghostCard");
  if (ghostCard) ghostCard.style.display = "none";
}

function setOutputs(out) {
  setText("followup_best",      out.followup_best || "");
  setText("followup_soft",      out.followup_soft || "");
  setText("followup_neutral",   out.followup_neutral || "");
  setText("followup_assertive", out.followup_assertive || "");
  setText("reminders",          normalizeArray(out.reminders || []));
  setText("sys_mode",           out.mode || "—");
  setText("sys_health",         out.deal_health || "—");
  setText("reasoning_tags",     normalizeTags(out.reasoning_tags || []));
  setText("next_actions",       normalizeArray(out.next_actions || []));

  const ghostText = normalizeGhost(out.ghost_busters || null);
  setText("ghost_busters", ghostText);
  const ghostCard = $("ghostCard");
  if (ghostCard) ghostCard.style.display = (out.mode === "ghost" && ghostText) ? "block" : "none";
}

// ---------- form field config ----------
const FORM_FIELDS = [
  { id: "stage",             type: "value",   default: "" },
  { id: "customer",          type: "value",   default: "" },
  { id: "vehicle",           type: "value",   default: "" },
  { id: "lead_source",       type: "value",   default: "" },
  { id: "budget",            type: "value",   default: "" },
  { id: "timeline",          type: "value",   default: "" },
  { id: "trade",             type: "value",   default: "" },
  { id: "objections",        type: "value",   default: "" },
  { id: "days_since",        type: "value",   default: "" },
  { id: "last_message",      type: "value",   default: "" },
  { id: "last_was_question", type: "value",   default: "" },
  { id: "tone",              type: "value",   default: "" },
  { id: "raw_note",          type: "value",   default: "" },
  { id: "include_followup",  type: "checked", default: true },
  { id: "include_reminders", type: "checked", default: true },
];

// ---------- persistence ----------
const STORAGE_KEY = "followup_popup_state_v2";

function getStateFromUI() {
  const state = {};
  for (const { id, type } of FORM_FIELDS) {
    const el = $(id);
    state[id] = el
      ? (type === "checked" ? el.checked : el.value || "")
      : (type === "checked" ? false : "");
  }
  state.outputs = {
    ...Object.fromEntries(TEXT_OUTPUTS.map(id => [id, getText(id)])),
    sys_mode:     getText("sys_mode") || "—",
    sys_health:   getText("sys_health") || "—",
    ghost_visible: $("ghostCard")?.style.display || "none",
  };
  return state;
}

function applyStateToUI(state) {
  if (!state) return;
  for (const { id, type, default: def } of FORM_FIELDS) {
    const el = $(id);
    if (!el) continue;
    if (type === "checked") el.checked = state[id] ?? def;
    else el.value = state[id] ?? def;
  }
  if (state.outputs) {
    TEXT_OUTPUTS.forEach(id => setText(id, state.outputs[id] || ""));
    setText("sys_mode",   state.outputs.sys_mode   || "—");
    setText("sys_health", state.outputs.sys_health || "—");
    const ghostCard = $("ghostCard");
    if (ghostCard) ghostCard.style.display = state.outputs.ghost_visible || "none";
  }
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

async function saveState() {
  await chrome.storage.local.set({ [STORAGE_KEY]: getStateFromUI() });
}

async function loadState() {
  const res = await chrome.storage.local.get(STORAGE_KEY);
  return res[STORAGE_KEY];
}

function wireAutoSave() {
  const debouncedSave = debounce(saveState, 400);
  for (const { id } of FORM_FIELDS) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener("input", debouncedSave);
    el.addEventListener("change", debouncedSave);
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
    args,
  });
  return results?.[0]?.result;
}

async function getSelectionText() {
  return execInTab(() => {
    const sel = window.getSelection?.().toString() || "";
    if (sel) return sel;

    const el = document.activeElement;
    const tag = el?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") {
      const type = (el.getAttribute("type") || "text").toLowerCase();
      const supported = tag === "TEXTAREA" ||
        ["text", "search", "url", "email", "tel", "number"].includes(type);
      if (supported && typeof el.selectionStart === "number") {
        return String(el.value || "").slice(el.selectionStart, el.selectionEnd);
      }
    }

    return "";
  });
}

// Best-effort scrape (refine selectors for VinSolutions as needed)
async function scrapeBestEffort() {
  return execInTab(() => {
    const readText = (el) => {
      if (!el) return "";
      return typeof el.value === "string" ? el.value.trim() : (el.textContent?.trim() || "");
    };
    const fromSelectors = (selectors) => {
      for (const sel of selectors) {
        const val = readText(document.querySelector(sel));
        if (val) return val;
      }
      return "";
    };
    return {
      customer: fromSelectors([
        "[data-testid='customer-name']", ".customerName",
        "[name*='customer']", "[id*='customer']", "[aria-label*='Customer']",
      ]),
      vehicle: fromSelectors([
        "[data-testid='vehicle']", ".vehicle",
        "[name*='vehicle']", "[id*='vehicle']", "[aria-label*='Vehicle']",
      ]),
    };
  });
}

// ---------- worker response normalization ----------
function normalizeWorkerResponse(json) {
  if (!json) return null;

  let out;
  if (json.followup_best || json.followup_soft || json.followup_neutral || json.followup_assertive) {
    out = {
      followup_best:      json.followup_best      || "",
      followup_soft:      json.followup_soft      || "",
      followup_neutral:   json.followup_neutral   || "",
      followup_assertive: json.followup_assertive || "",
      reminders:          Array.isArray(json.reminders) ? json.reminders : [],
    };
  } else if (Array.isArray(json.options)) {
    out = { followup_best: "", followup_soft: "", followup_neutral: "", followup_assertive: "", reminders: [] };
    for (const opt of json.options) {
      const label = String(opt?.label || "").toLowerCase();
      const text  = String(opt?.text  || "").trim();
      if (!text) continue;
      if (label.includes("best"))    out.followup_best      = text;
      else if (label.includes("soft"))    out.followup_soft      = text;
      else if (label.includes("neutral")) out.followup_neutral   = text;
      else if (label.includes("assert"))  out.followup_assertive = text;
    }
    if (!out.followup_best) {
      out.followup_best = out.followup_neutral || out.followup_soft || out.followup_assertive || "";
    }
    out.reminders = Array.isArray(json.reminders) ? json.reminders : [];
  } else {
    return null;
  }

  // Attach system fields
  out.mode           = json.mode        || "";
  out.deal_health    = json.deal_health || "";
  out.reasoning_tags = Array.isArray(json.reasoning_tags) ? json.reasoning_tags : [];
  out.next_actions   = Array.isArray(json.next_actions)   ? json.next_actions   : [];
  out.ghost_busters  = json.ghost_busters || null;

  return out;
}

// ---------- pack builders ----------
function buildFollowupsPack() {
  return [
    ["BEST",      "followup_best"],
    ["SOFT",      "followup_soft"],
    ["NEUTRAL",   "followup_neutral"],
    ["ASSERTIVE", "followup_assertive"],
  ]
    .map(([label, id]) => { const t = $(id)?.textContent.trim(); return t ? `${label}:\n${t}` : ""; })
    .filter(Boolean)
    .join("\n\n");
}

function buildActionsPack() {
  const parts = [];
  const tags    = $("reasoning_tags")?.textContent.trim();
  const rem     = $("reminders")?.textContent.trim();
  const actions = $("next_actions")?.textContent.trim();
  const ghost   = $("ghost_busters")?.textContent.trim();
  const ghostCard = $("ghostCard");

  if (tags)    parts.push(`TAGS:\n${tags}`);
  if (rem)     parts.push(`REMINDERS:\n${rem}`);
  if (actions) parts.push(`NEXT ACTIONS:\n${actions}`);
  if (ghost && ghostCard?.style.display !== "none") parts.push(`GHOST BUSTERS:\n${ghost}`);

  return parts.join("\n\n");
}

function buildEverythingPack() {
  const mode   = $("sys_mode")?.textContent.trim();
  const health = $("sys_health")?.textContent.trim();
  const header = [
    mode   && mode   !== "—" ? `MODE: ${mode}`   : "",
    health && health !== "—" ? `DEAL: ${health}` : "",
  ].filter(Boolean).join(" | ");

  return [header, buildFollowupsPack(), buildActionsPack()].filter(Boolean).join("\n\n");
}

// ---------- main ----------
let activeRequest = null;

async function generate() {
  if (activeRequest) activeRequest.abort();
  const controller = new AbortController();
  activeRequest = controller;

  setStatus("Working...");
  blankOutputs();

  const raw_note    = $("raw_note").value.trim();
  const last_message = $("last_message").value.trim();

  if (!raw_note && !last_message) {
    setStatus("Add Raw Note OR Lead's last message (one is required).");
    activeRequest = null;
    return;
  }

  const payload = {
    raw_note:          raw_note || last_message,
    stage:             $("stage").value.trim(),
    customer:          $("customer").value.trim(),
    vehicle:           $("vehicle").value.trim(),
    lead_source:       $("lead_source").value.trim(),
    budget:            $("budget").value.trim(),
    timeline:          $("timeline").value.trim(),
    trade:             $("trade").value.trim(),
    objections:        $("objections").value.trim(),
    last_message,
    days_since:        Number($("days_since").value || 0),
    last_was_question: $("last_was_question").value.trim(),
    tone:              $("tone").value.trim(),
    include_followup:  $("include_followup").checked,
    include_reminders: $("include_reminders").checked,
  };

  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const text = await res.text();
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
    if (e.name !== "AbortError") {
      console.error(e);
      setStatus("Network error. Check console.");
    }
  } finally {
    if (activeRequest === controller) activeRequest = null;
  }
}

// ---------- wiring ----------
const BULK_COPY = {
  btnCopyBest:      () => ({ text: $("followup_best")?.textContent.trim(), label: "Best" }),
  btnCopyFollowups: () => ({ text: buildFollowupsPack(),  label: "all follow-ups" }),
  btnCopyActions:   () => ({ text: buildActionsPack(),    label: "reminders + actions" }),
  btnCopyAll:       () => ({ text: buildEverythingPack(), label: "everything" }),
};

document.addEventListener("click", async (e) => {
  const t = e.target;
  const id = t?.id;

  if (id === "btnGenerate") {
    await generate();
    return;
  }

  if (id && BULK_COPY[id]) {
    const { text, label } = BULK_COPY[id]();
    if (!text) return setStatus("Nothing to copy.");
    await copyText(text);
    setStatus(`Copied ${label}.`);
    return;
  }

  const key = t?.dataset?.copy;
  if (key) {
    const text = $(key)?.textContent?.trim() || "";
    if (!text) return setStatus("Nothing to copy.");
    await copyText(text);
    setStatus(`Copied ${key}.`);
    return;
  }

  if (id === "btnSelection") {
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

  if (id === "btnScrape") {
    try {
      const data = await scrapeBestEffort();
      if (data?.customer && !$("customer").value.trim()) $("customer").value = data.customer;
      if (data?.vehicle  && !$("vehicle").value.trim())  $("vehicle").value  = data.vehicle;
      await saveState();
      setStatus("Auto-fill attempted.");
    } catch (err) {
      console.error(err);
      setStatus("Auto-fill failed (needs selectors + permissions).");
    }
  }
});

// init
(async function init() {
  const state = await loadState();
  applyStateToUI(state);
  wireAutoSave();
})();
