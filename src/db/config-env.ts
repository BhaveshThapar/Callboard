import { sendingConfigured } from "@/lib/comms/transport";
import { driveConfigured } from "@/lib/drive/google";
import { sealingConfigured } from "@/lib/drive/sealed";
import type { ConfigObserved } from "./health";

/**
 * Which variables belong to *only* Drive.
 *
 * `googleConfig()` also requires `NEXT_PUBLIC_BASE_URL`, but that is a shared variable every
 * deployment sets for its own reasons — so its presence must never be read as somebody having
 * started to configure Drive. Getting that wrong made `db:doctor` exit 1 on every developer laptop,
 * which is the crying-wolf failure the caveat/hazard split exists to avoid, arriving through the
 * split itself.
 */
const DRIVE_OWN = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const;
const DRIVE_ALL = [...DRIVE_OWN, "NEXT_PUBLIC_BASE_URL"] as const;
const SENDING = ["RESEND_API_KEY", "COMMS_FROM"] as const;

/**
 * This process's configuration, read once so the CLI and `/api/health` cannot drift apart.
 *
 * **It does not re-derive "is sending on".** `sendingConfigured`, `driveConfigured` and
 * `sealingConfigured` stay the one definition of each; this adds only the tri-state around them,
 * because a preflight has to distinguish *nobody set this* from *somebody set half of it* and a
 * boolean cannot. Those three modules import nothing near `next/headers`, which is what lets this
 * file be shared by a route handler and a CLI with no request behind it.
 *
 * `source` is not set here: whose environment this is, is the caller's fact to state.
 */
export const readConfigEnv = (): Omit<ConfigObserved, "source"> => {
  const sendingMissing = SENDING.filter((name) => !process.env[name]);
  const driveMissing = DRIVE_ALL.filter((name) => !process.env[name]);
  const driveStarted = DRIVE_OWN.some((name) => process.env[name]);

  // `sealingConfigured` is false for two different reasons — unset, and set to something that is not
  // 32 bytes — and they need opposite sentences: one is the correct default, the other is an
  // afternoon somebody already spent. So the length is read here rather than inferred.
  const rawSealingKey = process.env.DRIVE_TOKEN_KEY;
  const sealing = sealingConfigured() ? "on" : rawSealingKey ? "unusable" : "off";

  return {
    sending: sendingConfigured() ? "on" : sendingMissing.length === SENDING.length ? "off" : "partial",
    sendingMissing,
    cron: Boolean(process.env.CRON_SECRET),
    baseUrl: Boolean(process.env.NEXT_PUBLIC_BASE_URL),
    drive: driveConfigured() ? "on" : driveStarted ? "partial" : "off",
    driveMissing: driveStarted ? driveMissing : [],
    sealing,
    sealingKeyBytes:
      sealing === "unusable" ? Buffer.from(rawSealingKey ?? "", "base64").length : null,
  };
};
