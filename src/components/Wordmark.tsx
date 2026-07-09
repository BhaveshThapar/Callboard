export function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary">
        <svg viewBox="0 0 24 24" className="size-4 text-white" aria-hidden fill="currentColor">
          <rect x="3" y="4" width="7" height="7" rx="1.5" />
          <rect x="14" y="4" width="7" height="4" rx="1.5" opacity="0.65" />
          <rect x="14" y="11" width="7" height="9" rx="1.5" />
          <rect x="3" y="14" width="7" height="6" rx="1.5" opacity="0.65" />
        </svg>
      </div>
      <span className="text-[17px] font-bold tracking-tight text-heading">Callboard</span>
    </div>
  );
}
