# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository

A collection of Tampermonkey userscripts, most of them modified copies of third-party scripts. Users install each script from its raw GitHub URL, and every computer auto-updates from `main`. There is no build step, package manager, dependency, or test suite.

Conventions every script follows:

- One self-contained `<kebab-name>.user.js` file per script at the repo root. The `.user.js` suffix makes Tampermonkey open its install page when the raw URL is visited.
- `@updateURL` and `@downloadURL` both point to `https://raw.githubusercontent.com/ppanphper/tampermonkey-scripts/main/<file>`.
- Tampermonkey only updates when `@version` increases, so bump it in every change that reaches `main`. raw.githubusercontent.com caches responses for 5 minutes.
- Keep `@name` and `@namespace` from the upstream script; userscript managers use them to recognize an existing install. Keep the original author and license in `@author`/`@license`, and note the modification (`原作者 / ppanphper 修改`).
- Each script has a section in `README.md` (Chinese) with its install URL and a one-line description. Update it when platforms or features change.

## Verification

- Syntax check: `node --check <file>.user.js`
- Behavior can only be verified in a logged-in browser on the target site. To try an uncommitted version without reinstalling, serve the worktree locally (any static server with `Access-Control-Allow-Origin: *`), then evaluate `(0, eval)(await fetch('http://127.0.0.1:<port>/<file>').then(r => r.text()))` in the page console. This works for `@grant none` scripts.
- Scripts that delete data must be tested on throwaway items created for the test. Override `window.confirm`/`window.alert` before triggering them when driving the page through browser automation, because native dialogs block it.

## bulk-chat-deleter.user.js

Adds a "Batch Delete" toolbar to the sidebars of chatgpt.com, claude.ai, gemini.google.com (chats and Notebooks) and chat.deepseek.com. Based on KiraKiraAyu's Greasy Fork script 588305, version 1.3.0 (MIT). To pick up upstream fixes, download `https://update.greasyfork.org/scripts/588305/ChatGPTClaudeGemini%20Bulk%20Chat%20Deleter.user.js` and compare it with the commit that imported 1.3.0 unmodified (`git log --diff-filter=A -- bulk-chat-deleter.user.js`). Console output is prefixed with `[BCD]`.

Everything lives inside one async IIFE. The flow is: hostname → `PLATFORM` → `CONFIGS[PLATFORM]` (`cfg`) → wait for a visible sidebar → inject toolbar → `MutationObserver` keeps the toolbar and checkboxes alive across SPA re-renders.

### Per-platform config is the main extension point

Adding a site or fixing a DOM change means editing `PLATFORM` detection, `@match` and `CONFIGS`; the logic rarely changes. Selector arrays are consumed in different ways, which matters when adding entries:

| Key | How it is used |
|---|---|
| `sidebar` | Ordered; first selector with a visible (non-zero size) match wins (`findVisibleSidebar`) |
| `itemLink`, `menuTrigger` | Ordered fallback via `trySelector`; first match inside the item wins. `findItemLink` also accepts the item itself (DeepSeek rows are the `<a>`) |
| `item` | Joined with `", "` into one `querySelectorAll`, so every selector contributes (union) |
| `deleteMenuItem`, `confirmButton` | Union of `selectors`, then filtered by `textMatch` against text **and** attributes (`aria-label`, `data-testid`, `data-test-id`, `value`, `leadingicon`, ...). Without `textMatch`, the first candidate is accepted, so the selectors alone must be unambiguous |

Prefer language-independent matches: attributes such as `data-testid`, design-system classes (DeepSeek's `ds-dropdown-menu-option--error` / `ds-button--error`), or DOM position. `confirmButton.strategy` adds position strategies tried before text matching: `last-dialog-button` (last enabled `<button>` in the topmost visible dialog; Claude and Gemini chats) and `dialog-confirm-button` (`confirm-button` test id; Gemini Notebooks). Both only see real `<button>` elements; DeepSeek's dialog buttons are `div[role=button]`, so it uses plain selectors.

Toolbar placement: `toolbarInsertBefore` (waits for that anchor) → otherwise, if `toolbarPrepend` is false, insert before the first `item` → otherwise prepend to the sidebar. `toolbarColor` overrides the inherited text color (DeepSeek's `body` color is purple). `toolbarAnchor` is declared in configs but unused.

Timing knobs: `stepDelay` (between UI steps), `deletionDelay` (after each confirm), `waitGoneTimeout` (only honored for Gemini Notebooks; the ChatGPT value is unused).

### Gemini Notebooks as a second target

`GEMINI_NOTEBOOK_CONFIG` has the same shape as a platform config plus `label`/`pluralLabel` and a custom `getItems()`, because notebooks appear in two places: the sidebar and the `/notebooks/view` card grid. `activeTarget` (`"conversations"` | `"notebooks"`) is switched by the Chats/Notebooks toggle, and `getActiveConfig()` returns the matching config. All selection and deletion functions take an `itemConfig` argument instead of reading `cfg` directly; keep it that way so the two targets never mix.

### Deletion pipeline

`deleteSelected` snapshots an **identity** for each checked item before deleting anything, because sites re-render sidebar nodes after every deletion. The identity is the item's `href`, or `{title, occurrence}` for link-less notebook cards. Each item is then looked up again with `findItemByIdentity`. An item that is already gone counts as success. On the card view the list is processed in reverse so `occurrence` indices stay valid.

`deleteOne` drives the real site UI:

1. Scroll into view.
2. Dispatch `mouseover`/`mouseenter`/`mousemove` on the item and every ancestor up to the sidebar, which triggers CSS `group-hover` and Angular CDK overlays.
3. Click the menu trigger as soon as it exists. JS `.click()` works even while it is CSS-hidden.
4. Poll for the delete menu item.
5. Poll for a confirm button that is visible **and** enabled. Claude briefly disables it after the dialog opens.
6. For notebooks only, wait until the card leaves the DOM; otherwise the deletion is treated as failed.

On failure, an `Escape` keydown is dispatched to close menus and the loop continues; DeepSeek's dropdown ignores it and only closes on an outside click. `abortRequested` is checked between items.

### UI constraints

- Build DOM with `createEl`; never use `innerHTML`. Gemini enforces a Trusted Types CSP.
- All injected IDs and classes use the `bcd-` prefix. `body.bcd-active` toggles batch-mode visibility through CSS in `injectStyles`.
- Checkboxes are prepended to each item and stop propagation of pointer, mouse, touch, click and key events so selecting a row does not navigate.
- The body-wide observer is debounced by 100 ms. `injectingToolbar` prevents concurrent injections while `injectToolbar` awaits anchors.
