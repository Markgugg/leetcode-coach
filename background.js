// background.js — service worker. Talks to the Anthropic API.
// Jobs: (1) quick path check, (2) graduated spoiler-free hint,
// (3) detailed code review with snippets + locations to highlight.

const DEFAULT_MODEL = "claude-sonnet-5";
// The automatic background check is a 4-way classification that fires on a timer,
// so it is the single biggest source of spend. Haiku handles it well, costs half
// as much per token, and does not think, which removes most of the output tokens.
const WATCH_MODEL = "claude-haiku-4-5-20251001";
const OPENAI_DEFAULT = "gpt-4o-mini";
const NO_EMDASH = "Never use em dashes. Use commas, periods, or parentheses instead.";

// ---------- Shared prompt fragments ----------

// The single most important thing: the model keeps forgetting this is LeetCode.
const LEETCODE_CONTEXT =
  "IMPORTANT CONTEXT. The code you are shown was typed into the LeetCode / NeetCode in-browser editor. " +
  "It is NOT a standalone program and it will never be run as one. Therefore, all of the following are FORBIDDEN and count as serious mistakes on your part:\n" +
  "- Never flag `class Solution:` (or the language equivalent) or the given method signature. LeetCode provides them. Never mark them wrong. Never suggest renaming or changing the signature, its parameters, or its return type.\n" +
  "- Never say an import is missing. Imports are unnecessary here. LeetCode pre-imports List, Optional, Dict, Set, Tuple, TreeNode, ListNode, collections, heapq, bisect, math, itertools and friends. Do not add import lines and do not mention them.\n" +
  "- Never ask for a main function, driver code, a test harness, input parsing, or printing. There is none and there should be none.\n" +
  "- Never flag helper classes like TreeNode or ListNode as undefined. LeetCode already defines them.\n" +
  "- Only the body of the user's method matters. Judge that, and nothing else.\n" +
  "- The user is mid-typing. Incomplete code is expected and normal. Do not report a syntax error that is obviously just an unfinished line, unless the actual logic is wrong.";

const STYLE_RULE =
  "WRITING STYLE. Plain English first, always. " +
  "Explain what goes wrong and when, in words a beginner understands, before you show any code. " +
  "Never use jargon without explaining it in the same sentence. " +
  "Use short sentences. No preamble, no greeting, no \"Great question\", no restating the problem back to the user. " +
  "Prefer a concrete worked example over an abstract description: \"if nums is [1, 1], your loop returns 3 but the answer is 2\" beats \"the loop bound is incorrect\". " +
  "Code is supporting evidence, not the main content. " + NO_EMDASH;

const BLOCK_SPEC =
  "BLOCK TYPES. Every block is an object with a \"kind\". Allowed kinds and their exact shapes:\n" +
  '{"kind": "bad", "label": "Your code", "code": "the user\'s offending lines, verbatim"}\n' +
  '{"kind": "good", "label": "Fix", "code": "the corrected lines"}\n' +
  '{"kind": "code", "label": "optional short label", "code": "neutral code or pseudocode"}\n' +
  '{"kind": "steps", "label": "optional short label", "items": ["plain-English step", "..."]}\n' +
  '{"kind": "trace", "label": "Example", "items": ["nums = [1, 1]", "your loop returns 3", "expected 2"]}\n' +
  'Rules: "bad", "good" and "code" use the string field "code" (newlines are allowed inside it). ' +
  '"steps" and "trace" use the array field "items", each item one short string. ' +
  '"label" is optional and must be short. Never invent a kind that is not in the list above. ' +
  "Keep every code block under 12 lines.";

const JSON_ONLY =
  "OUTPUT. Respond with ONLY a single raw JSON object. No markdown code fences, no ```json, no commentary before or after, no explanation of the JSON. Just the object.";

// ---------- Defensive normalization ----------
const VALID_KINDS = ["bad", "good", "code", "steps", "trace"];

function asStr(v) {
  if (typeof v === "string") return v;
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
}

function asArr(v) {
  if (Array.isArray(v)) return v;
  if (v === null || v === undefined) return [];
  return [v];
}

