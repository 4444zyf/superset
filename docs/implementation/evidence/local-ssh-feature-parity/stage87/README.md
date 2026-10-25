# Stage 87 — original history import transaction reuse

Source `63226e16e90ca597e1cf54d7a01eb27b65462af8`, parent `acb55e90ec36ae72c387be4e382a221f7aa07bc3`. This is preparation for explicitly chosen browser imports, not an enabled import UI or native import acceptance.

The exact original transaction and 200-row chunks moved from the released browserHistory router into its existing repository. The legacy router delegates and retains all inputs, outputs, procedure types and error handling. WorkstationBrowserHistory now delegates an internal importEntries method to the same code. There is no new IPC, renderer entry, migration, automatic data import or browser-directory access.

`extraction-proof.json` compares normalized AST: original transaction, complete released router after inlining the repository call, four existing repository methods, and chunk size. Private API/preload, source discovery/parser/cookie implementation and original 0026 migration remain byte-identical. No released input or output changed; no production service or usage query is needed for this source-only extraction.

Tests: 16 cases / 3197 assertions / 4 files; desktop types and plugins pass. Real owned in-memory SQLite cases validate 202 merged URLs across the original chunk boundary, identity/title/favicon preservation, non-inflating repeat imports, and actual trigger failure in the second chunk rolling back the first chunk's insertions and update. The initial missing-method red log precedes implementation. The separate test-path setup failure did not exercise a test and is not counted as red behavior evidence. No runtime module mocks, private-map manipulation or real waits.

There was no source build or native UI run this stage. The existing 2205 compiled files still exactly match stage 86's final `87a23669510edbf2703351f56af8ad963a5b694a` snapshot; CLI SHA256 remains `f89552f7f0d9402b8f48eb2e4ecf0b97eaa5cd5438b64658ccf79534515487bb`. No Actions, CLI rebuild, installer, sealed backend archive or shared database migration. Import UI/service, source selection, platform permission handling and actual local/SSH import verification remain pending. Overall parity is not complete.
