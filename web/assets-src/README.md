# Design sources (not published)

Files here are kept for reference and regeneration only; they are not part of
the static export. Derivatives served to the browser live in `public/`.

## Background wallpaper

- `bg_4k.png` — login landscape design source (1672×941, 16:9)
- `bg_portal.png` — login portrait design source (1320×2868, ~9:19.5)
- `bg_room.png` — game-room landscape design source (1672×941, 16:9)
- `bg_room_portal.png` — game-room portrait design source (1600×2848)

Each screen uses compressed WebP derivatives, selected by the orientation/width
media queries in `styles/index.css`: `public/bg-*-portrait.webp` (portrait
screens), `public/bg-*-1100.webp` (small landscape), `public/bg-*-1672.webp`
(landscape ≥700px).

Regenerate the derivatives (sharp-cli):

```bash
npx sharp-cli -i assets-src/bg_4k.png          -o public/bg-1100.webp         --quality 85 resize 1100
npx sharp-cli -i assets-src/bg_4k.png          -o public/bg-1672.webp         --quality 92
npx sharp-cli -i assets-src/bg_portal.png      -o public/bg-portrait.webp     --quality 85
npx sharp-cli -i assets-src/bg_room.png        -o public/bg-room-1100.webp    --quality 85 resize 1100
npx sharp-cli -i assets-src/bg_room.png        -o public/bg-room-1672.webp    --quality 92
npx sharp-cli -i assets-src/bg_room_portal.png -o public/bg-room-portrait.webp --quality 85 resize 1320
```

## Table materials

- `table.png` — green felt albedo texture (2048×2048)
- `table_edge.png` — wood rail albedo texture (2048×2048)

Applied as fixed-density tiling backgrounds (`.felt-material` /
`.rail-material` in `styles/index.css`), not stretched images: the oval
geometry stays CSS shape (rounded-full + padding) and resizes with the
viewport while the texture density (`background-size`) never changes.

Regenerate the derivatives (sharp-cli):

```bash
npx sharp-cli -i assets-src/table.png      -o public/table-felt.webp --quality 80 resize 1024
npx sharp-cli -i assets-src/table_edge.png -o public/table-edge.webp --quality 80 resize 1024
```
