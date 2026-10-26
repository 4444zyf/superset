# Superset Remix branding inventory

Implementation target: the accountless desktop entry in `apps/desktop/src/main/index.ts` and `src/renderer/index.tsx`, the fork repository, and the macOS SSH preview distribution. Superset Remix is the adopted product name, centralized for later changes. The user's 2026-10-13 instruction supersedes old-data compatibility: use fresh independent profiles, without automatic migration. Remote service/protocol contracts remain compatible.

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


The 31 generated outputs passed byte-for-byte checks, and 16/32/128/1024 PNGs plus the tray template have transparent outer corners. Actual Linux source-window run 86, frozen at `ecfa7b7377dbe95be9d17eb162a06dbe5ebc1978`, passed; the new sidebar/About marks were visually inspected along with clipboard, minimum-window and reopen checks. See the [raw evidence](../implementation/evidence/local-ssh-feature-parity/source-linux-chat-clipboard/86). This revision has no new native macOS package acceptance.

## Repository naming and independence proposal (2026-10-26)

The user asked about a later repository rename to Superset Remix and compliance while presenting an independent project. This is a naming proposal, not a completed remote rename or a legal clearance. The current product name/data profile already use Superset Remix / `superset-remix`; the remote repository remains `4444zyf/superset`.

- `superset-remix` is the proposed GitHub slug if the current working product name is retained. It still uses the Superset name; ELv2 does not grant additional trademark rights. A distinct original primary name and original artwork, with a factual “based on Superset” attribution, would make independent maintenance clearer and reduce confusion. Name/trademark availability needs a separate check before publication.
- Preserve the original ELv2 terms, Superset copyright, third-party notices and upstream history. Include a prominent modification notice with redistributed source and binaries. Independent maintenance does not change the license on the inherited work; do not present the whole fork as newly MIT-licensed or wholly original.
- Preserve license-key functionality and features protected by it. Account/service separation must be reviewed separately from licensing or subscription enforcement. Do not offer the restricted hosted/managed service described in ELv2. These are conditions from `LICENSE.md`, not a conclusion that every historical modification has received legal clearance.
- Keep the README, About and distributed modification notice clear about independent maintenance and absence of upstream endorsement. A permanent sidebar badge is not proposed; the earlier user preference to remove that badge remains in place.
- A later rename must update the current fork links in the brand manifest, package metadata, README translations, contribution/security text, legal resource copy and local Git remote, and check the fork's actual release/update destinations. Keep upstream service identities, `@superset/*`, CLI/protocol/storage compatibility names and historical evidence URLs when those names describe the original system or an actual past artifact.

Read-only GitHub inspection on this date confirmed repository ID `1412858657`, current name `4444zyf/superset` and default branch `main`. The default branch README still displays the upstream name/icon and upstream downloads (README blob `1fafbe818f1f4ef60e9e0d062d0a7c6f71e8e320`), while the active feature branch has the fork README/notice. A public identity update must address that landing page as a separate, reviewable change; do not silently promote the unfinished feature branch or merge it merely to rename the repository. Looking up `4444zyf/superset-remix` returned 404, which is not a reservation or a guarantee of availability.

The current root and packaged resource copies of both `LICENSE.md` and `FORK_NOTICE.md` were checked byte-identical. A tracked source search did not find an explicit license-key reference in `apps`/`packages`; that limited search does not prove that removing a particular gate is permitted, or replace review of the relevant functionality and terms.

## Adopted repository identity — 2026-10-26

The user selected `superset-remix` and a factual “Based on Superset” source attribution. The product display name remains Superset Remix; the independent data profile and original artwork already use this identity. The intended repository slug is `4444zyf/superset-remix`. Current links still target the existing `4444zyf/superset` so they remain usable until the rename succeeds. README translations and both copies of the modification notice explicitly attribute Superset. The original license, copyright, technical compatibility names and historical evidence URLs are preserved.

The repository rename does not merge the feature branch, change the default branch or publish a new application build. The inherited default-branch landing page must be reconciled with the completed fork before release. This naming decision does not provide trademark clearance or change ELv2 obligations.

The rename was attempted through GitHub on this date, but the integration returned HTTP 403 “Resource not accessible by integration” even though repository inspection reports the user has ADMIN access. Neither the repository name nor About description changed. The local origin was restored and verified as `https://github.com/4444zyf/superset.git`. No browser control tool is available in this session.

An owner can finish the rename in the existing repository's **Settings → General → Repository name**, entering `superset-remix`. Set About to “superset-remix — Based on Superset. Independently maintained local and SSH workstation; unofficial modified version.” Then verify the new repository exists before updating origin to `https://github.com/4444zyf/superset-remix.git` and replacing current fork links in the brand manifest, root/desktop package metadata, root and translated READMEs, contribution/security/development guidance, issue/PR templates and both modification-notice copies. Run `bun run brand:check` and `bun run check:plugins`. Historical evidence URLs and upstream links retain their original identity. No Actions run, default-branch switch or merge is needed.

## Repository rename verified — 2026-10-26

The user completed the GitHub rename. Read-back confirms `4444zyf/superset-remix`, with the upstream fork relationship preserved and `main` still the default branch. Local origin now uses `https://github.com/4444zyf/superset-remix.git`. Current fork URLs, product-brand metadata, package repository/homepage fields, contribution/issue links, translated READMEs, legal resource copy and local publisher fallback have been updated. Historical commit/build/evidence URLs remain as recorded. GitHub reports all four registered workflows `disabled_manually`; no workflow was enabled or run.

Repository About still contains the upstream marketing description and homepage `https://superset.sh`. Updating them through the integration was rejected with HTTP 403 “Resource not accessible by integration”; these settings were not changed. The owner should set the description to “Superset Remix — Based on Superset. Independently maintained local and SSH workstation; unofficial fork.” and the website to `https://github.com/4444zyf/superset-remix`. The default-branch README needs an independent-fork notice and a link to current feature-branch scope rather than implying that its inherited upstream code is the completed accountless product.
