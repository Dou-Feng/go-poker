import { PlayerSeat } from "./src/components/PlayerSeat";

export default function Example() {
  return (
    <div style={{ display: "flex", gap: 32, padding: 60, background: "#0E1319" }}>
      <PlayerSeat
        name="A (You)"
        avatar="🙂"
        stack={2350}
        bet={5}
        isHero
        cards={[{ rank: "3", suit: "♠" }, { rank: "J", suit: "♠" }]}
      />

      <PlayerSeat
        name="Tiger"
        avatar="🐯"
        stack={1020}
        bet={10}
        state="active"
        position="bb"
        timerPercent={66}
      />

      <PlayerSeat
        name="RiverMan"
        avatar="🥷"
        stack={0}
        bet={760}
        state="allin"
        position="dealer"
      />
    </div>
  );
}
