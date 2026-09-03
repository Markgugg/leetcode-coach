// content.js — runs on leetcode.com/problems/*
// Live path-checker: reads your code as you write, and when you pause it asks
// Claude whether your APPROACH is on track. Flags warnings / wrong paths.
// Also gives graduated spoiler-free hints on request.

(() => {
  "use strict";

  const SITE = /(^|\.)neetcode\.io$/.test(location.hostname) ? "neetcode" : "leetcode";
  function hasEditor() {
    return !!document.querySelector(".monaco-editor, .view-lines");
  }
  function injectPageHelper() {
    try {
      const s = document.createElement("script");
      s.src = chrome.runtime.getURL("inject.js");
      s.onload = function () { s.remove(); };
      (document.head || document.documentElement).appendChild(s);
    } catch (_) {}
  }
  // Ask the page-context helper for Monaco's current selection.
  function getMonacoSelection() {
    return new Promise((resolve) => {
      let done = false;
      function handler(e) {
        if (e.source !== window || !e.data || e.data.type !== "LCC_SELECTION") return;
        window.removeEventListener("message", handler);
        done = true;
        resolve(e.data.text || "");
      }
      window.addEventListener("message", handler);
      try { window.postMessage({ type: "LCC_GET_SELECTION" }, "*"); } catch (_) {}
      setTimeout(() => {
        if (!done) {
          window.removeEventListener("message", handler);
          // Fallback to native selection if the bridge didn't answer.
          let t = "";
          try { t = (window.getSelection() || "").toString(); } catch (_) {}
          resolve(t);
        }
      }, 220);
    });
  }

  const DEFAULTS = {
    enabled: true,
    autoCheck: true,         // automatically check on pause; off = manual only
    pauseSeconds: 15,        // wait this long after you stop typing before reviewing
    cooldownSeconds: 120,    // min gap between automatic reviews (halved the spend)
    quietWhenOnTrack: true,  // if on track, stay collapsed (don't pop open)
    highlightOnScreen: true, // draw red highlights on the editor for detailed issues
  };

  let settings = { ...DEFAULTS };
  let state = null;
  let uiState = "watching"; // watching | checking | verdict | hint
  let verdictStatus = null; // ontrack | warning | offtrack
  let suppressClick = false;
  let intervals = [];
  let invalidated = false;

  // After the extension is reloaded/updated, an already-open tab's content script
  // is orphaned and chrome.runtime becomes unusable. Detect that and stop cleanly.
  function contextOk() {
    return !invalidated && !!(chrome && chrome.runtime && chrome.runtime.id);
  }
  function handleInvalidated() {
    if (invalidated) return;
    invalidated = true;
    intervals.forEach(clearInterval);
    intervals = [];
    if (bodyEl && actionsEl) {
      uiState = "watching";
      bodyEl.classList.remove("lcc-muted");
      bodyEl.textContent = "Coach was updated. Refresh this page to reconnect.";
      actionsEl.innerHTML = "";
      setDot("lcc-off");
      if (statusEl) statusEl.textContent = "reload page";
      if (pillStatusEl) pillStatusEl.textContent = "⟳";
      setCollapsed(false);
    }
  }
  function safeSend(msg, cb) {
    if (!contextOk()) { handleInvalidated(); return; }
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        if (chrome.runtime.lastError) {
          const m = chrome.runtime.lastError.message || "";
          if (/context invalidated|receiving end|port closed/i.test(m)) { handleInvalidated(); return; }
        }
        cb && cb(res);
      });
    } catch (e) {
      handleInvalidated();
    }
  }
  function safeGet(keys, cb) {
    if (!contextOk()) { handleInvalidated(); return; }
    try { chrome.storage.local.get(keys, (r) => { if (!chrome.runtime.lastError) cb && cb(r || {}); }); }
    catch (e) { handleInvalidated(); }
  }
  function safeSet(obj, cb) {
    if (!contextOk()) { handleInvalidated(); return; }
    try { chrome.storage.local.set(obj, () => { if (!chrome.runtime.lastError) cb && cb(); }); }
    catch (e) { handleInvalidated(); }
  }
  // Wrap interval/timer callbacks so any unexpected throw (e.g. context
  // invalidated after an extension reload) stops the timers cleanly.
  function guard(fn) {
    return function () {
      if (!contextOk()) { handleInvalidated(); return; }
      try { return fn.apply(this, arguments); }
      catch (e) {
        const m = (e && e.message) || "";
        if (/context invalidated|sendMessage|Extension context/i.test(m)) handleInvalidated();
        else console.warn("LeetCode Coach:", e);
      }
    };
  }

  const now = () => Date.now();

  // ---------- scraping ----------
  function getSlug() {
    const m = location.pathname.match(/\/problems\/([^/]+)/);
    if (m) return m[1];
    const parts = location.pathname.split("/").filter(Boolean);
    return parts.length ? parts[parts.length - 1] : null;
  }
  function getTitle() {
    const sel = ['a[href^="/problems/"][class*="title"]', 'div[class*="title"] a[href^="/problems/"]', ".text-title-large a"];
    for (const s of sel) {
      const el = document.querySelector(s);
      if (el && el.textContent.trim()) return el.textContent.trim();
    }
    // Heading fallback (works on NeetCode and many editors).
    const h = document.querySelector("h1, h2, h3");
    if (h) {
      const t = h.textContent.trim();
      if (t && t.length < 90) return t;
    }
    return document.title.replace(/\s*[-|]\s*(LeetCode|NeetCode).*/i, "").trim();
  }
  function getDescription() {
    const sel = [
      '[data-track-load="description_content"]', "div.elfjS",
      'div[class*="description"]', 'div[class*="content__"]',
      'div[class*="problem"] [class*="prose"]', "article",
    ];
    for (const s of sel) {
      const el = document.querySelector(s);
      if (el && el.textContent.trim().length > 40) return el.innerText.trim();
    }
    return "";
  }
  function getCode() {
    const container = document.querySelector(".view-lines");
    if (container) {
      const lines = Array.from(container.querySelectorAll(".view-line"));
      if (lines.length) {
        // Monaco may render lines out of DOM order; sort by vertical position.
        lines.sort((a, b) => (parseFloat(a.style.top) || 0) - (parseFloat(b.style.top) || 0));
        const text = lines.map((l) => l.textContent).join("\n").replace(/\u00a0/g, " ");
        if (text.trim()) return text;
      }
      if (container.innerText.trim()) return container.innerText;
    }
    const ta = document.querySelector("textarea");
    if (ta && ta.value.trim()) return ta.value.trim();
    return "";
  }

  // ---------- state ----------
  function resetForNewProblem() {
    const code = getCode();
    clearHighlights();
    hideAskChip();
    state = {
      slug: getSlug(),
      startTime: now(),
      lastActivity: now(),
      lastReviewTime: 0,
      baselineCode: code,       // the starter template
      lastAnalyzedCode: code,
      hintLevel: 0,
      lastHintTime: 0,
    };
    uiState = "watching";
    verdictStatus = null;
    setBodyWatching();
  }
  function markActivity() { if (state) state.lastActivity = now(); }
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    return `${Math.floor(sec / 60)}:${(sec % 60).toString().padStart(2, "0")}`;
  }
  function meaningfulCode(code) {
    if (!state) return false;
    const a = code.trim();
    const b = (state.baselineCode || "").trim();
    return a !== b && a.length > b.length + 10; // they've written real code
  }
  // Only auto-review when the code changed substantially since the last review,
  // so ordinary typing and small tweaks don't keep spending calls.
  function changedEnough(code) {
    if (!state) return false;
    const a = (code || "").trim();
    const b = (state.lastAnalyzedCode || "").trim();
    if (a === b) return false;
    if (Math.abs(a.length - b.length) >= 25) return true;
    if (a.split("\n").length !== b.split("\n").length) return true;
    return false; // changed only a little: wait for a manual check
  }

  // ---------- panel ----------
  let panel, pillStatusEl, statusEl, dotPillEl, dotCardEl, bodyEl, actionsEl, footEl, footRuleEl;

  function buildPanel() {
    if (panel) return;
    panel = document.createElement("div");
    panel.id = "lcc-panel";
    panel.innerHTML = `
      <div id="lcc-pill" class="lcc-surface" title="LeetCode Coach (click to expand, drag to move)">
        <span class="lcc-dot lcc-watching" id="lcc-dot-pill"></span>
        <span class="lcc-name">Coach</span>
        <span class="lcc-pill-status" id="lcc-pill-status"></span>
      </div>
      <div id="lcc-card" class="lcc-surface" role="status" aria-live="polite">
        <div class="lcc-head">
          <span class="lcc-dot lcc-watching" id="lcc-dot-card"></span>
          <span class="lcc-name">Coach</span>
          <span class="lcc-status" id="lcc-status"></span>
          <button class="lcc-collapse" id="lcc-collapse" aria-label="Collapse Coach" aria-expanded="true" title="Collapse">▾</button>
        </div>
        <div class="lcc-divider"></div>
        <div class="lcc-body lcc-muted" id="lcc-body"></div>
        <div class="lcc-actions" id="lcc-actions"></div>
        <div class="lcc-divider lcc-divider-quiet" id="lcc-foot-rule"></div>
        <div class="lcc-foot" id="lcc-foot"></div>
      </div>`;
    document.body.appendChild(panel);

    pillStatusEl = panel.querySelector("#lcc-pill-status");
    statusEl = panel.querySelector("#lcc-status");
    dotPillEl = panel.querySelector("#lcc-dot-pill");
    dotCardEl = panel.querySelector("#lcc-dot-card");
    bodyEl = panel.querySelector("#lcc-body");
    actionsEl = panel.querySelector("#lcc-actions");
    footEl = panel.querySelector("#lcc-foot");
    footRuleEl = panel.querySelector("#lcc-foot-rule");

    panel.querySelector("#lcc-pill").addEventListener("click", () => { if (!suppressClick) setCollapsed(false); });
    panel.querySelector("#lcc-collapse").addEventListener("click", () => setCollapsed(true));

    makeDraggable(panel.querySelector("#lcc-pill"));
    makeDraggable(panel.querySelector(".lcc-head"));

    loadPosition();
    measurePill();
    window.addEventListener("resize", () => place(savedPos || defaultPos(), false));

    updateCount();

    setCollapsed(true);
    setBodyWatching();
  }

  function updateCount() {
    if (!footEl) return;
    safeGet(["lccCalls", "lccReviewCalls", "lccHintCalls", "lccDetailCalls", "lccAskCalls"], (s) => {
      if (!s) { footEl.style.display = "none"; if (footRuleEl) footRuleEl.style.display = "none"; return; }
      footEl.style.display = ""; if (footRuleEl) footRuleEl.style.display = "";
      const total = s.lccCalls || 0;
      const r = s.lccReviewCalls || 0;
      const h = s.lccHintCalls || 0;
      const d = s.lccDetailCalls || 0;
      const a = s.lccAskCalls || 0;
      footEl.textContent = total === 0
        ? "0 AI calls this session"
        : `${total} AI call${total === 1 ? "" : "s"} · ` +
          [[r, "check"], [d, "review"], [h, "hint"], [a, "ask"]]
            .map(([n, word]) => `${n} ${word}${n === 1 ? "" : "s"}`)
            .join(", ");
    });
  }

  function setCollapsed(v) {
    panel.classList.toggle("lcc-open", !v);
    const cb = panel.querySelector("#lcc-collapse");
    if (cb) cb.setAttribute("aria-expanded", String(!v));
    // After toggling size, nudge back on-screen if the card would overflow.
    if (savedPos) requestAnimationFrame(() => place(savedPos, false));
  }

  function setDot(cls) {
    [dotPillEl, dotCardEl].forEach((d) => { if (d) d.className = "lcc-dot " + cls; });
  }

  const DOT = { watching: "lcc-watching", checking: "lcc-checking", ontrack: "lcc-ok", warning: "lcc-warn", offtrack: "lcc-bad", hint: "lcc-hint", off: "lcc-off" };
  const SHORT = { watching: "", checking: "…", ontrack: "✓", warning: "!", offtrack: "✕" };

  function renderHeader() {
    if (!panel) return;
    if (!settings.enabled) { setDot(DOT.off); statusEl.textContent = "paused"; pillStatusEl.textContent = "off"; return; }

    if (uiState === "checking") {
      setDot(DOT.checking); statusEl.textContent = "checking your code…"; pillStatusEl.textContent = "…";
    } else if (uiState === "hint") {
      setDot(DOT.hint); statusEl.textContent = `hint ${state ? state.hintLevel : 1}/4`; pillStatusEl.textContent = "hint";
    } else if (uiState === "ask") {
      setDot(DOT.hint); statusEl.textContent = "ask Coach"; pillStatusEl.textContent = "ask";
    } else if (uiState === "detail") {
      setDot(DOT.warning); statusEl.textContent = "review"; pillStatusEl.textContent = "";
    } else if (uiState === "verdict" && verdictStatus) {
      setDot(DOT[verdictStatus]);
      statusEl.textContent = { ontrack: "on track", warning: "heads up", offtrack: "rethink this" }[verdictStatus];
      pillStatusEl.textContent = SHORT[verdictStatus];
    } else {
      setDot(DOT.watching);
      if (state) {
        if (!settings.autoCheck) {
          statusEl.textContent = "manual mode";
          pillStatusEl.textContent = "";
        } else {
          const idle = (now() - state.lastActivity) / 1000;
          statusEl.textContent = "watching · idle " + fmt(idle);
          pillStatusEl.textContent = fmt(idle);
        }
      }
    }
  }

  // ---------- shared presentation helpers ----------
  // Every Coach screen is built from these, so hints, reviews, answers and
  // errors all read as the same material.

  const BADGE = {
    ontrack:  ["ON TRACK", "lcc-badge-success"],
    warning:  ["HEADS UP", "lcc-badge-warn"],
    offtrack: ["RETHINK",  "lcc-badge-error"],
    reviewed: ["REVIEWED", "lcc-badge-success"],
    issues:   ["HEADS UP", "lcc-badge-warn"],
    hint:     ["HINT",     "lcc-badge-hint"],
    answer:   ["ANSWER",   "lcc-badge-info"],
    error:    ["ERROR",    "lcc-badge-error"],
    ask:      ["ASK",      "lcc-badge-info"],
  };

  function makeBadge(key) {
    const spec = BADGE[key];
    if (!spec) return null;
    const b = document.createElement("span");
    b.className = "lcc-badge " + spec[1];
    b.textContent = spec[0];
    return b;
  }

  // Render text, turning `backticked` runs into inline code chips.
  function inlineCode(parent, text) {
    String(text == null ? "" : text).split(/`([^`]+)`/g).forEach((part, i) => {
      if (i % 2 === 1) {
        const c = document.createElement("code");
        c.className = "lcc-code";
        c.textContent = part;
        parent.appendChild(c);
      } else if (part) {
        parent.appendChild(document.createTextNode(part));
      }
    });
  }

  function addParagraph(container, text, badgeKey, headline) {
    const p = document.createElement("div");
    p.className = "lcc-para";
    const b = badgeKey ? makeBadge(badgeKey) : null;
    if (b) p.appendChild(b);
    if (headline) {
      const h = document.createElement("span");
      h.className = "lcc-headline";
      h.textContent = headline;
      p.appendChild(h);
    }
    if (text) inlineCode(p, text);
    if (b || headline || text) container.appendChild(p);
    return p;
  }

  const BLOCK_CLASS = { bad: "lcc-block-bad", good: "lcc-block-good", code: "lcc-block-code" };
  const BLOCK_LABEL = { bad: "Your code", good: "Suggested fix", code: "" };

  function attachCopy(head, text) {
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "lcc-copyfix";
    copy.textContent = "Copy";
    copy.addEventListener("click", () => {
      copyText(text).then(() => {
        copy.textContent = "Copied ✓";
        setTimeout(() => (copy.textContent = "Copy"), 1200);
      }).catch(() => {
        copy.textContent = "Copy failed";
        setTimeout(() => (copy.textContent = "Copy"), 1200);
      });
    });
    head.appendChild(copy);
  }

  function makeCodeTile(kind, label, code) {
    const tile = document.createElement("div");
    tile.className = "lcc-block " + (BLOCK_CLASS[kind] || "lcc-block-code");
    const text = String(code).replace(/\s+$/, "");
    const caption = label != null && label !== "" ? label : BLOCK_LABEL[kind];
    if (caption || kind !== "bad") {
      const head = document.createElement("div");
      head.className = "lcc-block-label";
      const sp = document.createElement("span");
      sp.textContent = caption || "";
      head.appendChild(sp);
      // Copying the broken code would be actively unhelpful, so only the
      // corrected and neutral tiles get a copy button.
      if (kind !== "bad") attachCopy(head, text);
      tile.appendChild(head);
    }
    const pre = document.createElement("pre");
    pre.className = "lcc-pre";
    const c = document.createElement("code");
    c.textContent = text;
    pre.appendChild(c);
    tile.appendChild(pre);
    return tile;
  }

  function makeListTile(kind, label, items) {
    const tile = document.createElement("div");
    tile.className = "lcc-block " + (kind === "steps" ? "lcc-block-steps" : "lcc-block-trace");
    const caption = label || (kind === "trace" ? "Example" : "");
    if (caption) {
      const head = document.createElement("div");
      head.className = "lcc-block-label";
      const sp = document.createElement("span");
      sp.textContent = caption;
      head.appendChild(sp);
      tile.appendChild(head);
    }
    const list = document.createElement(kind === "steps" ? "ol" : "ul");
    items.forEach((t) => {
      const li = document.createElement("li");
      inlineCode(li, t);
      list.appendChild(li);
    });
    tile.appendChild(list);
    return tile;
  }

  function renderBlocks(container, blocks) {
    const list = Array.isArray(blocks) ? blocks : [];
    let drawn = 0;
    list.forEach((b) => {
      if (!b || drawn >= 4) return;
      const kind = b.kind;
      if (kind === "steps" || kind === "trace") {
        const items = (Array.isArray(b.items) ? b.items : [])
          .filter((x) => typeof x === "string" && x.trim())
          .slice(0, 8);
        if (items.length) { container.appendChild(makeListTile(kind, b.label, items)); drawn++; }
      } else if (kind === "bad" || kind === "good" || kind === "code") {
        const code = typeof b.code === "string" ? b.code : "";
        if (code.trim()) { container.appendChild(makeCodeTile(kind, b.label, code)); drawn++; }
      }
    });
    return drawn;
  }

  // Older response shapes used why/fix strings. Keep rendering them so a stale
  // cached reply never produces an empty card.
  function blocksFor(issue) {
    if (Array.isArray(issue.blocks) && issue.blocks.length) return issue.blocks;
    const out = [];
    if (issue.find) out.push({ kind: "bad", label: "Your code", code: issue.find });
    if (issue.fix) out.push({ kind: "good", label: "Suggested fix", code: issue.fix });
    return out;
  }

  function actionsHTML(buttons) {
    return buttons.map((b) => {
      const cls = ["lcc-btn", b.style || "lcc-ghost"];
      if (b.spacer) cls.push("lcc-spacer");
      return `<button type="button" class="${cls.join(" ")}" id="${b.id}">${escapeHtml(b.label)}</button>`;
    }).join("");
  }

  function wire(buttons) {
    buttons.forEach((b) => {
      const el = actionsEl.querySelector("#" + b.id);
      if (el && b.on) el.addEventListener("click", b.on);
    });
  }

  function setActions(buttons) {
    actionsEl.innerHTML = actionsHTML(buttons);
    wire(buttons);
  }

  function setBodyWatching() {
    uiState = "watching"; verdictStatus = null;
    clearHighlights();
    bodyEl.classList.add("lcc-muted");
    bodyEl.innerHTML = "";
    addParagraph(bodyEl, "Watching your code. Start typing your approach, I'll flag it if you drift off track.");
    setActions([
      { id: "lcc-checkcode", label: "Check code", style: "lcc-primary", on: () => requestDetail(false) },
      { id: "lcc-hint", label: "Hint", style: "lcc-secondary", on: () => requestHint(false) },
    ]);
    renderHeader();
  }

  function setBodyChecking(label) {
    uiState = "checking";
    bodyEl.classList.add("lcc-muted");
    bodyEl.innerHTML = "";
    addParagraph(bodyEl, label || "Looking at your approach…");
    // A disabled primary carrying the 3-dot pulse, per the handoff's pending state.
    // The stylesheet draws the 3-dot pulse from ONE span: the span is the middle
    // dot and its pseudo-elements are the outer two.
    actionsEl.innerHTML =
      `<button type="button" class="lcc-btn lcc-primary" disabled aria-label="Working">` +
      `<span class="lcc-pending"></span></button>`;
    renderHeader();
  }

  function setBodyVerdict(status, note) {
    verdictStatus = status; uiState = "verdict";
    bodyEl.classList.remove("lcc-muted");
    bodyEl.innerHTML = "";
    const badgeKey = { ontrack: "ontrack", warning: "warning", offtrack: "offtrack" }[status] || "warning";
    addParagraph(bodyEl, note || "", badgeKey);
    setActions([
      { id: "lcc-whatswrong", label: "Check code", style: "lcc-primary", on: () => requestDetail(false) },
      { id: "lcc-hint2", label: "Hint", style: "lcc-secondary", on: () => requestHint(false) },
      { id: "lcc-ok", label: "Got it", style: "lcc-ghost", spacer: true, on: setBodyWatching },
    ]);

    // Pop open for problems, stay quiet when on track (if quiet mode on).
    if (status === "ontrack" && settings.quietWhenOnTrack) {
      // leave collapsed; the green ✓ in the pill is enough
    } else {
      setCollapsed(false);
    }
    renderHeader();
  }

  function setBodyHint(data) {
    uiState = "hint";
    const d = data && typeof data === "object" ? data : { plain: String(data || "") };
    bodyEl.classList.remove("lcc-muted");
    bodyEl.innerHTML = "";
    addParagraph(bodyEl, "", "hint", d.headline || "");
    if (d.plain) addParagraph(bodyEl, d.plain);
    renderBlocks(bodyEl, d.blocks);
    const level = d.level || (state ? state.hintLevel : 1);
    const more = level < 4;
    setActions([
      more ? { id: "lcc-more", label: "Need more", style: "lcc-primary", on: () => requestHint(true) } : null,
      { id: "lcc-dismiss", label: "Got it", style: more ? "lcc-ghost" : "lcc-primary", spacer: true,
        on: () => { if (state) state.lastHintTime = now(); setBodyWatching(); } },
    ].filter(Boolean));
    setCollapsed(false);
    renderHeader();
  }

  function setBodyError(msg) {
    uiState = "watching"; verdictStatus = null;
    bodyEl.classList.remove("lcc-muted");
    bodyEl.innerHTML = "";
    addParagraph(bodyEl, msg, "error");
    setActions([
      { id: "lcc-okerr", label: "OK", style: "lcc-primary", spacer: true, on: setBodyWatching },
    ]);
    setCollapsed(false);
    renderHeader();
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
    }
    return fallbackCopy(text);
  }
  function fallbackCopy(text) {
    return new Promise((res, rej) => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
        document.body.appendChild(ta);
        ta.focus(); ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        ok ? res() : rej();
      } catch (e) { rej(e); }
    });
  }

  // ---------- review request ----------
  function runReview(force) {
    if (!state) return;
    const code = getCode();
    if (!force && !meaningfulCode(code)) return;
    state.lastReviewTime = now();
    state.lastAnalyzedCode = code;
    setBodyChecking();

    safeSend(
      { type: "GET_REVIEW", payload: { title: getTitle(), slug: getSlug(), description: getDescription(), code } },
      (res) => {
        if (!res) { if (force) setBodyError("No response. Try again."); else setBodyWatching(); return; }
        if (res.error) { if (force) setBodyError(res.message || "Something went wrong."); else setBodyWatching(); return; }
        if (res.status === "too_early") {
          if (force) {
            uiState = "watching"; verdictStatus = null;
            bodyEl.classList.add("lcc-muted");
            bodyEl.innerHTML = "";
            addParagraph(bodyEl, "Not much to judge yet. Sketch out your approach and I'll check it.");
            setActions([
              { id: "lcc-early-check", label: "Check code", style: "lcc-primary", on: () => requestDetail(false) },
              { id: "lcc-early-hint", label: "Hint", style: "lcc-secondary", on: () => requestHint(false) },
            ]);
            renderHeader();
          }
          else setBodyWatching();
          return;
        }
        const map = { on_track: "ontrack", warning: "warning", off_track: "offtrack" };
        setBodyVerdict(map[res.status] || "warning", res.note);
      }
    );
  }

  // ---------- detail request (what's wrong + code) ----------
  let detailDepth = 1;
  function requestDetail(deeper) {
    if (!state) return;
    detailDepth = deeper ? Math.min(detailDepth + 1, 3) : 1;
    setBodyChecking("Reading your code…");
    safeSend(
      { type: "GET_DETAIL", payload: { title: getTitle(), slug: getSlug(), description: getDescription(), code: getCode(), depth: detailDepth } },
      (res) => {
        if (!res) return setBodyError("No response. Try again.");
        if (res.error) return setBodyError(res.message || "Something went wrong.");
        setBodyDetail(res);
      }
    );
  }

  function setBodyDetail(data) {
    uiState = "detail";
    bodyEl.classList.remove("lcc-muted");
    bodyEl.innerHTML = "";

    const raw = Array.isArray(data.issues) ? data.issues : [];
    const issues = raw.filter((i) => i && (i.title || i.find || i.plain || i.why ||
      (Array.isArray(i.blocks) && i.blocks.length) || i.fix));

    if (issues.length) {
      addParagraph(bodyEl, data.summary || "Here's what stands out.", "issues");
    } else {
      addParagraph(bodyEl,
        data.summary || "I didn't catch a specific bug in what's written so far. Add more of your approach, or ask for a hint.",
        "reviewed");
    }

    issues.forEach((iss, idx) => {
      const card = document.createElement("div");
      card.className = "lcc-issue";

      const head = document.createElement("div");
      head.className = "lcc-issue-title";
      const num = document.createElement("span");
      num.className = "lcc-issue-num";
      num.textContent = String(idx + 1);
      head.appendChild(num);
      inlineCode(head, iss.title || "Issue " + (idx + 1));
      card.appendChild(head);

      const plain = iss.plain || iss.why || "";
      if (plain) {
        const p = document.createElement("div");
        p.className = "lcc-issue-plain";
        inlineCode(p, plain);
        card.appendChild(p);
      }

      renderBlocks(card, blocksFor(iss));
      bodyEl.appendChild(card);
    });

    setActions([
      detailDepth < 3
        ? { id: "lcc-deeper", label: "Explain more", style: "lcc-secondary", on: () => requestDetail(true) }
        : null,
      { id: "lcc-detail-hint", label: "Hint", style: "lcc-secondary", on: () => requestHint(false) },
      { id: "lcc-detail-ok", label: "Got it", style: "lcc-primary", spacer: true,
        on: () => { clearHighlights(); setBodyWatching(); } },
    ].filter(Boolean));

    if (settings.highlightOnScreen) highlightInEditor(issues);
    setCollapsed(false);
    renderHeader();
  }

  // ---------- editor highlighting ----------
  let highlightTargets = [];
  let highlightEls = [];
  let highlightTimer = null;
  // Whitespace-stripped, lowercased form. Matching on this makes the highlight
  // robust to the AI reformatting spacing/indentation when it quotes your code.
  function tight(s) { return (s || "").replace(/\s+/g, "").toLowerCase(); }
  function clearHighlights() {
    highlightEls.forEach((el) => el.remove());
    highlightEls = [];
    highlightTargets = [];
    if (highlightTimer) { clearInterval(highlightTimer); highlightTimer = null; }
  }
  function highlightInEditor(issues) {
    clearHighlights();
    // A "find" snippet may span several lines; match each line on its own.
    const targets = [];
    issues.forEach((i) => {
      (i.find || "").split("\n").forEach((ln) => {
        const t = tight(ln);
        if (t.length >= 4) targets.push(t);
      });
    });
    highlightTargets = targets;
    if (!highlightTargets.length) return;
    positionHighlights();
    highlightTimer = setInterval(guard(positionHighlights), 600); // re-track scroll/edits
    intervals.push(highlightTimer);
    window.addEventListener("scroll", positionHighlights, true);
  }
  function positionHighlights() {
    highlightEls.forEach((el) => el.remove());
    highlightEls = [];
    if (!highlightTargets.length) return;
    const lines = Array.from(document.querySelectorAll(".view-line"));
    lines.forEach((line) => {
      const lt = tight(line.textContent);
      if (lt.length < 3) return;
      for (const target of highlightTargets) {
        if (lt.includes(target) || (target.length >= 6 && target.includes(lt))) {
          const r = line.getBoundingClientRect();
          if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > window.innerHeight) break;
          const box = document.createElement("div");
          box.className = "lcc-hl";
          box.style.cssText = `left:${r.left}px;top:${r.top}px;width:${Math.max(r.width, 40)}px;height:${r.height}px;`;
          document.body.appendChild(box);
          highlightEls.push(box);
          break;
        }
      }
    });
  }

  // ---------- hint request ----------
  function requestHint(escalate) {
    if (!state) return;
    state.lastHintTime = now();
    state.hintLevel = escalate ? Math.min(state.hintLevel + 1, 4) : Math.max(state.hintLevel, 1);
    setBodyChecking("Working out a hint…");
    safeSend(
      { type: "GET_HINT", payload: { title: getTitle(), slug: getSlug(), description: getDescription(), code: getCode(), hintLevel: state.hintLevel } },
      (res) => {
        if (!res) return setBodyError("No response. Try again.");
        if (res.error) return setBodyError(res.message || "Something went wrong.");
        setBodyHint(res);
      }
    );
  }

  // ---------- ask about a selection ----------
  let askChip = null;
  let pendingSelection = "";

  function hideAskChip() {
    if (askChip) { askChip.remove(); askChip = null; }
  }
  function showAskChip(text, x, y) {
    hideAskChip();
    askChip = document.createElement("button");
    askChip.id = "lcc-askchip";
    askChip.textContent = "Ask Coach";
    const cx = Math.min(Math.max(8, x), window.innerWidth - 110);
    const cy = Math.min(Math.max(8, y + 10), window.innerHeight - 40);
    askChip.style.cssText = `left:${cx}px;top:${cy}px;`;
    askChip.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
    askChip.addEventListener("click", (e) => {
      e.preventDefault(); e.stopPropagation();
      const sel = text;
      hideAskChip();
      openAsk(sel);
    });
    document.body.appendChild(askChip);
  }

  function openAsk(selection) {
    pendingSelection = selection || "";
    setBodyAsk();
    setCollapsed(false);
  }

  function setBodyAsk(prefillAnswerNote) {
    uiState = "ask";
    bodyEl.classList.remove("lcc-muted");
    bodyEl.innerHTML = "";

    if (pendingSelection) {
      const snippet = pendingSelection.length > 800 ? pendingSelection.slice(0, 800) + "\n…" : pendingSelection;
      bodyEl.appendChild(makeCodeTile("code", "Your selection", snippet));
    } else {
      addParagraph(bodyEl, "No selection detected. Ask anything about this problem.", "ask");
    }

    const ta = document.createElement("textarea");
    ta.className = "lcc-ask-input";
    ta.id = "lcc-ask-input";
    ta.setAttribute("aria-label", "Your question for Coach");
    ta.placeholder = pendingSelection
      ? "Ask about this selection. e.g. is this how I traverse the string?"
      : "Paste code into your question, or just ask. e.g. how do I access a node's next pointer?";
    ta.rows = 3;
    bodyEl.appendChild(ta);

    setActions([
      { id: "lcc-ask-send", label: "Ask", style: "lcc-primary", on: () => { const q = ta.value.trim(); if (q) requestAsk(q); } },
      { id: "lcc-ask-cancel", label: "Cancel", style: "lcc-ghost", spacer: true, on: setBodyWatching },
    ]);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        const q = ta.value.trim();
        if (q) requestAsk(q);
      }
    });
    setTimeout(() => ta.focus(), 0);
    renderHeader();
  }

  function requestAsk(question) {
    setBodyChecking("Thinking about your question…");
    safeSend(
      { type: "GET_ASK", payload: { title: getTitle(), slug: getSlug(), description: getDescription(), selection: pendingSelection, question } },
      (res) => {
        if (!res) return setBodyError("No response. Try again.");
        if (res.error) return setBodyError(res.message || "Something went wrong.");
        setBodyAskAnswer(res);
      }
    );
  }

  function setBodyAskAnswer(data) {
    uiState = "ask";
    const d = data && typeof data === "object" ? data : { plain: String(data || "") };
    bodyEl.classList.remove("lcc-muted");
    bodyEl.innerHTML = "";
    addParagraph(bodyEl, d.plain || d.answer || "", "answer");
    renderBlocks(bodyEl, d.blocks);
    setActions([
      { id: "lcc-ask-again", label: "Ask another", style: "lcc-secondary", on: () => setBodyAsk() },
      { id: "lcc-ask-done", label: "Got it", style: "lcc-primary", spacer: true, on: setBodyWatching },
    ]);
    renderHeader();
  }

  // ---------- auto loop ----------
  function tick() {
    if (!settings.enabled || !settings.autoCheck || !state) return;
    if (uiState === "checking" || uiState === "hint" || uiState === "detail" || uiState === "ask") return;
    const t = now();
    const idle = (t - state.lastActivity) / 1000;       // paused typing?
    const sinceReview = (t - state.lastReviewTime) / 1000;
    const code = getCode();
    if (
      idle >= settings.pauseSeconds &&
      sinceReview >= settings.cooldownSeconds &&
      meaningfulCode(code) &&
      changedEnough(code)
    ) {
      runReview(false);
    }
  }

  // ---------- dragging & position ----------
  // Anchor by the panel's TOP-LEFT corner so you can place the pill anywhere,
  // including the very top/left. When the card expands, it shifts just enough
  // to stay fully on screen.
  let savedPos = null; // {x, y} top-left of the pill; null => default
  let pillDim = { w: 96, h: 34 };
  let userMoved = false; // set once the user drags it themselves

  function measurePill() {
    const pill = panel && panel.querySelector("#lcc-pill");
    if (pill && pill.offsetWidth) pillDim = { w: pill.offsetWidth, h: pill.offsetHeight };
  }
  function findSubmitBtn() {
    const exact = document.querySelector('[data-e2e-locator="console-submit-button"]');
    if (exact) return exact;
    const btns = Array.from(document.querySelectorAll("button, a"));
    return btns.find((b) => /^\s*submit\s*$/i.test(b.textContent || "")) || null;
  }
  function defaultPos() {
    // Try to sit in LeetCode's top toolbar, just right of Submit, so it reads
    // as part of the page. Fall back to top-right if the toolbar isn't found.
    const submit = findSubmitBtn();
    if (submit) {
      const r = submit.getBoundingClientRect();
      if (r.width && r.top < window.innerHeight / 2) {
        return {
          x: Math.min(r.right + 24, window.innerWidth - pillDim.w - 12),
          y: Math.max(8, r.top + (r.height - pillDim.h) / 2),
        };
      }
    }
    return { x: Math.max(8, window.innerWidth - pillDim.w - 240), y: 56 };
  }
  function place(p, save) {
    if (!panel || !p) return;
    let x = Math.min(Math.max(8, p.x), window.innerWidth - 40);
    let y = Math.min(Math.max(8, p.y), window.innerHeight - 20);
    panel.style.right = "auto";
    panel.style.bottom = "auto";
    panel.style.left = x + "px";
    panel.style.top = y + "px";
    // Shift to keep the (possibly expanded) panel on screen.
    const r = panel.getBoundingClientRect();
    let nx = x, ny = y;
    if (r.right > window.innerWidth - 8) nx -= r.right - (window.innerWidth - 8);
    if (r.bottom > window.innerHeight - 8) ny -= r.bottom - (window.innerHeight - 8);
    nx = Math.max(8, nx);
    ny = Math.max(8, ny);
    if (nx !== x || ny !== y) {
      panel.style.left = nx + "px";
      panel.style.top = ny + "px";
    }
    savedPos = { x, y }; // remember the user's intended pill spot (pre-shift)
    if (save) savePosition();
  }
  function savePosition() { if (savedPos) safeSet({ lccPos: savedPos }); }
  function loadPosition() {
    safeGet(["lccPos"], (s) => {
      if (s.lccPos && typeof s.lccPos.x === "number") {
        place(s.lccPos, false);
      } else {
        place(defaultPos(), false);
        // LeetCode's toolbar can render slightly late; re-anchor once if the
        // user hasn't moved the pill themselves yet.
        setTimeout(() => { if (!userMoved) place(defaultPos(), false); }, 1500);
      }
    });
  }
  function makeDraggable(handle) {
    if (!handle) return;
    handle.style.cursor = "grab";
    let dragging = false, moved = false, sx = 0, sy = 0, baseX = 0, baseY = 0;
    handle.addEventListener("pointerdown", (e) => {
      if (e.target.closest("button")) return;
      dragging = true; moved = false; sx = e.clientX; sy = e.clientY;
      const r = panel.getBoundingClientRect();
      baseX = r.left; baseY = r.top;
      handle.style.cursor = "grabbing";
      try { handle.setPointerCapture(e.pointerId); } catch (_) {}
    });
    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      place({ x: baseX + dx, y: baseY + dy }, false);
    });
    function endDrag(e) {
      if (!dragging) return;
      dragging = false; handle.style.cursor = "grab";
      try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
      if (moved) { userMoved = true; savePosition(); suppressClick = true; setTimeout(() => (suppressClick = false), 0); }
    }
    handle.addEventListener("pointerup", endDrag);
    handle.addEventListener("pointercancel", endDrag);
  }

  // ---------- wiring ----------
  function isEditorTyping(e) {
    return !!(e.target && e.target.closest &&
      e.target.closest(".monaco-editor, .view-lines, .inputarea, textarea"));
  }
  function isEditKey(e) {
    if (e.ctrlKey || e.metaKey) return e.key === "v" || e.key === "x"; // paste / cut
    return (e.key && e.key.length === 1) || ["Backspace", "Delete", "Enter", "Tab"].includes(e.key);
  }
  function attachActivityListeners() {
    // Idle is based on TYPING in the code editor only, not clicking around.
    document.addEventListener("keydown", (e) => {
      if (!isEditorTyping(e)) return;
      markActivity();
      hideAskChip();
      // Once they start actually editing, clear stale red marks. Reading or
      // arrowing around (no edit key) leaves them in place.
      if (isEditKey(e) && highlightEls.length) clearHighlights();
    }, true);
    document.addEventListener("input", (e) => {
      if (!isEditorTyping(e)) return;
      markActivity();
      if (highlightEls.length) clearHighlights();
    }, true);
    // Running/submitting code counts as progress: reset idle + review cooldown.
    document.addEventListener("click", (e) => {
      const txt = ((e.target && e.target.textContent) || "").toLowerCase();
      if (txt.includes("run") || txt.includes("submit")) {
        if (state) { state.lastActivity = now(); state.lastReviewTime = now(); }
      }
    }, true);

    // Selecting code in the editor pops an "Ask Coach" chip near the selection.
    document.addEventListener("mouseup", (e) => {
      const inEditor = e.target && e.target.closest && e.target.closest(".monaco-editor, .view-lines");
      if (!inEditor) return;
      const mx = e.clientX, my = e.clientY;
      setTimeout(() => {
        getMonacoSelection().then((text) => {
          if (text && text.trim().length >= 1) showAskChip(text.trim(), mx, my);
          else hideAskChip();
        });
      }, 10);
    }, true);
    document.addEventListener("scroll", hideAskChip, true);
  }
  function loadSettings(cb) {
    safeGet(["enabled", "autoCheck", "pauseSeconds", "cooldownSeconds", "quietWhenOnTrack", "highlightOnScreen", "lccMigratedTiming"], (s) => {
      // One-time migration: bump the old aggressive timing to gentler defaults.
      if (!s.lccMigratedTiming) {
        const m = { pauseSeconds: DEFAULTS.pauseSeconds, cooldownSeconds: DEFAULTS.cooldownSeconds, autoCheck: true, lccMigratedTiming: true };
        safeSet(m);
        s = Object.assign({}, s, m);
      }
      settings = {
        enabled: s.enabled !== undefined ? s.enabled : DEFAULTS.enabled,
        autoCheck: s.autoCheck !== undefined ? s.autoCheck : DEFAULTS.autoCheck,
        pauseSeconds: s.pauseSeconds || DEFAULTS.pauseSeconds,
        cooldownSeconds: s.cooldownSeconds || DEFAULTS.cooldownSeconds,
        quietWhenOnTrack: s.quietWhenOnTrack !== undefined ? s.quietWhenOnTrack : DEFAULTS.quietWhenOnTrack,
        highlightOnScreen: s.highlightOnScreen !== undefined ? s.highlightOnScreen : DEFAULTS.highlightOnScreen,
      };
      cb && cb();
    });
  }
  chrome.storage.onChanged.addListener((changes) => {
    for (const k of Object.keys(changes)) if (k in settings) settings[k] = changes[k].newValue;
    if (changes.lccCalls || changes.lccReviewCalls || changes.lccHintCalls || changes.lccDetailCalls || changes.lccAskCalls) updateCount();
    renderHeader();
  });

  // A page counts as a solving page when a code editor is present. On LeetCode
  // that is a /problems/ page; NeetCode is a single-page app, so we rely on the
  // editor showing up. This watcher lazily starts the coach and resets it when
  // you navigate between problems.
  function isSolvingPage() {
    if (!hasEditor()) return false;
    if (SITE === "leetcode") return /\/problems\//.test(location.pathname);
    return true; // neetcode: editor present is enough
  }

  function init() {
    let started = false;
    let lastUrl = location.href;
    function evaluate() {
      if (isSolvingPage()) {
        if (!started) {
          started = true;
          const ver = (chrome.runtime.getManifest && chrome.runtime.getManifest().version) || "";
          console.log(`%cCoach ${ver ? "v" + ver + " " : ""}active on ${SITE}`, "color:#0071e3;font-weight:bold");
          injectPageHelper();
          buildPanel();
          resetForNewProblem();
          attachActivityListeners();
          loadSettings(() => {
            intervals.push(setInterval(guard(tick), 2000));
            intervals.push(setInterval(guard(renderHeader), 1000));
          });
        } else if (location.href !== lastUrl) {
          resetForNewProblem(); // moved to a different problem
        }
        if (panel) panel.style.display = "";
      } else if (panel) {
        panel.style.display = "none"; // not on a problem (e.g. NeetCode list page)
      }
      lastUrl = location.href;
    }
    evaluate();
    intervals.push(setInterval(guard(evaluate), 1200));
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
