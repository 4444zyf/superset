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

Profile/link/preview-config tests passed (4 tests, 25 assertions), renderer safety checks passed (4 tests), and existing Workstation/machine-management suites passed (15 tests). Desktop/shared types, source compilation, 17 strict translation catalogs, unified versions, generated artwork comparison, scoped Biome, shell syntax and workflow lint were checked.

Native verification of the new branded DMGs is pending at this source checkpoint. Final run/source/results will be recorded after both architectures finish. Package upload is gated on full native checks, including actual packaged UI screenshots, independent data paths, offline legal text and fresh OpenSSH/SFTP installation/reconnect.

The equivalent original UI baseline is [old-preview native run 38341584803](https://github.com/4444zyf/superset/actions/runs/38341584803). Its measured product/version/profile and screenshot retain historical 1.37.3 identity. No old-profile upgrade acceptance is required under the fresh-data instruction.

## Boundaries

Developer ID/notarization, private security reporting, stable/canary distribution, Linux/Windows installers, hosted websites, mobile and email deployments are not configured or validated by this change. No external services, DNS, subscriptions, old user directories, old app installations or historical releases were changed. Physical-user Mac lifecycle and model-authentication limits in the [SSH record](ssh-direct-completion-2026-10-12.md) remain applicable.
