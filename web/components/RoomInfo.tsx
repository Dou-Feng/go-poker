import { useContext } from "react";
import { FiX } from "react-icons/fi";
import Portal from "./Portal";
import ui from "../styles/Dialog.module.css";
import { AppContext } from "../providers/AppStore";
import { useTranslation } from "../hooks/useTranslation";

type RoomInfoProps = {
  onClose: () => void;
};

// Room details panel opened from the top-centre hands pill: name, game mode
// (tournament vs. cash), blinds, buy-in, seats, hands limit, password
// presence and creation time.
export default function RoomInfo({ onClose }: RoomInfoProps) {
  const { appState } = useContext(AppContext);
  const { t } = useTranslation();
  const game = appState.game;
  if (!game) {
    return null;
  }
  const cfg = game.config;
  const tournament = cfg.maxBuy > 0;
  const played = Math.min(game.handsPlayed + 1, cfg.handsLimit || Infinity);
  const handsText = `${played} / ${cfg.handsLimit > 0 ? cfg.handsLimit : "∞"}`;
  const turnText =
    game.actionTimeout > 0 ? `${game.actionTimeout}s` : t("unlimited");
  const createdText = game.createdAt
    ? new Date(game.createdAt).toLocaleString()
    : "—";

  const rows: Array<[string, string]> = [
    [t("roomName"), appState.table ?? "—"],
    [t("roomMode"), tournament ? t("tournament") : t("modeCash")],
    [t("blinds"), `${cfg.sb} / ${cfg.bb}`],
    [t("buyIn"), `${cfg.buyIn}`],
    [t("maxPlayers"), `${cfg.maxPlayers}`],
    [t("hands"), handsText],
    [
      t("roomPassword"),
      game.locked ? t("roomPasswordYes") : t("roomPasswordNo"),
    ],
    [t("roomTurnClock"), turnText],
    [t("roomCreated"), createdText],
  ];

  return (
    <Portal>
      <div className={ui.overlay} onClick={onClose}>
        <div
          className={`${ui.dialog} room-info-dialog`}
          role="dialog"
          aria-modal="true"
          aria-label={t("roomInfo")}
          onClick={(e) => e.stopPropagation()}
        >
          <div className={ui.dialogHeader}>
            <h2>{t("roomInfo")}</h2>
            <button
              onClick={onClose}
              data-sfx="back"
              aria-label={t("close")}
              className={ui.iconButton}
            >
              <FiX />
            </button>
          </div>
          <dl className="room-info-list">
            {rows.map(([label, value]) => (
              <div className="room-info-row" key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </Portal>
  );
}
