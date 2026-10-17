# Superset Remix branding inventory

Implementation target: the accountless desktop entry in `apps/desktop/src/main/index.ts` and `src/renderer/index.tsx`, the fork repository, and the macOS SSH preview distribution. Superset Remix is the working product name, centralized for later changes. The user's 2026-10-13 instruction supersedes old-data compatibility: use fresh independent profiles, without automatic migration. Remote service/protocol contracts remain compatible.

## Reachability and distribution

| Surface | Fork status | Handling |
| --- | --- | --- |
| Desktop Workstation, title, sidebar, failure UI, About | Current product | Shared name and SVG geometry; ordinary About entry; offline original license and modification notice; fixed-ID external links through the existing trusted IPC caller check. Fork disclosure is documented on GitHub; the user requested removing the persistent unofficial-version badge. |
| Preview macOS DMG, bundle, executable, icons, permissions | Current distribution | Own `.preview` bundle ID, new artifact stem, same unified desktop/CLI/backend version; both backend targets and pinned verification keys retained outside ASAR. Native acceptance required before artifact upload. |
| Data / single-instance identity | Current product | `superset-remix` installed profile; hashed independent development profiles; both selected before database setup and lock. No earlier profile scan, migration, deletion or reuse. |
| README and all 16 translated READMEs | Current repository | Truthful fork downloads and scope; original authors/license; old marketing screenshots and cloud/mobile promises removed. |
| GitHub About / topics / social preview | Release-preparation settings, unchanged | Source commit/push does not change repository settings or its default branch. Maintainers must set an unofficial fork description, real fork link and new artwork before public release; do not claim this was applied. |
| Development, contribution, security, issue / PR templates | Current repository | Fork destinations; no invented private security channel, email address or support SLA. |
| Legacy desktop cloud routes and sidebar, tray, updater | Inactive source, account-only cleanup permitted | Not imported by current Workstation entry. The user authorized deleting redundant Superset account/cloud code on 2026-10-15; retain or extract shared feature implementations before removing their wrappers. Shared logo/menu identity updated where convenient; upstream services remain upstream. Legacy updater is inactive; any future activation requires fork-feed acceptance. Current builders default to manual updates. |
| Dev protocol patch / Launch Services cleanup | Retained inactive tooling | Removed from current predev chain. The Workstation has no deep-link handler; builders register no URL schemes. Do not activate these helpers without a separate protocol review. |
| Stable / Canary workflows | Not used for this fork preview | Retained workflow infrastructure; production credentials are not configured. Do not claim stable, notarized or automatic updates. Canary artwork is derived, but its release chain is not validated for this fork. |
| Linux / Windows desktop installers | Not distributed or validated | Identity fields and assets are prepared; source UI checks on Linux do not validate an installer or platform support. |
| Web (`apps/web`) | Not published | Upstream app titles, favicon and hosted links retained. Requires its own deployment and branding review before use. |
| Marketing (`apps/marketing`) | Upstream materials, not published | Existing SEO/canonical, images, screenshots and hosted/mobile claims remain upstream evidence; not reused as fork advertising. |
| Docs (`apps/docs`) | Upstream materials, not published | Original docs branding, MCP identity, indexes and source links retained. About labels links as upstream documentation. |
| Admin (`apps/admin`) | Not deployed | Original internal dashboard source; no fork operating claims. |
| API (`apps/api`) | Not deployed | OAuth issuers, clients and real endpoints remain upstream; no invented fork infrastructure. |
| Mobile (`apps/mobile`) | Not published | No fork EAS/OTA/team/App Group/Apple identity configured. Original mobile assets and app identity retained; no fork App Store link. |
| Discord triage | Not deployed | Original bot and community identity retained. No external messages sent. |
| Email (`packages/email`) | Not sent by this fork | Original sender, address, template logos and unsubscribe identity retained; no invented maintainer address. |
| CLI | Bundled technical component | Version unified; executable `superset`, command syntax and internal package name remain stable. Hosted CLI functions belong to upstream; not a new fork cloud deployment. |
| SDK / MCP / agent setup | Retained upstream modules; backend dependencies as needed | Keep public package names, generated tools, hook protocol and provisioning contracts; original service descriptions are not fork product promises. |
| Plugins / marketplace / third-party logos | Original integrations | Preserve vendor names, authors, manifests and generated catalogs; no implicit publishing or re-signing. |
| License / authors / history / old SSH preview evidence | Original records | Root license unchanged; generated package copy byte-identical. Historical tags, filenames, reports, checksums and screenshots retain their actual old identity. |

