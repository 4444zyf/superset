# Superset CLI in Superset Remix

This fork bundles the existing technical `superset` CLI with the Superset Remix desktop, an unofficial modified version of Superset. The executable, command syntax, package imports and remote service contracts keep their original names. The desktop, CLI and host-service versions are unified.

Local and direct-SSH commands use their configured backend. Hosted account, cloud, feedback and subscription commands still refer to upstream Superset services; this fork does not operate those services. Original author and vendor names are preserved. The desktop preview is updated manually from [this fork's downloads](https://github.com/4444zyf/superset-remix/releases); the standalone CLI updater is retained upstream tooling and is not the desktop update mechanism.

See the [fork build guide](../../DEVELOPMENT.md), [scope inventory](../../docs/design/branding-audit.md), [modification notice](../../FORK_NOTICE.md) and unchanged [original license](../../LICENSE.md). Upstream CLI documentation is available at <https://docs.superset.sh/cli> and can differ from this desktop.

## Read an existing Remix namespace

The CLI source accepts `--namespace <absolute-directory>` on `agents list`, `projects list`, `workspaces list`, `workspaces get`, `terminals list`, `terminals read`, `scripts list`, `browser list`, `browser console`, and `browser screenshot`. Run the CLI on the machine that owns that directory. With a matching CLI installed on PATH, for example from a Remix terminal:

```sh
superset agents list --namespace "$SUPERSET_HOME_DIR" --json
superset workspaces list --namespace "$SUPERSET_HOME_DIR" --search feature --json
superset workspaces get <workspace-id> --namespace "$SUPERSET_HOME_DIR" --field worktreePath
superset terminals list --namespace "$SUPERSET_HOME_DIR" --workspace <workspace-id> --json
superset terminals read --namespace "$SUPERSET_HOME_DIR" --workspace <workspace-id> --terminal <terminal-id> --json
```

This explicit mode reads the selected existing backend through its authenticated private Unix socket. It requires no Superset login, leaves empty Agent/script catalogs empty, and refuses a stopped or missing backend. Workspace project/search/tag filters retain the original rules. Terminal listing retains the existing live-session behavior, including daemon readiness; it does not create a terminal.

Terminal reading uses the original plain-text screen snapshot, including the current alternate screen for a TUI. It retains `--max-lines` and text/JSON output. A missing terminal is refused; it never creates a PTY. An existing detached PTY can be adopted through the original backend path.

Workspace details retain the original fields, table/raw-field formatting, `-f` alias, and workspace-id environment fallback. The selected namespace is always explicit; a missing workspace does not trigger a cloud or other-machine lookup. `hostName` uses the original host-id fallback without querying Superset's hosted names. Workspace detail support is source-validated; packaged acceptance waits for the next explicitly requested build.

`--namespace` is available only on the commands listed here. It is not an implicit default and cannot be combined with `--host`; unsupported commands reject the flag. Existing command behavior without the flag is retained. Remote CLI installation, automatic terminal target selection, and additional CLI commands are still being connected; this does not claim full CLI parity or a new macOS installer.

## Navigate a namespace browser pane

The CLI source also supports explicit namespace navigation and durable operation status:

```sh
superset browser navigate --namespace "$SUPERSET_HOME_DIR" --workspace <workspace-id> --pane <pane-id> --url <url> --operation-id <uuid> --json
superset browser operation-status --namespace "$SUPERSET_HOME_DIR" --operation-id <uuid> --json
```

Choose and retain one UUID for each intended navigation. Repeating the same ID with the same target returns its original completed result without navigating again; changing its input is refused. Navigation requires the selected backend's durable operation and ready browser navigation capabilities. It uses that desktop window's original navigation and SSH port forwarding, and keeps the current terminal tab and keyboard focus when the browser is hidden.

If the request fails or the connection closes, inspect its operation status before issuing another navigation. The CLI does not retry or generate another ID. A status query can read an existing receipt while the browser peer is unavailable, provided that backend is still running. `accepted` and `unresolved` receipts do not prove that navigation finished. Even a previously completed navigation command requires the ready navigation capability; use the status command to inspect it when that peer is unavailable.

These additions are validated through the original source CLI dev runner. The previously bundled CLI has not been rebuilt, and this does not publish a new installer. Commands without `--namespace` retain their existing account and host behavior.
