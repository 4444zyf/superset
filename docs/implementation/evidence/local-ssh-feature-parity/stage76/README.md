# Stage 76 evidence

Source: 1f620bad0c983460da95fe42145b6cd3622922c2. Existing browser table and four legacy operations are extracted unchanged. The new private workstation history file is initialized with the existing generated 0026_browser_history.sql; no migration file or cloud database changed.

- `history-contract-proof.json` compares original operation bodies (after the database variable rename), procedure kinds/inputs, error mapping and table definition against 217929f78.
- `repository-first-tests.log.gz` uses real Bun SQLite and Drizzle, not a fake table or database. Final related tests: 61 passed, 2951 assertions, 6 files. Desktop/local-db types, formatting and plugins passed.
- `baseline-601b/app/browser-history-ipc.json`: the frozen 601b compiled workstation has no history IPC. The native run fails at that assertion. `baseline-compiled-integrity.json` verifies all 2205 baseline files.
- `verified-ipc/app/browser-history-ipc.json`: actual Electron renderer -> preload -> owned main IPC -> native SQLite writes, search, normal close/reopen persistence, clear and another reopen. File mode is 0600 and the database has only browser_history. This is backend/IPC integration; no browser pane UI or guest navigation is claimed.
- `product-snapshot.json`: final 2205 compiled main/preload/renderer files, rechecked after the native run. CLI SHA256 remains f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb.

No profiles, private keys or databases are included. Generic desktop screenshots were captured; no new browser UI verification is claimed. No CLI rebuild, installers, sealed backend release archives, GitHub Actions or external messaging. Workstation browser entry/layout and remaining original features are still unfinished.
