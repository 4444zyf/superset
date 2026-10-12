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

Initial bootstrap reads use system Bash completion deadlines and private FIFOs. A timeout stops only that read's owned process tree before reclaiming its helper files. Remaining payload reads run directly as the SSH UID with a 30-second deadline and SIGKILL. A FIFO replacement after a file check therefore fails within the deadline instead of blocking the system installation lock indefinitely. Linux fixtures cover these ordinary-UID process and FIFO paths; Darwin system Bash and sudo still need macOS validation.

Verified releases are immutable to ordinary users under `/Library/Application Support/SupersetDirect/runtime/<version>-<manifest digest>`. A system LaunchDaemon runs its supervisor as the SSH account, with `AbandonProcessGroup`, a controlled background environment and no dependency on SSH stdin. User identity, 32-byte PSK, databases and logs live in `~/.superset-direct`. All writes and health reads in that directory occur as that user. The installer checks database/watcher native bindings and starts a native PTY before checking authenticated service identity. Installation locks use atomic PID/nonce markers with recovery of abandoned owners.

Installing a new version stages its files and records a pending release without replacing the running config or restarting agents. Activation is a separate maintenance action. A stopped backend's `state/disabled` sentinel is preserved during installation. Stage publication, lifecycle control and activation recovery share the namespace installation lock; a committed transaction consumes only its own candidate marker.

`controlRemoteBackend({ transport, trustedKeys, action, password? })` supports `start`, `stop`, `uninstall`, `activate` and `repair`. Start explicitly clears the disabled sentinel. Stop persists it before stopping workload and clears only this namespace's PTY. Uninstall removes only its job and retains user data and shared runtimes. Repair requires an explicitly stopped backend, verifies the ordinary UID's host is stopped, and replaces its stable launcher with the signed current release; it leaves workload disabled until Start.

Default activation requires the same architecture, Node ABI, protocol, schema, exact host/chat migration digests and PTY bundle digest. Active chat, queued prompts, approvals, creates and background operations defer activation. Migration, ABI and PTY changes remain staged and need a separate stopped upgrade; this implementation does not perform such migrations or daemon handoffs automatically.

Activation writes a durable intent before draining, freezes candidate business and background mutations, stops only its owned host, backs up SQLite after writers exit, and publishes the candidate config. The remote supervisor polls the journal independently of A. Candidate health failure restores the backup before starting old code. The journal marks committing before releasing writes; a lost release acknowledgement never restores a backup over newly accepted writes. Consistent backup/restore uses the old release's native SQLite implementation. Real macOS validation of those native operations is still required.

Authenticated control and health use the private short Unix socket shared with the host and SSH transport. The socket directory is owner-only, and its exact identity, owner and permissions are checked before sending the PSK. There is no fallback to a reused loopback port or HTTP redirect. Private file readers reject symlinks, FIFOs, special files, oversized files and incorrect owners before reading. Root UID subprocesses have bounded lifetimes; daemon workload remains independently owned by launchd.

Installation checks available space for upload, verification, atomic staging and a 256 MiB reserve. Before allocating or uploading, incoming cache admission allows at most four UUID `.partial` directories. Each consumes a full 2 GiB slot, including payload bytes and a 4 KiB reserve per file/directory, for an 8 GiB admission budget across active and abandoned uploads. A release that exceeds one slot is rejected. A short recoverable PID/nonce lock serializes inspection and allocation. Existing directories must have private owned ancestors and regular owned files without shared write access or hard links; inspection stops at 50,000 entries or the slot byte limit. Admission never deletes another upload. When slots are exhausted, review existing uploads and remove only those confirmed abandoned before retrying. Failed uploads attempt to reclaim only their own UUID directory; a lost SSH connection can leave that directory occupying its slot. These limits govern uploads through this installer, rather than impose an OS disk quota on other processes of the same UID. Failed root staging reclaims only that attempt.

Root-owned retention records preserve every UID's current, staged, rollback and stable launcher references. Under the system installation lock, unused runtime cache is reclaimed to 512 MiB; an older job without a retention record prevents reclamation. Required runtimes remain even when their size exceeds that cache budget. Managed snapshots keep the active transaction and one previous complete snapshot. Each backup publishes a building marker before copying database bytes, so a failed partial can be reclaimed after its transaction ends. Fixed service logs retain a bounded tail without replacing launchd's open file inode. Disk preflight can still fail if another application consumes space concurrently; incomplete backup/restore prevents starting a writer.

Build the complete release on a macOS release worker with the target's optional native dependencies installed:

```sh
bun run --cwd packages/cli build:direct \
  --target=darwin-arm64 \
  --node-version=24.21.0 \
  --node-abi=137 \
  --minimum-macos=13.5 \
  --key-id=<embedded-release-key-id> \
  --signing-key-file=/private/path/release-ed25519.pem \
  --trusted-keys-file=/private/path/release-public-keys.json \
  --codesign-identity=<Developer-ID-certificate-SHA1>
```

