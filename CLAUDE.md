# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository

A collection of Tampermonkey userscripts, most of them modified copies of third-party scripts. Users install each script from its raw GitHub URL, and every computer auto-updates from `main`. There is no build step, package manager or dependency. Only the two linux.do scripts have automated tests: local mock pages under `tests/<script-name>/`.

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
  - Injecting into a page that finished loading misses load-time bugs such as ChatGPT's hydration freeze. To reproduce Tampermonkey's timing, inject in the same browser batch right after `navigate`, keep the source in `localStorage` for repeated runs, and write breadcrumbs plus a 100 ms heartbeat to `localStorage`. A frozen tab answers no automation calls; read the breadcrumbs from another tab on the same origin (for example `https://chatgpt.com/robots.txt`), then remove the test keys.
- Scripts that delete data must be tested on throwaway items created for the test. Override `window.confirm`/`window.alert` before triggering them when driving the page through browser automation, because native dialogs block it.

## bulk-chat-deleter.user.js

Adds a "Batch Delete" toolbar to the sidebars of chatgpt.com, claude.ai, gemini.google.com (chats and Notebooks), chat.deepseek.com and grok.com. Based on KiraKiraAyu's Greasy Fork script 588305, version 1.3.0 (MIT). To pick up upstream fixes, download `https://update.greasyfork.org/scripts/588305/ChatGPTClaudeGemini%20Bulk%20Chat%20Deleter.user.js` and compare it with the commit that imported 1.3.0 unmodified (`git log --diff-filter=A -- bulk-chat-deleter.user.js`). Console output is prefixed with `[BCD]`.

Everything lives inside one async IIFE. The flow is: hostname → `PLATFORM` → `CONFIGS[PLATFORM]` (`cfg`) → start the body `MutationObserver` → wait for a visible sidebar → inject toolbar. The observer keeps the toolbar and checkboxes alive across SPA re-renders, and also injects the toolbar later when the sidebar was collapsed at load and `waitForSidebar` gave up.

### Per-platform config is the main extension point

Adding a site or fixing a DOM change means editing `PLATFORM` detection, `@match` and `CONFIGS`; the logic rarely changes. Selector arrays are consumed in different ways, which matters when adding entries:

| Key | How it is used |
|---|---|
| `sidebar` | Ordered; first selector with a visible (non-zero size) match wins (`findVisibleSidebar`). With `waitForHydration`, only nodes React has already hydrated count |
| `itemLink`, `menuTrigger` | Ordered fallback via `trySelector`; first match inside the item wins. `findItemLink` also accepts the item itself (DeepSeek rows are the `<a>`) |
| `getItemId` | Optional; identifies rows that have no href (Grok uses `getReactKeyId`). Rows it cannot identify get no checkbox |
| `item` | Joined with `", "` into one `querySelectorAll`, so every selector contributes (union) |
| `deleteMenuItem`, `confirmButton` | Union of `selectors`, then filtered by `textMatch` against text **and** attributes (`aria-label`, `data-testid`, `data-test-id`, `value`, `leadingicon`, ...). Without `textMatch`, the first candidate is accepted, so the selectors alone must be unambiguous |

