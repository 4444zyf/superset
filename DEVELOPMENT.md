# Developing Superset Remix

Superset Remix is an unofficial modified version of Superset. The current desktop entry is the accountless local/SSH Workstation; retained hosted apps are not a fork deployment.

## Build the current desktop

Use Git, Node, Bun 1.4.2 (see `.bun-version`) and platform-native Electron dependencies. macOS is the validated distribution target.

```bash
git clone https://github.com/4444zyf/superset.git
cd superset
bun install
bun run --cwd apps/desktop compile:app
bun run --cwd apps/desktop start
```

`start` runs compiled source. `bun run --cwd apps/desktop dev` starts the desktop development server. Build environment validation can require placeholder values from `.env.local.example`; use a private `.env` and do not supply production credentials. The accountless Workstation does not require a Superset account or a hosted API.

Installed data lives under the OS application-data directory in `superset-remix`. Source development uses `superset-remix-dev-<checkout/workspace SHA256>`. Set `SUPERSET_WORKSPACE_ID` to a stable unique workspace ID when appropriate. Both directories are selected before acquiring the single-instance lock. No previous preview profile is migrated or consulted automatically.

## Build verified macOS previews

Run `.github/workflows/release-desktop-preview.yml` on the intended source branch with `publish=false`. Each native backend worker signs its output with a temporary Ed25519 key. The desktop embeds the independently pinned verification keys and complete backend resources for both Mac architectures. Native jobs check SFTP upload, privileged installation, launchd, authenticated RPC and reconnect before packaging and again inside the mounted final DMG. Package checks cover SQLite, PTY, code signing, license and source identity; UI acceptance captures the actual packaged Workstation and About dialog.

Without backend resources and pinned keys, a source-only desktop cannot automatically install the remote backend. Do not disable verification to bypass this error. Apple Developer ID signing and notarization are not configured; preview packages are ad-hoc signed. These are manually updated previews, not a production auto-update feed.

## Artwork and checks

```bash
bun run brand:generate
bun run brand:check
bun run check:versions
bun run check:i18n
bun run --cwd apps/desktop typecheck
```

See [assets/branding/README.md](assets/branding/README.md), [branding audit](docs/design/branding-audit.md), [AGENTS.md](AGENTS.md) and [CONTRIBUTING.md](CONTRIBUTING.md). Run tests appropriate to your change. Source-only Linux UI checks do not establish Linux distribution support.

## Retained upstream development

`.superset/setup.local.sh`, Docker, API/web development, cloud sign-in, mobile and marketing remain upstream development infrastructure. They are outside this desktop release. See their source documentation if you intend to work on them; do not interpret them as running fork services.
