# Stage 78 evidence

Final product source: `ac73718ab60ccbdea3b3f64ed5f6d95b761ece68`. Earlier product commits and their manifests are retained separately: e5b5d8c5f (initial integration), f1df2d1da (reload title), ccc632143 (canonical page/favicon origins).

The final native browser, clipboard and wheel journeys passed for both local and owned loopback SSH workstations. Each of the three SSH journeys includes 20 window restores. These are source-only Electron builds; CLI SHA remains `f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb`.

- `verified-local-ac7371` and `verified-ssh-ac7371`: real toolbar input, guest link clicks, back/forward/reload, native find-in-page, window.open split, selective close and normal window reopen. SVG favicon URI persistence and original remote origins are checked. Original terminal PID/execution/cwd survive. Read-only guest JS inspects content and pointer geometry; user actions go through CDP input.
- `terminal-regression-final`: native text/image/file clipboard, Chinese/emoji keyboard and menu copy, bracketed paste, focus and OSC52 after remount. `vendorAgentVerified` is false.
- `wheel-modes-final`: scrollback, non-mouse TUI review without injected arrows, saved stock preference, SGR and RIS legacy/pixel mode transitions, raw legacy bytes.
- `tests-final-product.log.gz`: 93 tests, 3276 assertions, 12 files. The final desktop type check is `types-favicon-retention.log.gz`; an empty log means success. I18n, format and plugin checks have their own logs.
- `product-snapshot.json` and `post-native-integrity.json`: all 2205 main/preload/renderer files match after all six native journeys. No product rebuild occurred during a journey.

Failure records remain failures:

- `baseline-28e394`: expected missing Browser entry on the previous compiled product.
- `verified-local-e5b5d8`: verifier omitted the Enter character event, leaving the address form unsubmitted.
- `verified-local-enter-e5b5d8` and `diagnostic-title-e5b5d8`: real navigation worked, but reload lost a title when Chromium omitted a repeated title event. `reload-title-red.log.gz` records the regression before the Core fix.
- `verified-local-f1df2d`: the original complete local UI pass, before adding the SVG check.
- `verified-ssh-f1df2d`: the original port scanner had not attributed the newly started server yet. The fixture now waits for the original `listPorts` readiness condition before navigation. Ownership checks and navigation timeouts were not relaxed.
- `verified-local-ccc632` and `diagnostic-favicon-ccc632`: favicon candidate arrived once, and the old Core cleared it on later same-origin navigation. `favicon-retention-red.log.gz` records this before the final fix.
- `page-writer-backpressure-red.log.gz`: a busy writer queued intermediate batches before the single-drain fix.

Favicon tests cover URI persistence and origin conversion. The current renderer CSP still limits external favicon image display; this stage does not claim those pixels render. Browser settings/import, complete link preferences, device/design/devtools UI and the CLI bridge are still pending. Physical macOS input, external SSH machines and authenticated vendor-agent TUIs were not exercised.

The final SSH browser, keyboard-copy and pixel-wheel screenshots were inspected, as were the earlier f1 local reopen and selected failure screenshots. Other images are captures only. `rendererExceptions` refers to the verifier's recorded runtime exceptions, not an audit of all Chromium diagnostic messages.

Only reports, logs, screenshots and runner scripts are retained. Profile/config directories, databases, private keys and backend credentials are excluded. Logs are gzip-compressed. `SHA256SUMS` covers every retained file except itself. Owned Xorg/Electron/backend fixtures have explicit cleanup reports. No installers, CLI rebuild, sealed backend release archives or GitHub Actions were used.
