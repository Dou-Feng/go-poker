# Design sources (not published)

Files here are kept for reference and regeneration only; they are not part of
the static export. Derivatives served to the browser live in `public/`.

## Background wallpaper

- `bg_4k.png` — login landscape design source (1672×941, 16:9)
- `bg_portal.png` — login portrait design source (1320×2868, ~9:19.5)
- `bg_room.png` — game-room landscape design source (1672×941, 16:9)
- `bg_room_portal.png` — game-room portrait design source (1600×2848)

Each screen uses compressed WebP derivatives, selected by the orientation/width
media queries in `styles/Register.module.css` (login) and `styles/shared.css` (lobby/room): `public/bg-*-portrait.webp` (portrait
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

`room_new_design.png` is the portrait table reference. The felt and wood
textures are applied with `cover` (no visible tile seams), under directional
lighting, inset shadows and bevels in `styles/game.css`. The rail remains a
responsive CSS shape; no UI or player information is baked into the texture.

`lib/tableLayout.ts` supplies the shared seat/pot coordinates for both Table
and TableFx. `hooks/useTableLayout.ts` measures the safe playing area when the
viewport changes. Portrait screens reserve the top toolbar and bottom controls;
wide screens use a landscape table. Run the boundary checks with
`node tests/tableLayout.test.cjs` from `web/`.

Regenerate the derivatives (sharp-cli):

```bash
npx sharp-cli -i assets-src/table.png      -o public/table-felt.webp --quality 80 resize 1024
npx sharp-cli -i assets-src/table_edge.png -o public/table-edge.webp --quality 80 resize 1024
```

## Fonts

- `FZLTTHJW.TTF` — FZLanTingHei source font (2.1 MB, full CJK coverage)
- `nunito-latin.woff2` / `nunito-latin-ext.woff2` — latin subsets, published as-is

`public/fonts/FZLTTHJW-subset.woff2` (served to browsers, referenced by
`styles/base.css`, preloaded from `pages/_document.tsx`) is a subset of the
TTF: GB2312 level-1 hanzi (3755 common chars, chosen because usernames,
room names and chat are unrestricted text) + the punctuation/fullwidth
blocks + every character used by the UI strings. ~2.1 MB → ~560 KB. Rarer
characters fall back to the system CJK fonts in the body font stack.

Regenerate the subset (needs `pip install fonttools brotli`; from `web/`):

```bash
GB2312_LEVEL=1 python3 assets-src/subset_font.py
pyftsubset assets-src/FZLTTHJW.TTF \
  --output-file=public/fonts/FZLTTHJW-subset.woff2 \
  --flavor=woff2 --text-file=assets-src/font-chars.txt --layout-features='*'
```

Drop `GB2312_LEVEL=1` to also include level-2 hanzi (6763 chars total,
~1.1 MB) if chat should render in-brand more often. After adding new UI
strings with characters outside GB2312 level 1, rerun the pipeline —
`subset_font.py` picks them up from the source scan automatically.
