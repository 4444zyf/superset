# Superset CLI in Superset Remix

This fork bundles the existing technical `superset` CLI with the Superset Remix desktop, an unofficial modified version of Superset. The executable, command syntax, package imports and remote service contracts keep their original names. The desktop, CLI and host-service versions are unified.

Local and direct-SSH commands use their configured backend. Hosted account, cloud, feedback and subscription commands still refer to upstream Superset services; this fork does not operate those services. Original author and vendor names are preserved. The desktop preview is updated manually from [this fork's downloads](https://github.com/4444zyf/superset/releases); the standalone CLI updater is retained upstream tooling and is not the desktop update mechanism.

See the [fork build guide](../../DEVELOPMENT.md), [scope inventory](../../docs/design/branding-audit.md), [modification notice](../../FORK_NOTICE.md) and unchanged [original license](../../LICENSE.md). Upstream CLI documentation is available at <https://docs.superset.sh/cli> and can differ from this desktop.

## Read an existing Remix namespace

The bundled CLI accepts `--namespace <absolute-directory>` on `agents list`, `projects list`, `workspaces list`, `terminals list`, `terminals read`, and `scripts list`. Run the CLI on the machine that owns that directory. With this CLI installed on PATH, for example from a Remix terminal:

```sh
superset agents list --namespace "$SUPERSET_HOME_DIR" --json
superset workspaces list --namespace "$SUPERSET_HOME_DIR" --search feature --json
superset terminals list --namespace "$SUPERSET_HOME_DIR" --workspace <workspace-id> --json
superset terminals read --namespace "$SUPERSET_HOME_DIR" --workspace <workspace-id> --terminal <terminal-id> --json
```

This explicit mode reads the selected existing backend through its authenticated private Unix socket. It requires no Superset login, leaves empty Agent/script catalogs empty, and refuses a stopped or missing backend. Workspace project/search/tag filters retain the original rules. Terminal listing retains the existing live-session behavior, including daemon readiness; it does not create a terminal.

Terminal reading uses the original plain-text screen snapshot, including the current alternate screen for a TUI. It retains `--max-lines` and text/JSON output. A missing terminal is refused; it never creates a PTY. An existing detached PTY can be adopted through the original backend path.

`--namespace` is currently available only on these six commands. It is not an implicit default and cannot be combined with `--host`; unsupported commands reject the flag. Existing command behavior without the flag is retained. Remote CLI installation, automatic terminal target selection, and additional CLI commands are still being connected; this does not claim full CLI parity or a new macOS installer.
