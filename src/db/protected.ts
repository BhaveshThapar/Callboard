const DEFAULT_PROTECTED_COMPUTE_ID = "ep-round-fire-a6dyy8t8";

export const protectedComputeId = (): string =>
  process.env.CALLBOARD_PROTECTED_COMPUTE_ID || DEFAULT_PROTECTED_COMPUTE_ID;

export const hostnameOf = (connectionString: string): string | undefined => {
  try {
    return new URL(connectionString).hostname;
  } catch {
    return undefined;
  }
};

/**
 * True when the connection string names the Neon compute backing the deployed demo.
 * A compute id is a hostname component, not a credential, so it is safe to commit.
 *
 * Every spelling of the host — pooled, unpooled, and per-binding (`-fwr`, `-fwr-pooler`) —
 * begins with the compute id, delimited by `.` or `-`.
 *
 * When the URL will not parse, fall back to a substring test: a guard that cannot read its
 * input must not fail open.
 */
export const isProtectedDatabase = (connectionString: string | undefined): boolean => {
  if (!connectionString) return false;

  const computeId = protectedComputeId();
  const host = hostnameOf(connectionString);
  if (host === undefined) return connectionString.includes(computeId);

  return (
    host === computeId || host.startsWith(`${computeId}.`) || host.startsWith(`${computeId}-`)
  );
};
