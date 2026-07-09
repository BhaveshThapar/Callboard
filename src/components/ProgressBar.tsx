import { cx } from "./styles";

type ProgressBarProps = {
  value: number;
  max: number;
  tone?: "primary" | "secondary";
};

export function ProgressBar({ value, max, tone = "primary" }: ProgressBarProps) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;

  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className="h-[7px] w-full overflow-hidden rounded-full bg-hover"
    >
      <div
        className={cx(
          "h-full rounded-full animate-progress-fill",
          tone === "primary" ? "bg-primary" : "bg-secondary",
        )}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
