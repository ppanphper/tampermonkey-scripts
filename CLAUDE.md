# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository

A collection of Tampermonkey userscripts, most of them modified copies of third-party scripts. Users install each script from its raw GitHub URL, and every computer auto-updates from `main`. There is no build step, package manager or dependency.

Each script has its own directory, and everything that belongs to one script stays in it:

| Directory | Contents |
|---|---|
| `bulk-chat-deleter/` | Script, `CLAUDE.md` |
| `linuxdo-double-column/` | Script, `CLAUDE.md`, user docs (`README.md`), design notes (`design.md`), mock test pages (`tests/`) |
| `linuxdo-favorites-sync/` | Script, `CLAUDE.md`, mock test page (`tests/`) |
| `netdisk-direct-download-helper/` | Script |

`<name>/CLAUDE.md` holds the script's architecture and verification steps; read it before changing that script. Paths in those files are relative to the repo root, and commands run from the root. A change to one script touches only its directory and its section in the root `README.md`. The two linux.do scripts share a bookmark contract, defined in `linuxdo-favorites-sync/CLAUDE.md`.

Conventions every script follows:

- One self-contained `<name>/<name>.user.js` per script. The `.user.js` suffix makes Tampermonkey open its install page when the raw URL is visited.
- `@updateURL` and `@downloadURL` both point to `https://raw.githubusercontent.com/ppanphper/tampermonkey-scripts/main/<name>/<name>.user.js`. Existing installs only check the URL they were installed from, so moving or renaming a script breaks their auto-update until it is reinstalled from the new URL.
- Tampermonkey only updates when `@version` increases, so bump it in every change that reaches `main`. raw.githubusercontent.com caches responses for 5 minutes.
- Keep `@name` and `@namespace` from the upstream script; userscript managers use them to recognize an existing install. Keep the original author and license in `@author`/`@license`, and note the modification (`原作者 / ppanphper 修改`).
- Each script has a section in `README.md` (Chinese) with its install URL and a one-line description. Update it when platforms or features change.

## Verification

- Syntax check: `node --check <name>/<name>.user.js`
- Behavior can only be verified in a logged-in browser on the target site, or on the local mock pages under `<name>/tests/`. Each `<name>/CLAUDE.md` describes how.
- Scripts that delete data must be tested on throwaway items created for the test. Override `window.confirm`/`window.alert` before triggering them when driving the page through browser automation, because native dialogs block it.
