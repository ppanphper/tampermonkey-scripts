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
- Behavior can only be verified in a logged-in browser on the target site. To try an uncommitted `@grant none` script without reinstalling, run it in the page:
  - Sites without a strict CSP (DeepSeek): serve the worktree locally with `Access-Control-Allow-Origin: *` and evaluate `(0, eval)(await fetch('http://127.0.0.1:<port>/<file>').then(r => r.text()))`.
  - Sites whose CSP blocks localhost and `eval` (ChatGPT, Grok): put the file into a temporary `<input type=file>` (browser automation file upload), read it with `file.text()`, and append it as a `<script>` carrying the page's nonce (`[...document.scripts].map(s => s.nonce).find(Boolean)`). Compare a SHA-256 of the loaded text with the local file. Do not route the source through the system clipboard; the user may be copying at the same time.
  - If an installed copy of the same script is active on the page, remove its `#bcd-toolbar` in the same task that injects the new copy, otherwise its observer re-inserts its own toolbar first.
- Scripts that delete data must be tested on throwaway items created for the test. Override `window.confirm`/`window.alert` before triggering them when driving the page through browser automation, because native dialogs block it.

## bulk-chat-deleter.user.js

Adds a "Batch Delete" toolbar to the sidebars of chatgpt.com, claude.ai, gemini.google.com (chats and Notebooks), chat.deepseek.com and grok.com. Based on KiraKiraAyu's Greasy Fork script 588305, version 1.3.0 (MIT). To pick up upstream fixes, download `https://update.greasyfork.org/scripts/588305/ChatGPTClaudeGemini%20Bulk%20Chat%20Deleter.user.js` and compare it with the commit that imported 1.3.0 unmodified (`git log --diff-filter=A -- bulk-chat-deleter.user.js`). Console output is prefixed with `[BCD]`.

Everything lives inside one async IIFE. The flow is: hostname → `PLATFORM` → `CONFIGS[PLATFORM]` (`cfg`) → start the body `MutationObserver` → wait for a visible sidebar → inject toolbar. The observer keeps the toolbar and checkboxes alive across SPA re-renders, and also injects the toolbar later when the sidebar was collapsed at load and `waitForSidebar` gave up.

### Per-platform config is the main extension point

Adding a site or fixing a DOM change means editing `PLATFORM` detection, `@match` and `CONFIGS`; the logic rarely changes. Selector arrays are consumed in different ways, which matters when adding entries:

| Key | How it is used |
|---|---|
| `sidebar` | Ordered; first selector with a visible (non-zero size) match wins (`findVisibleSidebar`) |
| `itemLink`, `menuTrigger` | Ordered fallback via `trySelector`; first match inside the item wins. `findItemLink` also accepts the item itself (DeepSeek rows are the `<a>`) |
| `getItemId` | Optional; identifies rows that have no href (Grok uses `getReactKeyId`). Rows it cannot identify get no checkbox |
| `item` | Joined with `", "` into one `querySelectorAll`, so every selector contributes (union) |
| `deleteMenuItem`, `confirmButton` | Union of `selectors`, then filtered by `textMatch` against text **and** attributes (`aria-label`, `data-testid`, `data-test-id`, `value`, `leadingicon`, ...). Without `textMatch`, the first candidate is accepted, so the selectors alone must be unambiguous |

UI language varies per account, so prefer language-independent matches: attributes such as `data-testid`, styling classes that mark the destructive action (ChatGPT's `text-danger` menu item, DeepSeek's `ds-*--error`), icons (Grok's `use[href*="-archive"]`), `type="submit"`, or DOM position. `confirmButton.strategy` adds position strategies tried before the selectors: `last-dialog-button` (last enabled `<button>` in the topmost visible dialog; Claude and Gemini chats), `first-dialog-button` (Grok, whose Cancel is last) and `dialog-confirm-button` (`confirm-button` test id; Gemini Notebooks). They only see real `<button>` elements; DeepSeek's dialog buttons are `div[role=button]`, so it uses plain selectors.

Site-specific facts that are easy to break:

- ChatGPT renders a 52 px app rail (`nav.group/sidebar-rail`) before the history nav; the rail must never be chosen as the sidebar. Its delete dialog has a pre-checked "also delete files" checkbox that the script leaves alone.
- Grok rows are `<button>`s with no href, and the conversation id exists only as the React `key` of an ancestor, read through the `__reactFiber$` expando. This requires Tampermonkey's default `@sandbox raw` (page MAIN_WORLD). Grok's UI only offers archive, which is a soft delete (`DELETE /rest/app-chat/conversations/soft/{id}`, restorable for 30 days); the "已归档" status filter lists them.

Toolbar placement: `toolbarInsertBefore` (waits for that anchor) → otherwise, if `toolbarPrepend` is false, insert before the first `item` → otherwise prepend to the sidebar, or to its first descendant that stacks vertically and spans most of its width → otherwise a fixed toolbar floats over the sidebar's bottom-left corner. Every step only accepts a parent that `stacksVertically` (block or column flex, looking through `display: contents`); a flex row or grid would squeeze the sidebar, as Gemini's `bard-sidenav` did. A floating toolbar or a `No vertical container` warning means the selectors are stale. `toolbarColor` overrides the inherited text color (DeepSeek's `body` color is purple). `toolbarAnchor` is declared in configs but unused.

Timing knobs: `stepDelay` (between UI steps), `deletionDelay` (after each confirm), `waitGoneTimeout` (only honored for Gemini Notebooks; the ChatGPT value is unused).

### Gemini Notebooks as a second target

`GEMINI_NOTEBOOK_CONFIG` has the same shape as a platform config plus `label`/`pluralLabel` and a custom `getItems()`, because notebooks appear in two places: the sidebar and the `/notebooks/view` card grid. `activeTarget` (`"conversations"` | `"notebooks"`) is switched by the Chats/Notebooks toggle, and `getActiveConfig()` returns the matching config. All selection and deletion functions take an `itemConfig` argument instead of reading `cfg` directly; keep it that way so the two targets never mix.

### Deletion pipeline

`deleteSelected` snapshots an **identity** for each checked item before deleting anything, because sites re-render sidebar nodes after every deletion. The identity is the item's `href`, the `getItemId` value when the config has one (never falling back to titles), or `{title, occurrence}` for link-less notebook cards. Each item is then looked up again with `findItemByIdentity`. An item that is already gone counts as success. On the card view the list is processed in reverse so `occurrence` indices stay valid.

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
