type iconProps = {
  className?: string;
  /** Draw a diagonal slash over the icon (not listening). */
  off?: boolean;
};

// Source: public/speaker.svg, inlined so it takes the text color.
export default function SpeakerIcon({ className, off }: iconProps) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      fill="currentColor"
      aria-hidden
      className={className ?? "h-4 w-4"}
    >
      <path d="M576 701.6v-65.6c55.2-14.4 96-64 96-124s-40.8-109.6-96-124v-65.6C666.4 337.6 736 416.8 736 512s-69.6 174.4-160 189.6z m0-568v64.8c145.6 29.6 256 159.2 256 313.6 0 154.4-110.4 284-256 313.6v64.8c181.6-30.4 320-188 320-378.4S757.6 164 576 133.6zM256 384H128v256h128l256 256V128L256 384z" />
      {off && (
        <line
          x1="160"
          y1="880"
          x2="880"
          y2="160"
          stroke="currentColor"
          strokeWidth="90"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
