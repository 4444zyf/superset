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


## Evaluate a namespace browser page

The source `browser eval` command also accepts an explicit namespace and stable operation ID:

```sh
superset browser eval --namespace "$SUPERSET_HOME_DIR" --workspace <workspace-id> --pane <pane-id> --code 'document.title' --operation-id <uuid> --json
```

Keep the operation ID for that exact workspace, pane and code. Repeating a completed ID returns its original result without running JavaScript again; changed input is refused. After a failure or lost connection, use `browser operation-status` with the same namespace and ID before issuing another evaluation. The CLI does not retry. A code exception leaves an unresolved receipt and repeating that ID does not execute it again.

Evaluation requires durable operations and the selected backend's ready evaluation capability. Existing status queries need only the durable capability while that backend is running. JSON output retains the original `{ "result": ... }` shape; an `undefined` result omits the field and produces `{}`. Strings, structured values, `0`, `false` and `null` retain their original formatting. This is verified with the source CLI runner; the previously bundled executable remains unchanged.

## Open a namespace browser pane

The source `browser open` command accepts an explicit namespace and a stable operation ID:

```bash
superset browser open --namespace "$SUPERSET_HOME_DIR" --workspace <workspace-id> --url <url> --operation-id <uuid> --json
```

The default `--target current-tab` replaces an unpinned browser in the active pane tab, or creates a browser tab when needed. Use `--target new-tab` to create a new tab. Opening runs in the background by default, preserving the user's workspace, terminal selection and keyboard focus; add `--show` to switch to the requested browser. A projectless workspace can open a browser without creating a terminal.

Retain the UUID for the exact intent. Repeating it returns the original completed result without opening another pane, even after that pane has been closed. Changing its workspace, URL, target or show intent is refused. Omitted defaults and explicit `--target current-tab --show false` are equivalent. On a failure or lost connection, inspect `browser operation-status` before opening another pane; the CLI never retries automatically. Opening requires both durable operations and a ready browser-open capability. Status inspection can read a saved receipt while that renderer is unavailable.

Local and owned loopback SSH acceptance uses the original source CLI dev runner. The bundled CLI has not been rebuilt or installed remotely. Existing commands without `--namespace` retain their account and host behavior.

The existing login-import command also accepts an explicit namespace:

```sh
superset browser import-login --namespace "$SUPERSET_HOME_DIR" --workspace <workspace-id> --pane <pane-id> --json
superset browser import-login --namespace "$SUPERSET_HOME_DIR" --workspace <workspace-id> --pane <pane-id> --from Chrome --profile Main --operation-id <uuid> --json
```

Listing needs no operation ID. Importing with `--from` requires a UUID for that exact workspace, pane and detected source. Browser and profile matching, counts and the Keychain-unavailable output use the original command. Sources belong to the attached desktop machine; the source identifier is opaque to the CLI, including when the CLI runs on an SSH backend. The CLI does not resolve or inspect that desktop path locally. Linux retains the original Keychain-based empty login list.

The source query requires the negotiated source-list capability, and importing also requires durable operations and the ready cookie-import capability. The dedicated import transport can send only one versioned cookie-import mutation. A completed ID returns its saved counts, including a saved `keyUnavailable: true`, without rereading or reimporting cookies. After granting Keychain access, a deliberate new import needs a new ID. On any failure or lost connection, inspect the original ID with `browser operation-status` before attempting another import; the CLI never retries automatically. The client request budget is 20 seconds while the desktop may still be waiting on the original 120-second Keychain prompt, so a client timeout does not mean the operation stopped. A pending or unresolved result must be inspected rather than replayed.

This is source CLI support; the bundled CLI binary has not been rebuilt. Native validation currently covers Linux empty-list/rejection behavior and original durable API receipt inspection on local and owned SSH targets. Positive source matching/import output is covered through an owned Unix-socket test endpoint; macOS credential import and a positive native CLI import remain unverified.
