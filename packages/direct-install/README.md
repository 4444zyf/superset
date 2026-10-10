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

Installing a new version stages its files and records a pending release without replacing the running config or restarting agents. Activation is a separate maintenance action. A stopped backend's `state/disabled` sentinel is preserved during installation.

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

Linux unit tests verify the protocol, signature, permission and transaction contracts with temporary files. They do not verify macOS launchd, native ABI compatibility, system-job Keychain/TCC behavior, FileVault or physical two-machine task continuity. Those checks require the design's macOS acceptance scenarios before a release.
