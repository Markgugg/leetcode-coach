const DEFAULTS = {
  provider: "anthropic",
  apiKey: "", model: "claude-sonnet-5", workspaceId: "",
  openaiKey: "", openaiModel: "gpt-4o-mini",
  enabled: true, autoCheck: true,
  quietWhenOnTrack: true, highlightOnScreen: true, cheapWatch: true,
  pauseSeconds: 15, cooldownSeconds: 120,
};

const PROVIDERS = {
  anthropic: {
    label: "Anthropic API key",
    placeholder: "sk-ant-...",
    linkText: "console.anthropic.com",
    linkHref: "https://console.anthropic.com/settings/keys",
    models: [
      ["claude-sonnet-5", "Sonnet 5 (balanced)"],
      ["claude-haiku-4-5-20251001", "Haiku 4.5 (fast & cheap)"],
      ["claude-opus-5", "Opus 5 (smartest)"],
    ],
  },
  openai: {
    label: "OpenAI API key",
    placeholder: "sk-...",
    linkText: "platform.openai.com",
    linkHref: "https://platform.openai.com/api-keys",
    models: [
      ["gpt-4o-mini", "GPT-4o mini (fast & cheap)"],
      ["gpt-4o", "GPT-4o (balanced)"],
      ["gpt-4.1", "GPT-4.1 (smartest)"],
    ],
  },
};

let store = {}; // last loaded settings

function fillModels(provider, selected) {
  const sel = document.getElementById("model");
  sel.innerHTML = "";
  PROVIDERS[provider].models.forEach(([val, label]) => {
    const o = document.createElement("option");
    o.value = val; o.textContent = label;
    sel.appendChild(o);
  });
  // A previously saved model may have been retired from the list. Don't leave
  // the select blank, or Save would write an empty model.
  const known = PROVIDERS[provider].models.some(([v]) => v === selected);
  sel.value = known ? selected : PROVIDERS[provider].models[0][0];
}

function renderProvider(provider) {
  const p = PROVIDERS[provider];
  document.getElementById("keyLabel").textContent = p.label;
  document.getElementById("apiKey").placeholder = p.placeholder;
  const link = document.getElementById("keyLink");
  link.textContent = p.linkText; link.href = p.linkHref;
  // Workspace ID is an Anthropic-only concept.
  document.getElementById("workspaceRow").style.display = provider === "openai" ? "none" : "";
  if (provider === "openai") {
    document.getElementById("apiKey").value = store.openaiKey || "";
    fillModels("openai", store.openaiModel || DEFAULTS.openaiModel);
  } else {
    document.getElementById("apiKey").value = store.apiKey || "";
    fillModels("anthropic", store.model || DEFAULTS.model);
  }
}

function load() {
  chrome.storage.local.get(Object.keys(DEFAULTS), (s) => {
    store = s || {};
    const provider = s.provider || DEFAULTS.provider;
    document.getElementById("provider").value = provider;
    document.getElementById("enabled").checked = s.enabled !== undefined ? s.enabled : DEFAULTS.enabled;
    document.getElementById("autoCheck").checked = s.autoCheck !== undefined ? s.autoCheck : DEFAULTS.autoCheck;
    document.getElementById("quietWhenOnTrack").checked = s.quietWhenOnTrack !== undefined ? s.quietWhenOnTrack : DEFAULTS.quietWhenOnTrack;
    document.getElementById("highlightOnScreen").checked = s.highlightOnScreen !== undefined ? s.highlightOnScreen : DEFAULTS.highlightOnScreen;
    document.getElementById("cheapWatch").checked = s.cheapWatch !== undefined ? s.cheapWatch : DEFAULTS.cheapWatch;
    document.getElementById("pauseSeconds").value = s.pauseSeconds || DEFAULTS.pauseSeconds;
    document.getElementById("cooldownSeconds").value = s.cooldownSeconds || DEFAULTS.cooldownSeconds;
    document.getElementById("workspaceId").value = s.workspaceId || "";
    renderProvider(provider);
  });
}

