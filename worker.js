export default {
  async fetch(request, env) {
    // --- CORS ---
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== "POST") {
      return json({ error: "Use POST with JSON body." }, 405);
    }

    // --- Parse body ---
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body." }, 400);
    }

    // --- Inputs (all optional, but require at least ONE meaningful field) ---
    const stage = s(body.stage);
    const customer = s(body.customer);
    const vehicle = s(body.vehicle);

    const lead_source = s(body.lead_source);
    const budget = s(body.budget);
    const timeline = s(body.timeline);
    const trade = s(body.trade);
    const objections = s(body.objections);

    const last_message = s(body.last_message);
    const raw_note = s(body.raw_note);
    const rewrite_draft = s(body.rewrite_draft);

    const days_since = n(body.days_since, 0);
    const last_was_question = s(body.last_was_question).toLowerCase(); // "yes"/"no"/""
    const tone = s(body.tone) || "warm";

    const include_followup = b(body.include_followup, true);
    const include_reminders = b(body.include_reminders, true);

    const hasAny =
      stage || customer || vehicle || lead_source || budget || timeline || trade || objections || last_message || raw_note || rewrite_draft;

    if (!hasAny) {
      return json(
        { error: "Provide at least one of: stage, customer, vehicle, last_message, raw_note, rewrite_draft, or any context fields." },
        400
      );
    }

    // --- Mode logic ---
    const isRewrite = !!rewrite_draft;

    let ghost_score = 0;
    if (days_since >= 2) ghost_score += 1;
    if (days_since >= 5) ghost_score += 2;
    if (days_since >= 10) ghost_score += 2;

    if (last_was_question === "yes" || last_was_question === "true") ghost_score += 2;

    const stageLower = stage.toLowerCase();
    if (["numbers", "unsold-numbers", "unsold-show", "no-show"].includes(stageLower)) ghost_score += 1;

    const isGhost = ghost_score >= 4;
    const isClose = ["delivery-scheduled", "sold"].includes(stageLower);

    const mode = isRewrite ? "rewrite" : isClose ? "close" : isGhost ? "ghost" : "normal";

    // --- Hard rules (your preferences) ---
    const rules = [
      "You write outbound SMS in the voice of Seth Utsman with Friendship Ford.",
      "",
      "Absolute rules:",
      "- NO em dashes (—).",
      '- Never say: "just checking in", "following up", "circling back".',
      "- 1–2 sentences max per message.",
      "- MAX ONE question per message.",
      '- End each message with exactly: "- Seth Utsman with Friendship Ford"',
      "",
      "Allowed:",
      "- Emojis allowed sparingly (0–1).",
      "- Exclamation points allowed sparingly (0–1).",
      "",
      'Optional tagline (max once): "I look forward to serving you at the highest level."',
      "Faith language is allowed when relationally appropriate; keep it concise and sincere.",
      "",
      "No invented details. If unknown, omit it.",
    ].join("\n");

    const context = [
      stage ? `Stage: ${stage}` : null,
      customer ? `Customer: ${customer}` : null,
      vehicle ? `Vehicle: ${vehicle}` : null,
      lead_source ? `Lead source: ${lead_source}` : null,
      budget ? `Budget: ${budget}` : null,
      timeline ? `Timeline: ${timeline}` : null,
      trade ? `Trade: ${trade}` : null,
      objections ? `Objections: ${objections}` : null,
      `Tone: ${tone}`,
      `Days since last contact: ${days_since}`,
      last_was_question ? `Last outbound was a question: ${last_was_question}` : null,
      last_message ? `Lead's last message: "${last_message}"` : null,
      raw_note ? `Raw note/context: "${raw_note}"` : null,
      rewrite_draft ? `Draft to rewrite: "${rewrite_draft}"` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const outputContract = [
      "Return ONLY valid JSON. No markdown. No extra keys.",
      "",
      "Schema:",
      "{",
      '  "mode": "normal|ghost|close|rewrite",',
      '  "deal_health": "hot|warm|cold",',
      '  "reasoning_tags": ["..."],',
      '  "followups": { "best": "...", "soft": "...", "neutral": "...", "assertive": "..." },',
      '  "ghost_busters": { "a": "...", "b": "..." },',
      '  "reminders": ["..."],',
      '  "next_actions": ["..."]',
      "}",
      "",
      "Rules for fields:",
      "- If mode is normal: fill followups (all 4). ghost_busters can be empty strings.",
      "- If mode is ghost: fill ghost_busters (a,b) and also fill followups.best as the best ghost buster. The other followups can be empty except best/soft/neutral if you want.",
      "- If mode is close: followups should confirm next step without pressure; ghost_busters empty.",
      "- If mode is rewrite: fill all 4 followups as tone variants of the rewritten draft. ghost_busters empty.",
      "- reminders: 0–5 short strings if include_reminders is true, else [].",
      "- next_actions: 2–4 specific actions with timing words (today/tomorrow/this afternoon). No dates.",
      "- reasoning_tags: 0–6 short tags like price, trade, timeline, spouse, credit, availability, features.",
    ].join("\n");

    const task = buildTask({ mode, include_followup, include_reminders });

    const input = [rules, "", "Context:", context, "", task, "", outputContract].join("\n");

    const apiKey = env.OPENAI_API_KEY;
    if (!apiKey) return json({ error: "Missing OPENAI_API_KEY secret" }, 500);

    const model = env.OPENAI_MODEL || "gpt-4.1-mini";

    let openaiRes;
    try {
      openaiRes = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          input,
          max_output_tokens: 650,
        }),
      });
    } catch (e) {
      return json({ error: "Network error calling OpenAI", details: String(e) }, 502);
    }

    const rawText = await openaiRes.text();
    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      return json({ error: "OpenAI returned non-JSON", status: openaiRes.status, debug: rawText.slice(0, 4000) }, 502);
    }

    if (!openaiRes.ok) {
      return json({ error: "OpenAI API error", status: openaiRes.status, debug: data }, 502);
    }

    const modelText = extractOutputText(data);
    if (!modelText) {
      return json({ error: "No model text found in OpenAI response", debug: data }, 502);
    }

    let parsed;
    try {
      parsed = JSON.parse(modelText);
    } catch {
      return json({ error: "Model did not return valid JSON", output_text: modelText, debug: data }, 502);
    }

    const result = normalizeResult(parsed, { mode, include_followup, include_reminders });

    return json(result, 200);
  },
};

