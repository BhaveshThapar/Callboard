export const cx = (...parts: Array<string | false | null | undefined>): string =>
  parts.filter(Boolean).join(" ");

export const cardClass = "rounded-card border border-border bg-surface p-5 shadow-card";

export const inputClass =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-body text-heading placeholder:text-subtle focus:border-primary focus:outline-none";

export const buttonClass =
  "rounded-md border border-border bg-surface px-4 py-2 text-card font-medium text-heading transition-colors hover:bg-hover disabled:opacity-40";

/** Reversible actions: submit a score, apply a deduction. */
export const primaryButtonClass =
  "rounded-md bg-primary px-4 py-2 text-card font-medium text-on-primary transition-opacity hover:opacity-90 disabled:opacity-40";

/** The lock is irreversible, so it does not wear the same green as everything else. */
export const lockButtonClass =
  "rounded-md bg-heading px-4 py-2 text-card font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40";

export const pillClass = "rounded px-1.5 py-0.5 text-caption font-semibold";

export const eyebrowClass = "text-caption font-medium uppercase tracking-wide text-subtle";