function normBlock(b) {
  if (!b || typeof b !== "object") return null;
  const kind = asStr(b.kind).trim().toLowerCase();
  if (VALID_KINDS.indexOf(kind) === -1) return null;
  const label = asStr(b.label).slice(0, 60);
  if (kind === "steps" || kind === "trace") {
    const items = asArr(b.items).map(asStr).map((s) => s.trim()).filter(Boolean).slice(0, 8);
    if (!items.length) return null;
    return { kind, label, items };
  }
  // Some models send items instead of code. Recover instead of dropping the block.
  let code = asStr(b.code);
  if (!code && Array.isArray(b.items)) code = b.items.map(asStr).join("\n");
  code = code.replace(/\s+$/, "");
  if (!code) return null;
  return { kind, label, code };
}

function normBlocks(v, max) {
  return asArr(v).map(normBlock).filter(Boolean).slice(0, max);
}

async function getProviderConfig() {
  const s = await chrome.storage.local.get(["provider", "apiKey", "model", "openaiKey", "openaiModel", "workspaceId", "cheapWatch"]);
  const provider = s.provider || "anthropic";
  if (provider === "openai") {
    return { provider, apiKey: s.openaiKey, model: s.openaiModel || OPENAI_DEFAULT };
  }
  const chosen = s.model || DEFAULT_MODEL;
  const cheapWatch = s.cheapWatch !== false; // default on
  return {
    provider, apiKey: s.apiKey, model: chosen,
    // Model used for the passive on-a-timer check only.
    watchModel: cheapWatch && chosen !== WATCH_MODEL ? WATCH_MODEL : chosen,
    workspaceId: (s.workspaceId || "").trim(),
  };
}

async function bumpCount(type) {
  const s = await chrome.storage.local.get(["lccCalls", "lccReviewCalls", "lccHintCalls", "lccDetailCalls", "lccAskCalls"]);
  await chrome.storage.local.set({
    lccCalls: (s.lccCalls || 0) + 1,
    lccReviewCalls: (s.lccReviewCalls || 0) + (type === "review" ? 1 : 0),
    lccHintCalls: (s.lccHintCalls || 0) + (type === "hint" ? 1 : 0),
    lccDetailCalls: (s.lccDetailCalls || 0) + (type === "detail" ? 1 : 0),
    lccAskCalls: (s.lccAskCalls || 0) + (type === "ask" ? 1 : 0),
  });
}

// Models that always think. Thinking tokens come out of max_tokens, so these
// need extra headroom plus an explicit effort level.
function isThinkingModel(model) {
  return /^claude-(sonnet-5|opus-5|fable-5|mythos-5)/.test(model || "");
}

async function callLLM({ provider, apiKey, model, system, userText, maxTokens, workspaceId, effort, cachePrefix }) {
  if (provider === "openai") {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + apiKey },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens || 400,
        messages: [
          { role: "system", content: system },
          { role: "user", content: (cachePrefix || "") + userText },
        ],
      }),
    });
    if (!resp.ok) {
      const t = await resp.text();
      throw new Error(`OpenAI ${resp.status}: ${t.slice(0, 300)}`);
    }
    const data = await resp.json();
    return ((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "").trim();
  }
  // Anthropic
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
  // Identity-linked keys are rejected without this. Harmless on normal keys.
  if (workspaceId) headers["anthropic-workspace-id"] = workspaceId;

  // One cache breakpoint at the end of the problem statement covers everything
  // before it, system prompt included, since the prefix is ordered system then
  // messages. The user's code stays outside it so edits do not invalidate.
  const userContent = cachePrefix
    ? [
        { type: "text", text: cachePrefix, cache_control: { type: "ephemeral" } },
        { type: "text", text: userText },
      ]
    : userText;

  const body = {
    model,
    max_tokens: maxTokens || 400,
    system,
    messages: [{ role: "user", content: userContent }],
  };
  if (isThinkingModel(model)) {
    // Reasoning shares the output budget, so leave room or the answer truncates.
    body.max_tokens = (maxTokens || 400) + 2000;
    body.output_config = { effort: effort || "low" };
  }

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const t = await resp.text();
    throw new Error(`API ${resp.status}: ${t.slice(0, 300)}`);
  }
  const data = await resp.json();
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