## Source-hit inventory

[branding-audit.csv](branding-audit.csv) records each matching file, baseline/current matching-line counts, classification counts, action and rationale. The initial scan was case-insensitive for `Superset` (covering `superset.sh`, `@superset/*`, schemes and bundle names); the current scan includes the tracked implementation files. It excludes binary contents and the audit output itself, not application directories. Counts are matching lines, not individual tokens. Files with removed hits remain represented through the baseline inventory. Categories are per line; mixed-purpose files list multiple categories.

Technical names are deliberately preserved. This includes `@superset/*`, CLI `superset`, `SUPERSET_*`, local/remote compatibility contracts, `.superset-direct`, installed service IDs and generated plugin data. A remaining string does not imply a published fork surface. The table above records whether it is reachable or distributed. Re-enabling an inactive surface requires reviewing its actual UI, domains, package resources and credentials.

## Assets and evidence

Canonical artwork masters, exports and generation instructions are in [assets/branding](../../assets/branding/README.md). Provider and integration assets are unchanged. All 17 supported locales have the new notice/About/menu copy; the product name stays untranslated. Root legal terms and upstream author metadata remain original.

The equivalent baseline is the actual old 1.37.3 preview inspected in [native run 38341584803](https://github.com/4444zyf/superset/actions/runs/38341584803), including its original Workstation screenshot. The old source is historical evidence; it is not an upgrade fixture under the fresh-data policy.

`verify-brand-ui.mjs` drives the real packaged Electron renderer with CDP. It checks source path and package identity, fresh user/session data paths, actual version/title, minimum-window About/name layout, real navigation and About clicks, byte-identical offline license, scroll, Escape close, single-instance behavior and app reopen. It captures seven screenshots plus numeric observations. Source-mode Linux execution is explicitly marked separately and never substitutes for native DMG acceptance. The native SSH installation checks remain mandatory before and after packaging.

Both final native DMGs passed in [run 38347760341](https://github.com/4444zyf/superset/actions/runs/38347760341), source `2f71640cedd4155781dbb9e87a4baaaf6c956a87`. Packaged screenshots/measurements were downloaded and inspected for both architectures. Validation results and source/download links are recorded in [implementation notes](../implementation/fork-branding-2026-10-13.md). A surface marked unpublished above is not represented as a completed fork deployment.


## App icon redesign (2026-10-13)

The app icon now uses a white and blue-violet folded S on a dark rounded-square tile. The same silhouette supplies the monochrome application and menu-bar marks. Canonical image-generation masters are retained in `assets/branding`; the existing pinned generator exports all PNG sizes, ICNS/ICO containers, channel variants, wordmarks and renderer mask metadata. No provider or agent logos change.

The 29 generated resources passed byte-for-byte checks. PNG proofs and the tray template have transparent corners. Actual source-renderer screenshots confirmed the new sidebar/About mark, minimum-size layout, license access, quit/reopen and single-instance behavior. Native packaged macOS verification is recorded independently with its frozen source SHA, rather than treating this source render as DMG proof.

The redesigned icon passed actual packaged acceptance on both Mac architectures in [run 38406074334](https://github.com/4444zyf/superset/actions/runs/38406074334), frozen source `5f57715ff03a6cb984c04cde0243d297872654ff`. Native sidebar/About screenshots were downloaded and inspected. The final download links and workspace screenshots are in the root README; exact performance and lifecycle results remain in the implementation reports.

## Flat icon revision (2026-10-17)

The user requested a flat icon closer to upstream. The current source replaces the folded S with the original four stepped code chevrons, warm-black background, off-white outer pair and light-lavender inner pair. Canonical SVG masters now feed the existing generator for the desktop, tray, sidebar, About and installers; PNG masters are derived outputs. The concept was generated from the upstream preset icon, then implemented as exact flat vector geometry. Earlier native results above verify the historical artwork only. Actual window and macOS packaging validation of this revision are recorded separately and must not be inferred from those historical checks.
