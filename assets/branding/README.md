# Superset Remix artwork

`mark.svg` is the editable 32×32 mother artwork: two endpoint brackets joined by a bridge. The three filled paths use `currentColor`; renderer geometry is generated from these exact paths. Keep at least four units of internal clear space. Use the light mark on dark surfaces and dark mark on light surfaces. The wordmark uses only the product name, with no subtitle.

Run `bun run brand:generate` from the repository root. Run `bun run brand:check` to compare all 28 outputs byte for byte. JSON formatting uses pinned Biome 2.4.2. The pinned image exporter is sharp 0.34.5 (libvips 8.17.3 in the reference Linux environment); installer and badge text use the system sans-serif font, so regenerate on the same environment for exact raster comparisons. Platform CI consumes committed assets without rerasterizing them.

Outputs include editable application SVGs, 16/24/32/128/1024 PNG proofs, light/dark SVGs, wordmark SVGs, multi-resolution ICNS (16–1024), ICO (16–256), Dev/Canary icons, monochrome template tray PNG, and DMG TIFF background. The generator also derives shared renderer geometry, mirrors package metadata and embeds the unchanged original license and fork notice.

The desktop sidebar uses a decorative mark beside the single textual product name. Standalone marks expose the product name to accessibility tools. D and C badges indicate development channels; they do not change the product name. Check small icons at native size, transparency, light/dark contrast and screenshot rendering. Service, agent and integration logos belong to their respective third parties and are not fork artwork.