// The problem statement does not change while the user works, so it is split out
// and marked cacheable. Only their code varies between calls.
function problemPrefix({ title, slug, description }, descLimit) {
  return (
    `Problem: ${title || slug || "(unknown)"}\n` +
    (slug ? `Slug: ${slug}\n` : "") +
    `\nDescription:\n${(description || "(could not read description; use the title/slug, you likely know this problem)").slice(0, descLimit || 4000)}\n`
  );
}
function codePart({ code }) {
  return `\nThe user's current in-progress code:\n${(code || "(empty)").slice(0, 3000)}`;
}
function problemBlock(payload, descLimit) {
  return problemPrefix(payload, descLimit) + codePart(payload);
}

function parseJson(raw, fallback) {
  const cleaned = raw.replace(/```json/gi, "").replace(/```/g, "").trim();
  try { return JSON.parse(cleaned); }
  catch (_) {
    const m = cleaned.match(/\{[\s\S]*\}/);
    try { return m ? JSON.parse(m[0]) : fallback; } catch (__) { return fallback; }
  }
}

// ---------- REVIEW: is their approach on the right path? ----------
async function getReview(payload) {
  const { provider, apiKey, watchModel, workspaceId } = await getProviderConfig();
  const model = watchModel;
  if (!apiKey) return { error: "no_key", message: "No API key set. Open the extension popup and add it." };
  const system =
    "You are a LeetCode coach watching a student solve a problem in real time. " +
    "Look at their in-progress code and judge whether their APPROACH is heading toward a correct and reasonably efficient solution. " +
    "You are NOT a linter and you NEVER write the solution here.\n\n" +
    LEETCODE_CONTEXT + "\n\n" +
    STYLE_RULE + "\n\n" +
    'SHAPE. {"status": "too_early|on_track|warning|off_track", "note": "one plain-English sentence"}\n' +
    'status meanings: "too_early" when only the LeetCode scaffolding is present (the class line, the signature, a pass or an empty body) and there is nothing real to judge yet. ' +
    '"on_track" when the approach is heading somewhere correct. ' +
    '"warning" when it can work but there is a real concern. ' +
    '"off_track" when the approach is fundamentally wrong.\n' +
    "note is ONE sentence, at most 22 words, second person, plain English, spoiler-free. " +
    "For warning and off_track, point at WHAT to reconsider. Never give the fix. " +
    "Never mention imports, the class line, the method signature, or missing driver code.\n\n" +
    JSON_ONLY;
  try {
    const parsed = parseJson(await callLLM({ provider, apiKey, model, workspaceId, effort: "low", system,
      cachePrefix: problemPrefix(payload, 1500), userText: codePart(payload), maxTokens: 300 }),
      null) || {};
    await bumpCount("review");
    const status = asStr(parsed.status).trim().toLowerCase();
    const known = ["too_early", "on_track", "warning", "off_track"];
    return {
      status: known.indexOf(status) === -1 ? "too_early" : status,
      note: asStr(parsed.note).trim(),
    };
  } catch (e) {
    return { error: "api_error", message: e.message || String(e) };
  }
}

// ---------- DETAIL: point at the broken parts, with before/after code ----------
function normDetail(parsed) {
  const p = parsed && typeof parsed === "object" ? parsed : {};
  const issues = asArr(p.issues).map((i) => {
    if (!i || typeof i !== "object") return null;
    const issue = {
      title: asStr(i.title).trim(),
      find: asStr(i.find).split("\n")[0].trim(),
      plain: asStr(i.plain).trim(),
      blocks: normBlocks(i.blocks, 4),
    };
    if (!issue.title && !issue.plain && !issue.find && !issue.blocks.length) return null;
    return issue;
  }).filter(Boolean).slice(0, 3);
  return { summary: asStr(p.summary).trim(), issues };
}

