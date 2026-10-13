# Superset Remix branding implementation — 2026-10-13

This change implements the [branding design](../design/fork-branding.md) for the current accountless Workstation, fork repository and macOS preview chain. Superset Remix is the working name, centralized in the shared product-brand JSON. The user explicitly requested fresh data: installed and per-workspace development profiles are independent, selected before the single-instance lock, and do not automatically use old preview data. Existing remote backend contracts and original attribution remain unchanged.

## Implemented

- One name and SVG-derived artwork for sidebar, application, Dev/Canary, tray and DMG resources. Genuine multi-resolution ICNS/ICO exports, editable sources and generation instructions are included.
- Visible unofficial notice, real version/source metadata, fixed fork/upstream links, offline full original license and modification notice. Link IPC accepts enumerated IDs only; existing caller checks and CSP remain in place.
- Fork bundle/package/artifact identity, permissions and manual-update defaults. Unified desktop/CLI/host-service version 1.37.4. Complete signed backend resources, pinned keys and native SSH acceptance retained.
- All 17 translation catalogs, all 16 localized READMEs, root README, contribution/build/security documents and issue templates. No fake hosted/mobile service, private contact, production signature or support SLA.
- [Per-file source inventory](../design/branding-audit.csv) and [surface register](../design/branding-audit.md). Unpublished upstream surfaces remain recorded rather than marked as shipped.

## Local verification

Source-built Electron 41.10.7 from `/workspace/superset/apps/desktop` ran under an ordinary OS user with an isolated empty test home/configuration and an owned Xorg display. CDP matched `file:///workspace/superset/apps/desktop/dist/renderer/index.html`; no hosted account or old data was seeded.

`verify-brand-ui.mjs --source-test` passed real navigation, About clicks, complete license text equality, scrolling, Escape close, minimum 800×600 window, duplicate-instance focus and app quit/reopen. Seven real screenshots and numeric observations were captured. At minimum size the renderer was 800×574 (the native menu occupies the remaining height); the notice stayed visible and the single-line name fit. Inspection found and corrected double centering of About and narrow-sidebar name overflow. Selected source-mode evidence: [observations](evidence/fork-branding/brand-ui.json), [Workstation](evidence/fork-branding/workstation.png), [About](evidence/fork-branding/about.png), [minimum window](evidence/fork-branding/minimum-window.png). Source UI checks are not Mac installer acceptance.

Profile/link/preview-config tests passed (4 tests, 25 assertions), renderer safety checks passed (4 tests), the real compiled-Lingui root-failure fixture passed (1 test), and existing Workstation/machine-management suites passed (15 tests). Desktop/shared types, source compilation, 17 strict translation catalogs, unified versions, generated artwork comparison, scoped Biome, shell syntax and workflow lint were checked.

Both native Mac jobs in [run 38347760341](https://github.com/4444zyf/superset/actions/runs/38347760341) passed, and the workflow finished successfully. Verified package source is `2f71640cedd4155781dbb9e87a4baaaf6c956a87`. Final follow-up commits change repository documentation/evidence only; they do not change the shipped desktop, backend or resources. Publication was disabled, and the prerelease publication job was skipped.

Verified downloads (GitHub workflow artifacts, retained for 14 days): [Apple Silicon](https://github.com/4444zyf/superset/actions/runs/38347760341/artifacts/11790341140), [Intel](https://github.com/4444zyf/superset/actions/runs/38347760341/artifacts/11790638650). Each archive contains its DMG, checksum/source records, SSH acceptance records, UI evidence ZIP and the original license/fork notice.

The equivalent original UI baseline is [old-preview native run 38341584803](https://github.com/4444zyf/superset/actions/runs/38341584803). Its measured product/version/profile and screenshot retain historical 1.37.3 identity. No old-profile upgrade acceptance is required under the fresh-data instruction.

## Boundaries

Developer ID/notarization, private security reporting, stable/canary distribution, Linux/Windows installers, hosted websites, mobile and email deployments are not configured or validated by this change. No external services, DNS, subscriptions, old user directories, old app installations or historical releases were changed. Physical-user Mac lifecycle and model-authentication limits in the [SSH record](ssh-direct-completion-2026-10-12.md) remain applicable.

## Native final acceptance

The arm64 DMG in [run 38347760341](https://github.com/4444zyf/superset/actions/runs/38347760341), source `2f71640cedd4155781dbb9e87a4baaaf6c956a87`, passed its complete native job. Both before packaging and inside the mounted DMG, real OpenSSH/SFTP uploaded 6,230 files in one batch, installed once with sudo, started launchd, authenticated RPC, and reused the same backend after disconnect/reconnect and a reopened manager. Package checks passed brand/identity, unchanged license, fork notice, SQLite and PTY (Electron ABI 145).

Packaged UI acceptance passed a fresh `/Users/runner/Library/Application Support/superset-remix` profile, one-instance enforcement, close/reopen, offline license equality and seven actual screenshots. Selected [native observations](evidence/fork-branding/native-arm64/brand-ui.json), [Workstation](evidence/fork-branding/native-arm64/workstation.png) and [About at minimum width](evidence/fork-branding/native-arm64/about-minimum-window.png) were downloaded and visually inspected. At 800×600, the notice remained within the viewport (top 527, bottom 582); name width 97.3125 covered its 97-pixel text; license scroll reached 1000.

The first native attempt exposed a verifier path comparison problem: the mount argument used `/var/folders/...`, while Electron reported `/private/var/folders/...`. The corrected verifier checks canonical filesystem identity for both main process and renderer, preserving the strict application/source checks. This was confirmed by the actual recorded paths. The failed/superseded run did not upload a verified installer.

Intel passed the same complete checks, including two real 6,230-file SFTP/install runs (prepackage and mounted final DMG), launchd, authenticated RPC, reconnect and a reopened manager with one installation/batch per run. SQLite/PTY and original license/fork notice checks passed under packaged Electron 41.10.7 / ABI 145. Seven packaged screenshots, fresh profile, duplicate-instance enforcement and reopen passed. Selected [Intel observations](evidence/fork-branding/native-x64/brand-ui.json), [Workstation](evidence/fork-branding/native-x64/workstation.png) and [minimum-width About](evidence/fork-branding/native-x64/about-minimum-window.png) were downloaded and visually inspected. Its 800×600 layout and license scroll measurements matched arm64.

Independent complete UI evidence archives: [arm64](https://github.com/4444zyf/superset/actions/runs/38347760341/artifacts/11790810475), [x64](https://github.com/4444zyf/superset/actions/runs/38347760341/artifacts/11790937051). The screenshots and JSON came from the actual mounted apps, not staged HTML, assigned DOM state, or a different checkout.