// ---------- helpers ----------
function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "Content-Type, Authorization",
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders(), "content-type": "application/json; charset=utf-8" },
  });
}

function s(v) {
  return String(v ?? "").trim();
}

function n(v, d = 0) {
  const x = Number(v);
  return Number.isFinite(x) ? x : d;
}

function b(v, d = true) {
  return typeof v === "boolean" ? v : d;
}

function buildTask({ mode, include_followup, include_reminders }) {
  if (!include_followup) {
    return [
      `Mode: ${mode}`,
      "Task: Follow-up generation is disabled. Still produce deal_health, tags, reminders/next_actions if requested.",
    ].join("\n");
  }

  if (mode === "rewrite") {
    return [
      "Mode: rewrite",
      "Task:",
      "- The user has written a draft message. Polish it to sound natural and human.",
      "- Keep the same intent and core meaning. Do NOT change the topic or add new details.",
      "- Generate 4 tone variants of the rewritten message: best (your top pick), soft, neutral, assertive.",
      "- Apply all style rules above (no em dashes, no clichés, 1–2 sentences, signature required).",
      include_reminders ? "- Provide reminders and next_actions if relevant." : "- reminders should be [] and next_actions still provided.",
    ].join("\n");
  }

  if (mode === "ghost") {
    return [
      "Mode: ghost",
      "Task:",
      "- Generate 2 ghost buster messages (a,b). Their ONLY goal is to get a reply.",
      "- Low pressure. Not needy. Not a scheduling push unless soft.",
      "- Also fill followups.best as the best overall ghost buster.",
      "- You may fill followups.soft and followups.neutral with the two ghost busters if you want. Keep assertive empty.",
      include_reminders ? "- Provide reminders and next_actions." : "- reminders should be [] and next_actions still provided.",
    ].join("\n");
  }

  if (mode === "close") {
    return [
      "Mode: close",
      "Task:",
      "- Generate followups that confirm the next step (delivery/closeout) and reduce friction.",
      "- One question max. Helpful, confident, calm.",
      include_reminders ? "- Provide reminders and next_actions." : "- reminders should be [] and next_actions still provided.",
    ].join("\n");
  }

  return [
    "Mode: normal",
    "Task:",
    "- Generate exactly 4 followups: best, soft, neutral, assertive.",
    "- They must not sound like follow-up language.",
    "- Move the deal forward.",
    include_reminders ? "- Provide reminders and next_actions." : "- reminders should be [] and next_actions still provided.",
  ].join("\n");
}

// Robust Responses API text extraction
function extractOutputText(data) {
  if (!data) return "";

  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  try {
    const out = data.output;
    if (Array.isArray(out)) {
      let buf = "";
      for (const item of out) {
        const content = item?.content;
        if (!Array.isArray(content)) continue;

        for (const c of content) {
          if (c?.type === "output_text" && typeof c?.text === "string") buf += c.text;
          else if (c?.type === "text" && typeof c?.text === "string") buf += c.text;
          else if (typeof c?.text === "string") buf += c.text;
        }
      }
      if (buf.trim()) return buf.trim();
    }
  } catch {}

  return "";
}

function normalizeResult(parsed, { mode, include_followup, include_reminders }) {
  const followups = parsed.followups || {};
  const ghost = parsed.ghost_busters || {};

  const res = {
    mode: String(parsed.mode || mode || "normal"),
    deal_health: String(parsed.deal_health || "warm"),
    reasoning_tags: Array.isArray(parsed.reasoning_tags) ? parsed.reasoning_tags.map(String) : [],

    followups: {
      best: include_followup ? String(followups.best || "") : "",
      soft: include_followup ? String(followups.soft || "") : "",
      neutral: include_followup ? String(followups.neutral || "") : "",
      assertive: include_followup ? String(followups.assertive || "") : "",
    },

    ghost_busters: {
      a: include_followup ? String(ghost.a || "") : "",
      b: include_followup ? String(ghost.b || "") : "",
    },

    reminders:
      include_reminders && Array.isArray(parsed.reminders) ? parsed.reminders.map(String) : [],

    next_actions: Array.isArray(parsed.next_actions) ? parsed.next_actions.map(String) : [],
  };

  // Back-compat top-level keys (extension uses these)
  res.followup_best = res.followups.best;
  res.followup_soft = res.followups.soft;
  res.followup_neutral = res.followups.neutral;
  res.followup_assertive = res.followups.assertive;

  // Safety: if best missing, pick a fallback
  if (include_followup && !res.followup_best) {
    res.followup_best = res.followup_neutral || res.followup_soft || res.followup_assertive || res.ghost_busters.a || "";
    res.followups.best = res.followup_best;
  }

  return res;
}
