/** Format a server timestamp in the browser's local timezone, using 24-hour time. */
export function formatLocalTime(timestamp: string): string {
  const date = new Date(timestamp);
  // Older servers send only H:mm, without enough information to convert it.
  if (Number.isNaN(date.getTime())) return timestamp;
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}
