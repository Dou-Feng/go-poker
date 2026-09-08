import { Game } from "../interfaces";

export function spectatorSeatState(
  game: Game,
  accountUuid: string | null,
  chips: number | null
) {
  const reservation = game.reserved.find((r) => r.accountUuid === accountUuid);
  const occupied = new Set([
    ...game.players.map((p) => p.seatID),
    ...game.reserved.map((r) => r.seatID),
  ]);
  let seatID = 0;
  for (let id = 1; id <= game.config.maxPlayers; id++) {
    if (!occupied.has(id)) {
      seatID = id;
      break;
    }
  }
  const blocked: "bustedOut" | "notEnoughChips" | "tableIsFull" | null =
    game.busted
      ? "bustedOut"
      : chips !== null && chips < game.config.buyIn
      ? "notEnoughChips"
      : !seatID
      ? "tableIsFull"
      : null;
  return { reservation, seatID, blocked };
}
