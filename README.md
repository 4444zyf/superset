<div align="center">
<img src="assets/branding/icon-128.png" alt="Superset Remix icon" width="96" height="96" />

# Superset Remix

Local and SSH workstations. An unofficial modified version of [Superset](https://github.com/superset-sh/superset), independently maintained without endorsement from Superset, Inc.

[Downloads](https://github.com/4444zyf/superset/releases) · [Fork issues](https://github.com/4444zyf/superset/issues) · [Build guide](DEVELOPMENT.md)
</div>

## Use the desktop

The current desktop opens the accountless Workstation: add an SSH machine, connect, and install the bundled verified backend automatically when it is missing. Initial installation may require the remote administrator password. Terminals, projects and workspaces use the selected local or SSH backend; disconnecting the desktop leaves remote tasks running.

Verified 1.37.5 previews: [Apple Silicon](https://github.com/4444zyf/superset/actions/runs/38373722281/artifacts/11801488368) · [Intel](https://github.com/4444zyf/superset/actions/runs/38373722281/artifacts/11803122248). These workflow artifacts include checksums, source, SSH/UI acceptance and legal notices, and expire after 14 days. Both native jobs passed; source is `ed4e9964794f9a09887a1a7e25eb5e02f165b31e`. Performance comparisons are recorded in [the implementation report](docs/implementation/ssh-performance-2026-10-13.md).

macOS Apple Silicon and Intel preview DMGs are built and checked separately. Preview downloads may appear as workflow artifacts before a GitHub prerelease is published. Use the version and source checksum included with each artifact. Historical `Superset SSH Preview` downloads predate this branding. Linux and Windows distributions have not been validated for this fork.

This product starts with a new independent `superset-remix` data directory. It does not import the earlier preview or upstream application's data automatically. Update manually using this fork's downloads. Apple Developer ID signing and notarization are not configured; these are ad-hoc signed development previews.

Fork identity and modification details are documented here and in [FORK_NOTICE.md](FORK_NOTICE.md). The desktop has a normal **About** entry with the installed version, source links and original license available offline.

![Superset Remix running from the verified arm64 DMG](docs/implementation/evidence/fork-branding/native-arm64/workstation.png)

This screenshot is from the actual verified arm64 DMG, source `2f71640cedd4155781dbb9e87a4baaaf6c956a87`. Native screenshots and measurements accompany the build artifacts.

## Scope and attribution

Superset's website, hosted services, mobile app, subscription plans, and community remain upstream services. This fork does not publish or operate them. Source for those surfaces remains in the monorepo; see the [surface inventory and source audit](docs/design/branding-audit.md). Upstream documentation describes upstream features and may differ from this desktop.

Original authorship, copyright and [Elastic License 2.0](LICENSE.md) are preserved. See [FORK_NOTICE.md](FORK_NOTICE.md) for the modification notice, [CONTRIBUTING.md](CONTRIBUTING.md) for contributions, and [SECURITY.md](SECURITY.md) for reporting limitations.

## Translations

[cs](readme/README.cs.md) · [de](readme/README.de.md) · [es](readme/README.es.md) · [fr](readme/README.fr.md) · [id](readme/README.id.md) · [it](readme/README.it.md) · [ja](readme/README.ja.md) · [ko](readme/README.ko.md) · [nl](readme/README.nl.md) · [pl](readme/README.pl.md) · [pt-BR](readme/README.pt-BR.md) · [ru](readme/README.ru.md) · [tr](readme/README.tr.md) · [vi](readme/README.vi.md) · [zh-CN](readme/README.zh-CN.md) · [zh-TW](readme/README.zh-TW.md)