async function getDetail(payload) {
  const { provider, apiKey, model, workspaceId } = await getProviderConfig();
  if (!apiKey) return { error: "no_key", message: "No API key set. Open the extension popup and add it." };
  const depth = Math.min(Math.max(payload.depth || 1, 1), 3);
  const depthGuide = {
    1: "DEPTH 1. Keep the \"bad\" and \"good\" blocks to a line or two each. Just the offending lines and their replacement.",
    2: "DEPTH 2. Fuller snippets are fine, a small block of lines with enough surrounding context to be pasteable. Still not the entire method.",
    3: "DEPTH 3. The user asked to go all the way. The \"good\" block may be the full corrected method body.",
  }[depth];
  const system =
    "You are a LeetCode coach reviewing the user's in-progress code. The user pressed \"check my code\", so they believe something is wrong. " +
    "Look hard for real bugs: wrong logic, off-by-one errors, wrong loop bounds, unhandled edge cases, wrong data structure, cases that will fail on the judge. " +
    "Tie every issue to their actual code.\n\n" +
    LEETCODE_CONTEXT + "\n\n" +
    STYLE_RULE + "\n\n" +
    "SHAPE.\n" +
    "{\n" +
    '  "summary": "one plain-English sentence on the overall state",\n' +
    '  "issues": [\n' +
    "    {\n" +
    '      "title": "short plain-English label, at most 8 words, no code in it",\n' +
    '      "find": "an EXACT substring copied verbatim from the user\'s code, on ONE line",\n' +
    '      "plain": "1 to 3 short sentences explaining what breaks and when",\n' +
    '      "blocks": []\n' +
    "    }\n" +
    "  ]\n" +
    "}\n\n" +
    "RULES.\n" +
    "- At most 3 issues, ordered most important first. Only real problems. Do not pad.\n" +
    "- If the code is genuinely correct, return the summary with \"issues\": [].\n" +
    "- \"find\" must be copied character for character from their code, including spacing, on a single line. If it does not match their code exactly, the highlight in their editor breaks. Never paraphrase it, never write code they did not write, never add ellipses.\n" +
    "- \"title\" is plain English, no code, no jargon.\n" +
    "- \"plain\" explains what goes wrong and when, in beginner words, with a concrete example if it helps. No jargon without explaining it in the same sentence.\n" +
    "- For each issue, \"blocks\" should normally be exactly these three, in this order: first a \"trace\" block giving one concrete failing example (the input, what their code does, what was expected), then a \"bad\" block with their offending lines verbatim, then a \"good\" block with the corrected lines. Drop a block only when it truly adds nothing.\n" +
    "- At most 4 blocks per issue.\n\n" +
    depthGuide + "\n\n" +
    BLOCK_SPEC + "\n\n" +
    JSON_ONLY;
  try {
    const raw = await callLLM({ provider, apiKey, model, workspaceId, effort: "low", system,
      cachePrefix: problemPrefix(payload), userText: codePart(payload), maxTokens: 1600 });
    const parsed = normDetail(parseJson(raw, null));
    await bumpCount("detail");
    if (!parsed.summary && !parsed.issues.length) {
      return { summary: "Could not read the response. Try checking again.", issues: [] };
    }
    return parsed;
  } catch (e) {
    return { error: "api_error", message: e.message || String(e) };
  }
}

// ---------- HINT: graduated, spoiler-free ----------
const HINT_GUIDE = {
  1: "Level 1 (gentle nudge): point only at the category of problem, or ask a reframing question. Do NOT name the data structure or the algorithm. NO CODE AT ALL. Prefer one small \"trace\" block showing a tiny worked example of the problem itself, or no blocks.",
  2: "Level 2: name the key data structure or technique and say in plain words why it fits. Do not give the steps. NO CODE AT ALL. Prefer one small \"trace\" block showing a tiny worked example, or no blocks.",
  3: "Level 3: outline the approach as 2 to 4 high-level plain-English steps, and state the time and space target. Use one \"steps\" block. Still no code.",
  4: "Level 4: concrete guidance and the main edge cases. You MAY include at most ONE \"code\" block, and it must be PSEUDOCODE of at most 8 lines. Never a working solution in their language.",
};
function normHint(parsed, level) {
  const p = parsed && typeof parsed === "object" ? parsed : {};
  let blocks = normBlocks(p.blocks, 2);
  // Levels 1 and 2 must never leak code.
  if (level <= 2) blocks = blocks.filter((b) => b.kind === "steps" || b.kind === "trace");
  else if (level === 3) blocks = blocks.filter((b) => b.kind !== "bad" && b.kind !== "good");
  let plain = asStr(p.plain).trim();
  const sentences = plain.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g);
  if (sentences && sentences.length > 3) plain = sentences.slice(0, 3).join("").trim();
  return {
    headline: asStr(p.headline).trim(),
    plain,
    blocks,
    level,
  };
}
async function getHint(payload) {
  const { provider, apiKey, model, workspaceId } = await getProviderConfig();
  if (!apiKey) return { error: "no_key", message: "No API key set. Open the extension popup and add it." };
  const level = Math.min(Math.max(payload.hintLevel || 1, 1), 4);
  const system =
    "You are a friendly LeetCode coach. Give a graduated, spoiler-free hint that helps the user think for themselves. " +
    "You NEVER give a full working solution.\n\n" +
    LEETCODE_CONTEXT + "\n\n" +
    STYLE_RULE + "\n\n" +
    "SHAPE.\n" +
    "{\n" +
    '  "headline": "the hint in one short line, at most 9 words",\n' +
    '  "plain": "1 to 3 short sentences, plain English. This is the hint itself.",\n' +
    '  "blocks": [],\n' +
    '  "level": ' + level + "\n" +
    "}\n\n" +
    "HARD LIMITS. Hints must not ramble. \"plain\" is AT MOST 3 sentences. \"blocks\" holds AT MOST 2 blocks, usually one. " +
    "Do not repeat the headline inside \"plain\". Do not restate the problem. Do not list what the user already wrote. " +
    "Levels 1 and 2 must contain NO code of any kind. Only level 4 may contain a code block, and only as pseudocode of at most 8 lines.\n\n" +
    "This hint is at level " + level + " of 4. Follow this exactly:\n" + HINT_GUIDE[level] + "\n\n" +
    BLOCK_SPEC + "\n\n" +
    JSON_ONLY;
  try {
    const raw = await callLLM({ provider, apiKey, model, workspaceId, effort: "low", system,
      cachePrefix: problemPrefix(payload), userText: codePart(payload), maxTokens: 700 });
    const parsed = normHint(parseJson(raw, null), level);
    await bumpCount("hint");
    if (!parsed.headline && !parsed.plain && !parsed.blocks.length) {
      return { headline: "No hint came back", plain: "The response could not be read. Try asking for the hint again.", blocks: [], level };
    }
    return parsed;
  } catch (e) {
    return { error: "api_error", message: e.message || String(e) };
  }
}

