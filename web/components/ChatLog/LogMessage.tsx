import { formatLocalTime } from "../../lib/time";
import { useTranslation } from "../../hooks/useTranslation";
import { Log } from "../../interfaces";

export default function LogMessage({ log }: { log: Log }) {
  const { tLog } = useTranslation();
  return (
    <div className="game-hand-log-message">
      <time>{formatLocalTime(log.timestamp)}</time>
      <p>{tLog(log)}</p>
    </div>
  );
}
