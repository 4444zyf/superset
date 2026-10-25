# Stage 79 evidence

Product source: `048155a7c531183965a0ed6a7aa158ee3e5b3c7e`.

This stage makes current guest-declared favicon images render in the workspace address bar through bounded data URLs. The original renderer CSP is unchanged; `csp-unchanged.json` records its exact file hash. Layout/history keep the original favicon URI. Only icons declared by the current registered guest can use the new image IPC, including canonical aliases of those candidates. Other history icons fall back to the existing globe.

- `baseline-ac7371`: the stage 78 product loads the real page and saves icon metadata, but fails the new data-URL image-display assertion under the existing CSP. This remains an expected failure.
- `verified-local-048155`, `verified-ssh-048155`: initial complete image/UI passes. The extended fixture then added an explicit image check after normal window reopen.
- `verified-local-reopen-048155`, `verified-ssh-reopen-048155`: complete initial/reopen image checks and the existing navigation, find, window.open split and selective-close journey. Each SSH journey also includes 20 preceding restores. The SVG bytes contain a unique marker from the actual owned HTTP server; the decoded image has natural size 16×16 before and after reopening. Original terminal PID/execution/cwd survive.
- `tests-final-product.log.gz`: 45 tests, 2989 assertions, 7 files. `types-final-product.log.gz` is empty on success.
- `icon-replaced-registration-red.log.gz`: a late icon forward could reach a replacement record if a client reused its token; the fix checks the captured registration object after the await and includes backend/namespace/instance in cache authority.
- Other red logs preserve missing implementation/API behavior before the changes. No real waiting was added to unit tests.

HTTP image reads use the guest's session, accept only listed image MIME types, cap response bodies at 256 KiB and HTTP requests per redirect chain at four, limit concurrent reads to 16 and cache entries to 64 with a five-minute lazy TTL. Cached and asynchronous results recheck the owner/registration and connection identity. Redirects and SSH loopback resources are resolved inside the captured workspace scope.

`product-snapshot.json` contains all 2205 compiled main/preload/renderer files; `post-native-integrity.json` verifies them after all native runs. The CLI was not rebuilt. The final SSH reopen screenshot was inspected; other images are captures. The summary image SHA256 values describe data-URL strings, not raster pixel hashes. Runtime exception lists do not constitute an audit of every Chromium diagnostic message.

Browser settings/import, full tab/history icon rendering, complete link preferences, device/design/devtools UI and the CLI bridge remain pending. Terminal wheel/clipboard native evidence remains the stage 78 source and scope; those terminal implementations were not changed here. Physical macOS input, external SSH hosts and authenticated vendor agents were not exercised.

Only owned-run reports/logs/screenshots/scripts are retained, with profiles/databases/keys/credentials excluded. Logs are gzip-compressed; `SHA256SUMS` covers all retained files except itself. Owned cleanup results are recorded per case. No Actions, installers, CLI build or sealed backend release archive was used.
