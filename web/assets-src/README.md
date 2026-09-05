# Design sources (not published)

Files here are kept for reference and regeneration only; they are not part of
the static export. Derivatives served to the browser live in `public/`.

## Background wallpaper

- `bg_4k.png` — landscape design source (1672×941, 16:9)
- `bg_portal.png` — portrait design source (1320×2868, ~9:19.5)

The page uses compressed WebP derivatives, selected by the orientation/width
media queries in `styles/index.css`: `public/bg-portrait.webp` (portrait
screens), `public/bg-1100.webp` (small landscape), `public/bg-1672.webp`
(landscape ≥700px).

Regenerate the derivatives (sharp-cli):

```bash
npx sharp-cli -i assets-src/bg_4k.png     -o public/bg-1100.webp    --quality 85 resize 1100
npx sharp-cli -i assets-src/bg_4k.png     -o public/bg-1672.webp    --quality 92
npx sharp-cli -i assets-src/bg_portal.png -o public/bg-portrait.webp --quality 85
```
