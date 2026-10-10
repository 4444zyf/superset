# Direct backend installation

`@superset/direct-install` installs a signed macOS backend through the desktop's authenticated OpenSSH transport. It requires no preinstalled Node, Bun, Python, package manager or compiler on the Mac.

```ts
await installRemoteBackend({
  transport: { exec, upload },
  releaseRoot: "/path/to/signed-release-directory",
  trustedKeys: applicationEmbeddedReleaseKeys,
  password: temporaryAdministratorPassword,
});
```

`exec(command, stdin?)` returns `{ stdout, stderr, exitCode }`; `upload(localPath, remotePath)` uses SFTP. The administrator password is sent only through sudo stdin. An `authorize(script)` callback can replace that authorization path. No password, SSH private key or backend PSK is included in a release, command arguments or installation result.

The selected directory contains `release-manifest.json`, `release-signature.json`, and the listed files. The application embeds the fork's trusted Ed25519 public keys separately; keys from a selected directory cannot grant trust. Verification rejects altered bytes, traversal paths, duplicates, symlinks, unlisted files and incomplete native bundles. Upload uses an isolated `.partial` directory. The privileged bootstrap reads only signed, bounded Node and installer bytes as the SSH user, copies them into private root-owned storage and verifies their digests before execution. The trusted installer verifies the manifest signature again and reads every remaining file as the SSH user. It never recursively copies user-owned payload paths as root.

Verified releases are immutable to ordinary users under `/Library/Application Support/SupersetDirect/runtime/<version>-<manifest digest>`. A system LaunchDaemon runs its supervisor as the SSH account, with `AbandonProcessGroup`, a controlled background environment and no dependency on SSH stdin. User identity, 32-byte PSK, databases and logs live in `~/.superset-direct`. All writes and health reads in that directory occur as that user. The installer checks database/watcher native bindings and starts a native PTY before checking authenticated service identity. Installation locks use atomic PID/nonce markers with recovery of abandoned owners.

Installing a new version stages its files and records a pending release without replacing the running config or restarting agents. Activation is a separate maintenance action. A stopped backend's `state/disabled` sentinel is preserved during installation. Stage publication, lifecycle control and activation recovery share the namespace installation lock; a committed transaction consumes only its own candidate marker.

`controlRemoteBackend({ transport, trustedKeys, action, password? })` supports `start`, `stop`, `uninstall`, `activate` and `repair`. Start explicitly clears the disabled sentinel. Stop persists it before stopping workload and clears only this namespace's PTY. Uninstall removes only its job and retains user data and shared runtimes. Repair requires an explicitly stopped backend, verifies the ordinary UID's host is stopped, and replaces its stable launcher with the signed current release; it leaves workload disabled until Start.

Default activation requires the same architecture, Node ABI, protocol, schema, exact host/chat migration digests and PTY bundle digest. Active chat, queued prompts, approvals, creates and background operations defer activation. Migration, ABI and PTY changes remain staged and need a separate stopped upgrade; this implementation does not perform such migrations or daemon handoffs automatically.

Activation writes a durable intent before draining, freezes candidate business and background mutations, stops only its owned host, backs up SQLite after writers exit, and publishes the candidate config. The remote supervisor polls the journal independently of A. Candidate health failure restores the backup before starting old code. The journal marks committing before releasing writes; a lost release acknowledgement never restores a backup over newly accepted writes. Consistent backup/restore uses the old release's native SQLite implementation. Real macOS validation of those native operations is still required.

Authenticated control and health use the private short Unix socket shared with the host and SSH transport. The socket directory is owner-only, and its exact identity, owner and permissions are checked before sending the PSK. There is no fallback to a reused loopback port or HTTP redirect. Private file readers reject symlinks, FIFOs, special files, oversized files and incorrect owners before reading. Root UID subprocesses have bounded lifetimes; daemon workload remains independently owned by launchd.

Installation checks available space for upload, verification, atomic staging and a 256 MiB reserve. Failed uploads attempt to reclaim only their own UUID directory; a lost SSH connection can leave that directory until the user removes it. Failed root staging reclaims only that attempt. Root-owned retention records preserve every UID's current, staged, rollback and stable launcher references. Under the system installation lock, unused runtime cache is reclaimed to 512 MiB; an older job without a retention record prevents reclamation. Required runtimes remain even when their size exceeds that cache budget. Managed snapshots keep the active transaction and one previous complete snapshot. Each backup publishes a building marker before copying database bytes, so a failed partial can be reclaimed after its transaction ends. Fixed service logs retain a bounded tail without replacing launchd's open file inode. Disk preflight can still fail if another application consumes space concurrently; incomplete backup/restore prevents starting a writer.

Build the complete release on a macOS release worker with the target's optional native dependencies installed:

```sh
bun run --cwd packages/cli build:direct \
  --target=darwin-arm64 \
  --node-version=24.21.0 \
  --node-abi=137 \
  --minimum-macos=13.5 \
  --key-id=<embedded-release-key-id> \
  --signing-key-file=/private/path/release-ed25519.pem
```

Repeat on an x64 macOS worker for `darwin-x64`. The output directory is `packages/cli/dist/superset-direct-<target>`. The approved runtime descriptors currently pin Node `24.21.0` / ABI `137` / macOS `13.5`, and Node `22.23.3` / ABI `127` / macOS `11.0`; a release can raise the minimum OS to account for its other native components. Update these descriptors deliberately when adopting another supported patch. The builder rejects an unsupported version, a mismatched ABI and an OS floor below the runtime's requirement before downloading anything. It requires a worker of the target architecture and executes the packaged Node to confirm its version/ABI and pass the SQLite/watcher/PTY smoke check before signing.

The builder reuses CLI Node/native packaging, emits direct host/supervisor/installer/worker/PTY bundles, and includes both migration sets, offline hook templates, SDK native assets and ACP adapters. Vendor CLI authentication and background-accessible Git/model credentials remain separate user prerequisites.

The signing key is a release operator input and is never generated or adopted from an installation payload. Embed its public verification key in the desktop's `resources/direct-release-keys.json` and the signed backend directory in `resources/direct-backend`, or select a signed offline directory. Do not ship a signing private key.

Linux unit tests verify the protocol, signature, permission and transaction contracts with temporary files. `bun run --cwd packages/direct-install test:integration:direct` additionally checks real SQLite WAL snapshots, file restoration and missing snapshots using Node's built-in SQLite test adapter. Production uses the signed old release's `better-sqlite3`; this test does not verify that macOS native binding. macOS launchd, native ABI compatibility, system-job Keychain/TCC behavior, FileVault and physical two-machine task continuity require the design's macOS acceptance scenarios before a release.
