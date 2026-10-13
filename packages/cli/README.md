# Superset CLI in Superset Remix

This fork bundles the existing technical `superset` CLI with the Superset Remix desktop, an unofficial modified version of Superset. The executable, command syntax, package imports and remote service contracts keep their original names. The desktop, CLI and host-service versions are unified.

Local and direct-SSH commands use their configured backend. Hosted account, cloud, feedback and subscription commands still refer to upstream Superset services; this fork does not operate those services. Original author and vendor names are preserved. The desktop preview is updated manually from [this fork's downloads](https://github.com/4444zyf/superset/releases); the standalone CLI updater is retained upstream tooling and is not the desktop update mechanism.

See the [fork build guide](../../DEVELOPMENT.md), [scope inventory](../../docs/design/branding-audit.md), [modification notice](../../FORK_NOTICE.md) and unchanged [original license](../../LICENSE.md). Upstream CLI documentation is available at <https://docs.superset.sh/cli> and can differ from this desktop.