// ---------- ASK: answer a question about a selected snippet ----------
async function getAsk(payload) {
  const { provider, apiKey, model, workspaceId } = await getProviderConfig();
  if (!apiKey) return { error: "no_key", message: "No API key set. Open the extension popup and add it." };
  const system =
    "You are a friendly coding tutor. The user selected part of their code on a LeetCode or NeetCode problem and is asking a question about it. " +
    "Answer their actual question about their actual selected code. Do not dump a full solution unless they explicitly ask for it.\n\n" +
    LEETCODE_CONTEXT + "\n\n" +
    STYLE_RULE + "\n\n" +
    "SHAPE.\n" +
    "{\n" +
    '  "plain": "the answer in plain English, at most 4 short sentences",\n' +
    '  "blocks": []\n' +
    "}\n\n" +
    "RULES. \"plain\" carries the answer and must stand on its own. At most 4 short sentences. " +
    "\"blocks\" holds AT MOST 3 blocks and is supporting evidence only. " +
    "A \"trace\" block with a concrete worked example is usually the most useful thing you can add. " +
    "Use \"bad\" and \"good\" together when you are showing them a fix to their selected lines. " +
    "If the answer needs no code, send an empty blocks array.\n\n" +
    BLOCK_SPEC + "\n\n" +
    JSON_ONLY;
  const userText =
    codePart(payload) +
    `\n\nThe user has SELECTED this part of their code:\n${(payload.selection || "").slice(0, 2000)}\n` +
    `\nTheir question about that selection:\n${(payload.question || "").slice(0, 500)}`;
  try {
    const raw = await callLLM({ provider, apiKey, model, workspaceId, effort: "low", system,
      cachePrefix: problemPrefix(payload), userText, maxTokens: 900 });
    const p = parseJson(raw, null) || {};
    await bumpCount("ask");
    const out = { plain: asStr(p.plain).trim(), blocks: normBlocks(p.blocks, 3) };
    if (!out.plain && !out.blocks.length) {
      return { plain: "The response could not be read. Try asking again.", blocks: [] };
    }
    return out;
  } catch (e) {
    return { error: "api_error", message: e.message || String(e) };
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  if (msg.type === "GET_REVIEW") { getReview(msg.payload).then(sendResponse); return true; }
  if (msg.type === "GET_DETAIL") { getDetail(msg.payload).then(sendResponse); return true; }
  if (msg.type === "GET_HINT") { getHint(msg.payload).then(sendResponse); return true; }
  if (msg.type === "GET_ASK") { getAsk(msg.payload).then(sendResponse); return true; }
});
