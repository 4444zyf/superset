# Stage 84 evidence

Product source: `b47ca35e4a705c7b5e6e692b1947e67204049fa1`.

The original ClearBrowsingDataDialog now wraps the shared ClearBrowsingDataDialogView with its original TRPC callbacks. Workstation supplies its existing private SQLite history clear and an optional private clearData action for cookies/cache. The new action uses the existing main-frame owner guard, validates a strict two-category input, and delegates to the original session operation extracted into clearBrowserSessionData. This acts on the desktop embedded-browser session for the current application profile, including when the pane is reached from an SSH workspace.

`extraction-proof.json` compares the original dialog JSX, clear handler after explicit data-source call normalization, original session switch/response, and released input schema. They match. Every other browser-router property and existing main action is unchanged. The released cookies/cache/storage/all input and success response remain intact. The private action exposes only the dialog's cookies/cache operations. The original cookies branch clears cookies; it does not newly expand into localStorage/IndexedDB deletion. No backend minimum version, migration or persistence key changes.

The original three tasks still settle independently and report exact partial outcomes. Workstation now mounts the existing shared Sonner Toaster using its actual preference theme; previously its root had only the separate Alerter. The dialog callback is guarded by runtime identity so a late close does not close a different pane's dialog.

74 tests/3301 assertions/14 files, full desktop types, all 17 strict locale catalogs, plugin checks, relevant formatting and native syntax pass. The session helper test first fails as missing, then verifies that cache clearing preserves login/local storage and a storage failure propagates before cache clearing. View tests preserve the independent partial-failure message, selective cache-only execution and disabled action with no selection. An early test import used sonner as a direct desktop dependency; it now obtains the same external toast object through the existing UI export. Partial storage failures are covered by these controlled tests; an actual OS storage failure was not induced in native runs.

`baseline-e9696` is the unchanged stage-83 compiled product, with all 2205 files checked before and afterward. Its actual owned HTTP page establishes a cookie and real cache; two fetches generate one HTTP request. It then fails on the absent Clear browsing data menu item. New private capability is absent as expected.

`verified-local-b47ca` and `verified-ssh-b47ca` pass the same real UI journey. Setup uses a fresh owned profile, a cookie written by the owned page and a cacheable resource containing the current HTTP marker. Real menu and checkbox clicks verify:

- Cancel preserves cookie, history and cache.
- The private all input is rejected without mutation (a negative protocol diagnostic, distinct from UI proof).
- History-only clear empties actual SQLite, retaining cookie/cache; real Reload creates a new visit.
- Cookies-only clear removes the owned cookie, retaining history and cached response.
- Cache-only clear retains cookie/history and makes the next real fetch increase the server count from one to two.
- With nothing selected, Clear data is disabled.

Original success feedback is visible in the real window. Both suites also pass canonical URL in the OS clipboard, actual 100→110→100% page zoom, hard HTTP reload, detached DevTools containing this exact owned marker, Browser settings, original navigation/find/window.open/selective close and normal reopen. Original PID/execution/cwd remain; the SSH suite includes 20 preceding restores. Exact counters, preserved-category results, process identity and owned cleanup are in native-summary.json.

The product and seven frozen fixture files remain unchanged during native verification. The build exits zero before snapshot and launch. All 2205 compiled files and all seven fixtures match afterward. Manifest SHA256: `563dde07760bc2d330a4e34c57e02ebf992ec9d0685c717d2d1b2ba56fa44a4c`; CLI SHA remains `f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb`.

Inspected images include local history-only selection, local cache success with visible toasts, SSH cookies-only selection and SSH cache success with visible toasts. Other screenshots are captures. Runtime-exception arrays are empty; this does not assert warning-free Chromium or suppress the intentional invalid-input diagnostic. Owned app/Xorg exit zero. Profiles, databases and keys are excluded. Logs are gzip-compressed; SHA256SUMS covers every retained file except itself. No Actions, installer, CLI rebuild or sealed backend release archive was used.

Terminal wheel/clipboard evidence remains stage 80 ca791; terminal code was unchanged here. Authenticated vendor agents, external SSH and physical Mac input remain untested. Browser import/remaining settings, design/other tools, full history/tab icons, right pane, chat/task URL policy, CLI bridge and other parity groups continue next. The overall goal remains active.
