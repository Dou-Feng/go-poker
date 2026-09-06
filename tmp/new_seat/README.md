# GoPoker Player Seat — React + TypeScript

This is the actual importable component package, not only the HTML mock.

## Files

```text
src/components/PlayerSeat/
├── PlayerSeat.tsx
├── PlayerSeat.css
├── PlayerSeat.types.ts
└── index.ts

public/assets/ui/seat/
├── gold_chip.svg
└── card_back.svg

demo/index.html
Example.tsx
README.md
```

## Import

```tsx
import { PlayerSeat } from "./components/PlayerSeat";
```

## Basic use

```tsx
<PlayerSeat
  name="Tiger"
  avatar="🐯"
  stack={1020}
  bet={10}
  state="active"
  position="bb"
  timerPercent={66}
/>
```

## State and position are independent

```ts
state: "normal" | "active" | "folded" | "allin"
position: "dealer" | "sb" | "bb" | null
```

This allows combinations such as:
- `active + bb`
- `allin + dealer`
- `folded + sb`

## Hero

```tsx
<PlayerSeat
  name="A (You)"
  avatar="🙂"
  stack={2350}
  bet={5}
  isHero
  cards={[
    { rank: "3", suit: "♠" },
    { rank: "J", suit: "♠" }
  ]}
/>
```

Default public asset URLs:
- `/assets/ui/seat/gold_chip.svg`
- `/assets/ui/seat/card_back.svg`

You can override them through `chipAssetPath` and `cardBackAssetPath`.