function save() {
  const provider = document.getElementById("provider").value;
  const key = document.getElementById("apiKey").value.trim();
  const model = document.getElementById("model").value;
  const data = {
    provider,
    enabled: document.getElementById("enabled").checked,
    autoCheck: document.getElementById("autoCheck").checked,
    quietWhenOnTrack: document.getElementById("quietWhenOnTrack").checked,
    highlightOnScreen: document.getElementById("highlightOnScreen").checked,
    cheapWatch: document.getElementById("cheapWatch").checked,
    pauseSeconds: parseInt(document.getElementById("pauseSeconds").value, 10) || DEFAULTS.pauseSeconds,
    cooldownSeconds: parseInt(document.getElementById("cooldownSeconds").value, 10) || DEFAULTS.cooldownSeconds,
  };
  if (provider === "openai") { data.openaiKey = key; data.openaiModel = model; }
  else {
    data.apiKey = key; data.model = model;
    data.workspaceId = document.getElementById("workspaceId").value.trim();
  }
  chrome.storage.local.set(data, () => {
    store = Object.assign({}, store, data);
    const st = document.getElementById("status");
    st.textContent = "Saved ✓";
    setTimeout(() => (st.textContent = ""), 1500);
  });
}

// Switching provider: remember whatever key/model is currently typed for the
// old provider, then show the new provider's saved values.
document.getElementById("provider").addEventListener("change", (e) => {
  const oldProvider = store.provider || DEFAULTS.provider;
  const typedKey = document.getElementById("apiKey").value.trim();
  const typedModel = document.getElementById("model").value;
  if (oldProvider === "openai") { store.openaiKey = typedKey; store.openaiModel = typedModel; }
  else { store.apiKey = typedKey; store.model = typedModel; }
  store.provider = e.target.value;
  chrome.storage.local.set({ provider: e.target.value });
  renderProvider(e.target.value);
});

document.getElementById("save").addEventListener("click", save);
document.getElementById("enabled").addEventListener("change", () =>
  chrome.storage.local.set({ enabled: document.getElementById("enabled").checked }));
document.getElementById("autoCheck").addEventListener("change", () =>
  chrome.storage.local.set({ autoCheck: document.getElementById("autoCheck").checked }));
document.getElementById("quietWhenOnTrack").addEventListener("change", () =>
  chrome.storage.local.set({ quietWhenOnTrack: document.getElementById("quietWhenOnTrack").checked }));
document.getElementById("highlightOnScreen").addEventListener("change", () =>
  chrome.storage.local.set({ highlightOnScreen: document.getElementById("highlightOnScreen").checked }));

function renderUsage() {
  chrome.storage.local.get(
    ["lccCalls", "lccReviewCalls", "lccHintCalls", "lccDetailCalls", "lccAskCalls"],
    (s) => {
      document.getElementById("usage-total").textContent = s.lccCalls || 0;
      // Same four buckets the card footer shows, so the two never disagree.
      const parts = [
        [s.lccReviewCalls || 0, "auto"],
        [s.lccDetailCalls || 0, "review", "reviews"],
        [s.lccHintCalls || 0, "hint", "hints"],
        [s.lccAskCalls || 0, "ask", "asks"],
      ].map(([n, one, many]) => `${n} ${n === 1 || !many ? one : many}`);
      document.getElementById("usage-breakdown").textContent = parts.join(" \u00b7 ");
    }
  );
}
document.getElementById("reset").addEventListener("click", () => {
  chrome.storage.local.set({ lccCalls: 0, lccReviewCalls: 0, lccHintCalls: 0, lccDetailCalls: 0, lccAskCalls: 0 }, renderUsage);
});
chrome.storage.onChanged.addListener((c) => {
  if (c.lccCalls || c.lccReviewCalls || c.lccHintCalls || c.lccDetailCalls || c.lccAskCalls) renderUsage();
});

load();
renderUsage();
document.getElementById("cheapWatch").addEventListener("change", () =>
  chrome.storage.local.set({ cheapWatch: document.getElementById("cheapWatch").checked }));
