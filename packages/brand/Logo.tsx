// Design A wordmark: "hire" + marker-highlighted "juniors" (Schibsted 800,
// ink). Mark-only variant: rounded marker square with "hj" in marker-ink.
const FONT = "'Schibsted Grotesk Variable','Schibsted Grotesk',sans-serif";

export function Logo({ size = 22, wordmark = false }: { size?: number; wordmark?: boolean }) {
  if (wordmark) {
    return (
      <span
        className="font-display lowercase"
        style={{ fontWeight: 800, letterSpacing: "-0.02em", fontSize: size, lineHeight: 1 }}
      >
        hire
        <span className="marker" style={{ marginLeft: 2 }}>
          juniors
        </span>
      </span>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" rx={7} fill="var(--marker)" />
      <text
        x="16"
        y="22"
        textAnchor="middle"
        fontFamily={FONT}
        fontWeight={800}
        fontSize={17}
        letterSpacing={-0.5}
        fill="var(--marker-ink)"
      >
        hj
      </text>
    </svg>
  );
}
