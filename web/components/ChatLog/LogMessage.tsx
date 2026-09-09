import { Log } from "../../interfaces";

export default function LogMessage({ message, timestamp }: Log) {
  return (
    <div className="game-hand-log-message">
      <time>{timestamp}</time>
      <p>{message}</p>
    </div>
  );
}
