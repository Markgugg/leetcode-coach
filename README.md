# LeetCode Coach

A Chrome extension that reads your code while you solve and tells you, in plain
English, whether your approach is heading the right way. It is not a solution
giver. It is a coach watching over your shoulder.

Works on `leetcode.com/problems/*` and `neetcode.io`.

---

## Quick start

1. **Load it.** Go to `chrome://extensions`, turn on **Developer mode** (top
   right), click **Load unpacked**, and pick this folder.
2. **Add a key.** Click the extension icon, paste an
   [Anthropic API key](https://console.anthropic.com/settings/keys), hit **Save**.
   OpenAI keys work too, pick the provider first.
3. **Workspace ID, only if asked.** If a request fails with
   `anthropic-workspace-id is required`, your key is identity linked. Copy the ID
   from [console workspaces](https://console.anthropic.com/settings/workspaces)
   into the popup. Leave it blank otherwise.
4. **Open any problem.** The Coach pill appears in the corner. Drag it anywhere,
   it remembers the spot. Click it to expand.
5. **After changing any file**, go back to `chrome://extensions` and hit
   **Reload** on the card. Then refresh the LeetCode tab.

---

## What it does

While you type, it watches. When you pause, it asks whether your approach is on
track and shows one of four states in the corner:

| State | Meaning |
|---|---|
| **On track** | The approach looks correct and efficient enough. |
| **Heads up** | Workable, but something is off. Too slow, or a case you missed. |
| **Rethink this** | The approach is fundamentally wrong. It says what to reconsider, not the answer. |
| *(quiet)* | Only scaffolding so far. Nothing to judge yet. |

Three buttons do the rest:

- **Check code** looks hard for real bugs and shows each one as a plain-English
  explanation, a worked example, your broken lines in red, and the fix in green.
  **Explain more** goes deeper, up to the full corrected method.
- **Hint** is spoiler free and graduated across four levels. Level 1 nudges at the
  category. Level 2 names the technique. Level 3 gives the steps. Level 4 gives
  pseudocode. It never writes a working solution.
- **Ask** appears when you select code on the page. Ask anything about it.

It knows it is looking at the LeetCode editor, so it will never tell you an
import is missing, never flag `class Solution:` or the given method signature,
and never ask for a main function or test harness. Only your method body is
judged.

---

## Settings

Everything is in the popup.

| Setting | What it does |
|---|---|
| **Enable coaching** | Master switch. |
| **Auto-check while typing** | Off means zero automatic calls. The coach only runs when you click. |
| **Quiet when on track** | Shows a green tick in the corner instead of popping open. |
| **Save credits on background checks** | Runs the automatic check on Haiku. Your buttons keep the model you picked. |
| **Highlight issues on editor** | Marks the broken lines in red on the editor itself. |
| **Pause / Min gap** | How long after you stop typing, and the floor between automatic checks. Higher means fewer calls. |

---

## What it costs

Each call is billed to your own API key. The call that costs most is not a
button, it is the automatic check that fires while you type. Four things hold
that down by default:

- The automatic check runs on **Haiku**, a third the price of Sonnet, because
  picking one of four labels does not need a bigger model.
- The problem statement is sent as a **cached block**, so repeat calls on the
  same problem stop paying full price for it. Only your code varies.
- Every call runs at **low reasoning effort**.
- Automatic checks are floored at **two minutes** apart.

To spend less still: turn **Auto-check while typing** off and drive it entirely
by button. To spend more and get sharper answers, pick Opus in the popup.

Real spend is at [console usage](https://console.anthropic.com/usage). The
counter in the popup counts calls, not dollars.

---

## Working on it

| File | What it holds |
|---|---|
| `content.js` | The card, all its screens, editor highlighting, drag and drop. |
| `content.css` | All styling. Palette lives in CSS variables at the top. |
| `background.js` | Every API call, all four prompts, response normalizing. |
| `popup.html` / `popup.js` | The settings panel. |
| `preview.html` | **Open this in a browser** to see all 13 card screens at once, without needing a LeetCode page or an API key. |

Two things worth knowing before you edit:

- **`popup.js` drives `popup.html` entirely by element `id`.** Rename one and
  that setting breaks silently, with no error anywhere.
- **The card and the popup share a palette but not a file.** Change a color in
  `content.css` and change it in the popup's `<style>` block too.

Reload the extension at `chrome://extensions` after any change. For content
script edits you also need to refresh the LeetCode tab.

---

## Pushing changes to GitHub

First time only, log in:

```bash
gh auth login
```

Then, from this folder:

```bash
git add -A
git commit -m "describe what changed"
git push
```

If you have never pushed this repo anywhere:

```bash
gh repo create leetcode-coach --private --source=. --remote=origin --push
```

Swap `--private` for `--public` if you want it visible. To check what you are
about to commit, `git status` and `git diff` first.
