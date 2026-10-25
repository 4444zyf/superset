# Stage 77 evidence

Source: c1d475ae30862719d4fd43ec5c094ad80c6bd95f; resource ownership fix: 28e3949c9def7e1c3fb705a8b4f50d4937496cd4.

This verifies versioned layout persistence and registered page-state IPC. It does not verify a product browser pane, guest navigation to the saved URL, SSH browsing, physical macOS input or authenticated vendor agents.

- baseline-1f620: original compiled product lacks the V2 methods, expected failure; compiled manifest checked before build.
- verified-c1d475: diagnostic forgot to create a terminal, failed waiting for a layout.
- verified-terminal-c1d475: diagnostic used the SSH-only restart helper, failed after successful page IPC.
- verified-reopen-c1d475: original complete IPC/reopen pass, retained separately.
- verified-final-28e394: final complete pass, including a replaced resource callback returning stale and the original terminal PID/execution/cwd surviving normal close/reopen.
- tests-resource-final.log.gz: 49 tests, 2968 assertions, 6 files. types-resource-final.log.gz is empty on success.
- replaced-resource-red.log.gz and legacy-namespace-red.log.gz preserve the concrete regressions before fixes. Other intermediate failures are retained without counting them as passes.
- product-snapshot.json and post-native-integrity.json record final compiled files. CLI was not rebuilt.

Native application launchers use an owned Xorg display and independent profiles. Profile directories, SQLite databases, private keys and backend credentials are excluded. Logs are gzip-compressed; SHA256SUMS covers every retained file except itself. The final after-reopen screenshot was inspected; other images are captures only.