Repeat on an x64 macOS worker for `darwin-x64`. The output directory is `packages/cli/dist/superset-direct-<target>`. The approved runtime descriptors currently pin Node `24.21.0` / ABI `137` / macOS `13.5`, and Node `22.23.3` / ABI `127` / macOS `11.0`; a release can raise the minimum OS to account for its other native components. Update these descriptors deliberately when adopting another supported patch. The builder rejects an unsupported version, a mismatched ABI and an OS floor below the runtime's requirement before downloading anything. It requires a worker of the target architecture and executes the packaged Node to confirm its version/ABI and pass the SQLite/watcher/PTY smoke check before signing.

The builder reuses CLI Node/native packaging, emits direct host/supervisor/installer/worker/PTY bundles, and includes both migration sets, offline hook templates, SDK native assets and ACP adapters. Vendor CLI authentication and background-accessible Git/model credentials remain separate user prerequisites.

The signing key is a release operator input and is never generated or adopted from an installation payload. The builder requires an independently supplied public key map and refuses a private signing key that does not match it. It codesigns Mach-O runtime/native payloads with the operator's Developer ID identity, performs native smoke checks, then seals the resulting bytes with Ed25519. Official Node archives are checked against freshly fetched HTTPS `SHASUMS256.txt`; modified cached archives fail, and previously extracted mutable binaries are never reused. Do not ship a signing private key.

The desktop release workflow now calls `build-direct.yml` on separate arm64 and Intel macOS workers. Configure these **production GitHub secrets** before running a release: `DIRECT_RELEASE_SIGNING_KEY` (Ed25519 PKCS8 PEM), `DIRECT_RELEASE_KEY_ID`, and `DIRECT_RELEASE_PUBLIC_KEYS_JSON` (a JSON map of independently pinned key IDs to Ed25519 SPKI public PEM). The existing `MAC_CERTIFICATE` and `MAC_CERTIFICATE_PASSWORD` provide the Developer ID keychain. These are release configuration, not runtime `.env` values. No signing identity is generated automatically.

Both complete signed targets are uploaded as CI artifacts, downloaded by each desktop job, checked against the independent pins, and staged under `dist/resources/direct-backend/darwin-arm64`, `darwin-x64` and `direct-release-keys.json`. Artifact executable modes are restored from the signed manifest. Pair version, protocol/schema, Node ABI/version and host/chat migration digests must match. The application ships both targets outside ASAR, so fresh A can deploy to either supported Mac without downloading a separate backend or selecting a directory. Electron signing excludes these already sealed bytes, and post-package verification checks the actual copied resources again.

Desktop packaging fails if signed resources or independent pins are absent. `electron-vite` development and normal web checks do not require these release secrets. An explicitly local development package can use `SUPERSET_DIRECT_DEVELOPMENT_PACKAGE=1` only when the backend payload and public-key resources are absent; remove stale `dist/resources/direct-backend` and `direct-release-keys.json` before this mode. It cannot deploy a managed remote backend. Selecting an offline directory still requires its signer to match the packaged application pins.

Stable and canary publisher metadata use the validated `GITHUB_REPOSITORY` owner/repository from the release job; local packaging defaults to this fork, `4444zyf/superset`, instead of the official upstream. The release workflow still packages with `--publish never` and publishes through its existing release job. Backend assets are carried inside the desktop package; no unconfigured runtime backend download URL is assumed.

For manual release assembly, keep both validated backend directories under one input directory named `darwin-arm64` and `darwin-x64`, set `DIRECT_RELEASE_PUBLIC_KEYS_JSON` from the independent public configuration, and run:

```sh
bun run --cwd packages/cli stage:direct-resources \
  --input-dir=/path/to/validated-backends \
  --resources-dir=/path/to/superset/apps/desktop/dist/resources
```

Stage after compiling the desktop and before packaging it. This command never derives trust from a chosen payload. It verifies the source and copied bytes before replacing existing resources; validation failure preserves the previous resources. The CI workflow itself, Apple notarization, and no-tools Mac deployment have not been executed in this Linux environment and remain release acceptance requirements.

Linux unit tests verify the protocol, signature, permission and transaction contracts with temporary files. `bun run --cwd packages/direct-install test:integration:direct` additionally checks real SQLite WAL snapshots, file restoration and missing snapshots using Node's built-in SQLite test adapter. Production uses the signed old release's `better-sqlite3`; this test does not verify that macOS native binding. macOS launchd, native ABI compatibility, system-job Keychain/TCC behavior, FileVault and physical two-machine task continuity require the design's macOS acceptance scenarios before a release.
