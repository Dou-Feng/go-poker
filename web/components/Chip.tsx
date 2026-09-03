type chipProps = {
  className?: string;
};

export default function Chip({ className }: chipProps) {
  return (
    <img
      src="/chip.svg"
      alt=""
      draggable={false}
      aria-hidden
      className={className ?? "h-4 w-4"}
    />
  );
}