UI language varies per account, so prefer language-independent matches: attributes such as `data-testid`, styling classes that mark the destructive action (ChatGPT's `text-danger` menu item, DeepSeek's `ds-*--error`), icons (Grok's `use[href*="-archive"]`), `type="submit"`, or DOM position. `confirmButton.strategy` adds position strategies tried before the selectors: `last-dialog-button` (last enabled `<button>` in the topmost visible dialog; Claude and Gemini chats), `first-dialog-button` (Grok, whose Cancel is last) and `dialog-confirm-button` (`confirm-button` test id; Gemini Notebooks). They only see real `<button>` elements; DeepSeek's dialog buttons are `div[role=button]`, so it uses plain selectors.

Site-specific facts that are easy to break:

- ChatGPT renders a 52 px app rail (`nav.group/sidebar-rail`) before the history nav; the rail must never be chosen as the sidebar. The history nav (`aria-label="Home"`) is server-rendered and visible about a second before React hydrates it; inserting the toolbar in that window freezes the tab for good. `waitForHydration` makes `findVisibleSidebar` skip candidates without a `__reactFiber$` expando. Its delete dialog has a pre-checked "also delete files" checkbox that the script leaves alone.
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
- The batch result is only logged to the console; upstream's final `alert()` was removed, so drop it again when merging upstream changes. The `confirm()` before deleting stays.
- The body-wide observer is debounced by 100 ms. `injectingToolbar` prevents concurrent injections while `injectToolbar` awaits anchors.

## linuxdo-double-column.user.js

Original script (not a third-party copy). Opens linux.do topics from topic lists, search results and the notification menu/page in a right-hand preview panel rendered from Discourse JSON APIs, with original and tree views, replies, likes, bookmarks with folders, polls, timeline and read-time reporting. Moved from `ppanphper/linuxdo-double-column` at 0.19.1; the old repo is archived and its history stays there. User-facing features: `docs/linuxdo-double-column.md`; design notes (Chinese): `docs/linuxdo-double-column-design.md`.

- `@grant none`, `@run-at document-start`; it runs in the page and reuses Discourse's own `MessageBus` and renderer when available. All requests go through same-origin `fetch` with the page cookies; never override `User-Agent` (Cloudflare).
- Bookmark folders follow the same `[folder] note` contract as `linuxdo-favorites-sync.user.js` (see below): folder list from `localStorage['linuxdo-bookmark-folders']`, and `linuxdo-bookmarks-changed` is dispatched after every bookmark write.
- Verification: `node --check linuxdo-double-column.user.js`, then serve the repo root on 8765 and open each page in `tests/linuxdo-double-column/` (tree, search, notification, bookmark folders). Each injects a test API before the startup block and mocks every API locally; run them as fresh top-level pages, since re-running in place or inside an iframe can time out.

## linuxdo-favorites-sync.user.js

Folder-based favorites for linux.do, stored as the account's Discourse bookmarks so they follow the account. Based on eamooooon's ScriptCat script 6125, version 1.0.9 (no license declared); the unmodified import is `git log --diff-filter=A -- linuxdo-favorites-sync.user.js`. It keeps the upstream `@name`/`@namespace`, so installing replaces the original in place (ScriptCat and Tampermonkey match by name + namespace) and keeps its GM storage. Console output is prefixed with `[LinuxDo 收藏夹]`.

### Data model

| Data | Where | Notes |
|---|---|---|
| Favorites | Discourse bookmarks (source of truth) + GM cache `linux_do_bookmark_favorites` | The cache is only for instant rendering; every pull replaces it from the server |
| Folder of a favorite | Bookmark `name`: `[folder] note` | Default folder `默认收藏` has no prefix. Names that don't parse are kept whole as the note |
| Folder order, empty folders | GM `linux_do_folders` | Local only; folders found in bookmark names are appended on pull |
| Pending writes | GM `linux_do_bookmark_pending_ops` | Coalesced per favorite id: `{ type: 'upsert' \| 'delete', bookmarkId, seq }` |
| Sync state | GM `linux_do_bookmark_sync_meta` | Account, last pull, daily-limit unblock time, last error, legacy-import flag |

Favorite ids match the upstream button lookups: post bookmark → `${topic_id}_${post_id}`, topic bookmark → `${topic_id}_${topic_id}`. Folder names are at most 30 chars without `[ ] < > " &`; bookmark names at most 100 chars.

### Sync flow

The upstream UI code still does read → mutate → `saveFavorites(all)`. `saveFavorites` diffs against the cache, writes the cache and queues `upsert` (new or folder changed) / `delete` ops, pushed 300 ms later. Pull and push run serially on one promise chain (`runSyncTask`):

- Pull: `/session/current.json` (account switch clears cache and queue) → `/u/{username}/bookmarks.json?page=N` (20 per page, `{bookmarks: []}` after the last page) → convert → overlay pending ops → write cache. Triggered at startup (older than 10 min), on panel open (older than 2 min), on the bookmarks page, by 立即同步 and by `linuxdo-bookmarks-changed`.
- Push: ops in `seq` order, 250 ms apart. `upsert` PUTs the name when a bookmark id exists (sends back `reminder_at`; Discourse clears `pinned` on update, so pinned bookmarks get `toggle_pin`), otherwise POSTs; a 400 means it already exists, so it is adopted from `/t/{id}.json` `bookmarks`. `delete` treats 404 as done. An op whose `seq` changed while in flight stays for the next round.
- Errors: 429 waiting more than 2 min is the daily create limit (`max_bookmarks_per_day`, default 20), which blocks only creates until `createBlockedUntil`. Network errors, 5xx and 403 retry after 60 s. Other 4xx drop the op and re-pull.
- Imports (JSON backup, and the upstream `linux_do_favorites` key on first run) only merge: matching bookmarks get the folder, missing ones are created, nothing is deleted. A first-floor post favorite and a topic bookmark count as the same item.

### Shared with linuxdo-double-column

- `saveFolders` also writes the folder list to page `localStorage['linuxdo-bookmark-folders']` for the double-column folder menu.
- The double-column script dispatches `linuxdo-bookmarks-changed` on `document` after changing bookmarks; this script pulls 800 ms later (again after an in-flight pull). It never dispatches the event itself.
- The `[folder] note` parse/compose rules must stay identical in both scripts.

### Verification

- `python3 -m http.server 8765 --bind 127.0.0.1`, then open `tests/linuxdo-favorites-sync/index.html?case=main`, `case=legacy`, `case=switch` and `case=original`; each shows PASS. The page runs the real script against a mock Discourse bookmark API that mimics the behaviors above, without contacting linux.do.
- linux.do's CSP (`upgrade-insecure-requests`, nonce-only scripts) blocks loading the script from localhost. Verify API assumptions with small same-origin `fetch` calls in a logged-in tab, on a temporary bookmark that the test creates and deletes.
- The UI keeps upstream's ids (`ld-fav-*`); when the original is still running, `init` shows a toast and stops instead of fighting over the same elements.
