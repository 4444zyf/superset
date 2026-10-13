# Superset Remix artwork

The app icon uses a pearl-white and blue-violet folded S on a dark rounded-square tile. `app-icon-source.png` is the image-generation master with transparent outer margins. `mark-source.png` is its clean white-on-black companion used as a luminance mask; `mark.svg`, the light/dark marks, shared renderer metadata and the menu-bar template are generated from it. Keep both source files. The wordmark contains only the product name.

Artwork was generated with the image-generation tool on 2026-10-13. The first transparent monochrome draft had noisy edges and is not used. Exporting icon sizes and containers is handled by the existing pinned build pipeline, without relying on a machine's icon cache.

Run `bun run brand:generate` from the repository root. Run `bun run brand:check` to compare all 29 outputs byte for byte. JSON formatting uses pinned Biome 2.4.2. The pinned image exporter is sharp 0.34.5 (libvips 8.17.3 in the reference Linux environment); installer and badge text use the system sans-serif font, so regenerate on the same environment for exact raster comparisons. Platform CI consumes committed assets without rerasterizing them.

Outputs include application SVGs embedding the master artwork, 16/24/32/128/1024 PNG proofs, light/dark SVGs, wordmark SVGs, multi-resolution ICNS (16–1024), ICO (16–256), Dev/Canary icons, monochrome template tray PNG, and DMG TIFF background. The generator also derives shared renderer mask, mirrors package metadata and embeds the unchanged original license and fork notice.

The desktop sidebar uses a decorative mark beside the single textual product name. Standalone marks expose the product name to accessibility tools. D and C badges indicate development channels; they do not change the product name. Check small icons at native size, transparency, light/dark contrast and screenshot rendering. Service, agent and integration logos belong to their respective third parties and are not fork artwork.
