import { formatLocalTime } from "../../lib/time";
import { Log } from "../../interfaces";

export default function LogMessage({ message, timestamp }: Log) {
  return (
    <div className="game-hand-log-message">
      <time>{formatLocalTime(timestamp)}</time>
      <p>{message}</p>
    </div>
  );
}
