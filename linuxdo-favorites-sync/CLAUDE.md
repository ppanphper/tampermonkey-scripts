# linuxdo-favorites-sync.user.js

Folder-based favorites for linux.do, stored as the account's Discourse bookmarks so they follow the account. Based on eamooooon's ScriptCat script 6125, version 1.0.9 (no license declared); the unmodified import is `2645f86`, at the old root path `linuxdo-favorites-sync.user.js`. It keeps the upstream `@name`/`@namespace`, so installing replaces the original in place (ScriptCat and Tampermonkey match by name + namespace) and keeps its GM storage. Console output is prefixed with `[LinuxDo 收藏夹]`.

## Data model

| Data | Where | Notes |
|---|---|---|
| Favorites | Discourse bookmarks (source of truth) + GM cache `linux_do_bookmark_favorites` | The cache is only for instant rendering; every pull replaces it from the server |
| Folder of a favorite | Bookmark `name`: `[folder] note` | Default folder `默认收藏` has no prefix. Names that don't parse are kept whole as the note |
| Folder order, empty folders | GM `linux_do_folders` | Local only; folders found in bookmark names are appended on pull |
| Pending writes | GM `linux_do_bookmark_pending_ops` | Coalesced per favorite id: `{ type: 'upsert' \| 'delete', bookmarkId, seq }` |
| Sync state | GM `linux_do_bookmark_sync_meta` | Account, last pull, daily-limit unblock time, last error, legacy-import flag |

Favorite ids match the upstream button lookups: post bookmark → `${topic_id}_${post_id}`, topic bookmark → `${topic_id}_${topic_id}`. Folder names are at most 30 chars without `[ ] < > " &`; bookmark names at most 100 chars.

## Sync flow

The upstream UI code still does read → mutate → `saveFavorites(all)`. `saveFavorites` diffs against the cache, writes the cache and queues `upsert` (new or folder changed) / `delete` ops, pushed 300 ms later. Pull and push run serially on one promise chain (`runSyncTask`):

- Pull: `/session/current.json` (account switch clears cache and queue) → `/u/{username}/bookmarks.json?page=N` (20 per page, `{bookmarks: []}` after the last page) → convert → overlay pending ops → write cache. Triggered at startup (older than 10 min), on panel open (older than 2 min), on the bookmarks page, by 立即同步 and by `linuxdo-bookmarks-changed`.
- Push: ops in `seq` order, 250 ms apart. `upsert` PUTs the name when a bookmark id exists (sends back `reminder_at`; Discourse clears `pinned` on update, so pinned bookmarks get `toggle_pin`), otherwise POSTs; a 400 means it already exists, so it is adopted from `/t/{id}.json` `bookmarks`. `delete` treats 404 as done. An op whose `seq` changed while in flight stays for the next round.
- Errors: 429 waiting more than 2 min is the daily create limit (`max_bookmarks_per_day`, default 20), which blocks only creates until `createBlockedUntil`. Discourse counts every create against that limit before checking the post, so a create that fails still uses a slot. Network errors, 5xx and 403 retry after 60 s, except a 403 with `error_type: invalid_access` (post or topic deleted, or not visible), which never succeeds and is dropped like other 4xx. Only a `["BAD CSRF"]` 403 is resent at once with a fresh token. Other 4xx drop the op and re-pull.
- Imports (JSON backup, and the upstream `linux_do_favorites` key on first run) only merge: matching bookmarks get the folder, missing ones are created, nothing is deleted. A first-floor post favorite and a topic bookmark count as the same item.

## Shared with linuxdo-double-column

`linuxdo-double-column/linuxdo-double-column.user.js` reads and writes the same bookmarks:

- `saveFolders` also writes the folder list to page `localStorage['linuxdo-bookmark-folders']` for the double-column folder menu.
- The double-column script dispatches `linuxdo-bookmarks-changed` on `document` after changing bookmarks; this script pulls 800 ms later (again after an in-flight pull). It never dispatches the event itself.
- The `[folder] note` parse/compose rules must stay identical in both scripts.

## Verification

- `python3 -m http.server 8765 --bind 127.0.0.1`, then open `linuxdo-favorites-sync/tests/index.html?case=main`, `case=legacy`, `case=deleted`, `case=switch` and `case=original`; each shows PASS. The page runs the real script against a mock Discourse bookmark API that mimics the behaviors above, without contacting linux.do.
- linux.do's CSP (`upgrade-insecure-requests`, nonce-only scripts) blocks loading the script from localhost. Verify API assumptions with small same-origin `fetch` calls in a logged-in tab, on a temporary bookmark that the test creates and deletes.
- The UI keeps upstream's ids (`ld-fav-*`); when the original is still running, `init` shows a toast and stops instead of fighting over the same elements.
