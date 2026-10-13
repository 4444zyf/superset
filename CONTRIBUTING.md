# Contributing to Superset Remix

This repository maintains an unofficial modified version of Superset. Follow the [code of conduct](CODE_OF_CONDUCT.md) and report fork bugs or propose larger changes in [this fork’s issues](https://github.com/4444zyf/superset/issues). There is no promised review or response time.

Follow [DEVELOPMENT.md](DEVELOPMENT.md) to build the current accountless desktop. Branch from the target fork branch and open pull requests against `4444zyf/superset`. Include the problem, resulting behavior, relevant checks and real screenshots for UI changes. Use the repository’s Biome, type checks, tests and `bun run check:i18n` for changed user-facing copy. Commit all 17 translation catalogs. `bun run brand:check` verifies generated artwork and notices.

Keep the original license, authorship and copyright. Use the pure shared product-brand config for product identity. Package names, protocol contracts, environment keys and remote service identifiers remain compatible; do not rename them as cosmetic cleanup. Current desktop profiles are fresh and independent, with no automatic migration from old previews.

Read the [CDP verification skill](.agents/skills/cdp-verification/SKILL.md) before UI verification. Match the renderer to your checkout and drive real input. The current Workstation does not require a hosted account. The upstream account-authentication instructions apply only to retained cloud screens.

Upstream contributions and community support belong to [superset-sh/superset](https://github.com/superset-sh/superset); that community is not this fork’s support channel.
