import Link from "next/link";
import { notFound } from "next/navigation";
import { cardClass, cx, eyebrowClass, pillClass } from "@/components/styles";
import { compIdBySlugs, resolveBoardAccess } from "@/lib/auth/access";
import { orgOfComp } from "@/lib/auth/accounts";
import { liveConnectionFor } from "@/lib/drive/connections";
import { driveConfigured } from "@/lib/drive/google";
import { listFolder, previewImport } from "@/lib/drive/import";
import { sealingConfigured } from "@/lib/drive/sealed";
import { DriveConnection } from "./DriveConnection";
import { ImportConfirm } from "./ImportConfirm";

export const dynamic = "force-dynamic";

const describeProblem = (problem: {
  kind: string;
  column?: string;
  raw?: string;
  of?: number;
}): string => {
  switch (problem.kind) {
    case "missing-name":
      return "no team name";
    case "unreadable-number":
      return `${problem.column === "rooms" ? "rooms" : "dancers"} unreadable: "${problem.raw}"`;
    case "unreadable-email":
      return `not an email: "${problem.raw}"`;
    case "duplicate-name":
      return `same name as row ${problem.of}`;
    default:
      return problem.kind;
  }
};

/**
 * A11's on-ramp, and the rule it must not break: **read, preview, confirm.**
 *
 * Nothing here writes. The board pastes a folder link, picks a file, and sees exactly what importing
 * would do — including the rows that cannot be imported and why. Confirming re-reads the sheet
 * rather than trusting a posted list of teams, so there is one source of truth for what the
 * spreadsheet said and no way to post a roster this page never showed.
 *
 * Onboarding only, one-directional. PRD A11: *Drive is the on-ramp, never the backend.*
 */
export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; comp: string }>;
  searchParams: Promise<{ folder?: string; file?: string; name?: string; mime?: string }>;
}) {
  const { org, comp } = await params;
  const query = await searchParams;
  const base = `/app/${org}/${comp}`;

  const compId = await compIdBySlugs(org, comp);
  if (!compId) notFound();

  const actor = await resolveBoardAccess(compId);
  if (!actor) notFound();

  const orgId = await orgOfComp(compId);
  const connection = orgId ? await liveConnectionFor(orgId) : null;
  const configured = driveConfigured() && sealingConfigured();

  const files = connection && query.folder ? await listFolder(actor, query.folder) : null;

  const chosen =
    connection && query.file && query.name && query.mime
      ? await previewImport(actor, {
          id: query.file,
          name: query.name,
          mimeType: query.mime,
        })
      : null;

  return (
    <div className="max-w-4xl">
      <header className="mb-6">
        <p className={eyebrowClass}>Import a roster</p>
        <h2 className="mt-1.5 text-card font-semibold text-heading">From Google Drive</h2>
        <p className="mt-1 text-caption text-muted">
          One-directional and for onboarding: this reads a sheet you already keep. Drive is never the
          backend, and nothing is written until you confirm it.
        </p>
      </header>

      {!configured && (
        <div className={cx(cardClass, "mb-6")} data-testid="drive-unconfigured">
          <p className="text-body text-heading">Google Drive is not set up on this deployment.</p>
          <p className="mt-1 text-caption text-muted">
            It needs <code>GOOGLE_CLIENT_ID</code>, <code>GOOGLE_CLIENT_SECRET</code> and{" "}
            <code>DRIVE_TOKEN_KEY</code>. Without the last one a refresh token would have to be
            stored in the clear, so connecting is refused rather than downgraded.
          </p>
        </div>
      )}

      {configured && (
        <div className={cx(cardClass, "mb-6")} data-testid="drive-connection">
          {connection ? (
            <DriveConnection
              compId={compId}
              basePath={base}
              email={connection.googleEmail}
              connectedAt={connection.connectedAt.toISOString().slice(0, 10)}
              reconnectHref={`/api/drive/connect?org=${org}&comp=${comp}`}
            />
          ) : (
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <p className="text-body text-muted">No Google account is connected yet.</p>
              <a
                href={`/api/drive/connect?org=${org}&comp=${comp}`}
                data-testid="drive-connect"
                className="rounded bg-primary px-3 py-1.5 text-caption font-medium text-white hover:opacity-90"
              >
                Connect Google Drive
              </a>
            </div>
          )}
        </div>
      )}

      {connection && (
        <form method="get" className={cx(cardClass, "mb-6 flex flex-wrap items-end gap-3")}>
          <div className="grow">
            <label className="block text-caption text-muted" htmlFor="folder">
              Paste the Drive folder link
            </label>
            <input
              id="folder"
              name="folder"
              defaultValue={query.folder ?? ""}
              placeholder="https://drive.google.com/drive/folders/..."
              data-testid="drive-folder"
              className="mt-1 w-full rounded border border-border bg-transparent px-2 py-1.5 text-body text-heading focus:border-primary focus:outline-none"
            />
          </div>
          <button
            type="submit"
            data-testid="drive-list"
            className="rounded border border-border px-3 py-1.5 text-caption text-muted hover:border-primary hover:text-primary"
          >
            List files
          </button>
        </form>
      )}

      {files && !files.ok && (
        <p className="mb-6 text-caption text-danger" data-testid="drive-error">
          {files.message}
        </p>
      )}

      {files?.ok && (
        <ul className={cx(cardClass, "mb-6 flex flex-col gap-2")} data-testid="drive-files">
          {files.files.map((file) => (
            <li key={file.id} className="flex items-center justify-between gap-3">
              <span className="text-body text-heading">{file.name}</span>
              <Link
                href={`${base}/import?folder=${encodeURIComponent(query.folder ?? "")}&file=${file.id}&name=${encodeURIComponent(file.name)}&mime=${encodeURIComponent(file.mimeType)}`}
                data-testid={`drive-preview-${file.id}`}
                className="text-caption text-primary underline-offset-2 hover:underline"
              >
                Preview →
              </Link>
            </li>
          ))}
        </ul>
      )}

      {chosen && !chosen.ok && (
        <p className="mb-6 text-caption text-danger" data-testid="drive-preview-error">
          {chosen.message}
        </p>
      )}

      {chosen?.ok && (
        <div className={cardClass} data-testid="drive-preview">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="text-card font-semibold text-heading">{chosen.value.file.name}</h3>
            <span className="text-caption text-subtle">
              {chosen.value.candidates.length} rows ·{" "}
              {chosen.value.candidates.filter((c) => c.problems.length === 0).length} clean
            </span>
          </div>

          <p className="mt-2 text-caption text-muted" data-testid="drive-mapping">
            Read as:{" "}
            {Object.entries(chosen.value.mapping)
              .map(([field, header]) => `${header} → ${field}`)
              .join(", ")}
            {chosen.value.unmappedHeaders.length > 0 && (
              <> · ignored: {chosen.value.unmappedHeaders.join(", ")}</>
            )}
          </p>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-body">
              <thead>
                <tr className="border-b border-border">
                  <th className={cx(eyebrowClass, "pb-2 text-left")}>Row</th>
                  <th className={cx(eyebrowClass, "pb-2 text-left")}>Team</th>
                  <th className={cx(eyebrowClass, "pb-2 text-left")}>School</th>
                  <th className={cx(eyebrowClass, "pb-2 text-left")}>Dancers</th>
                  <th className={cx(eyebrowClass, "pb-2 text-left")}>Captain</th>
                  <th className={cx(eyebrowClass, "pb-2 text-left")}>Notes</th>
                </tr>
              </thead>
              <tbody>
                {chosen.value.candidates.map((candidate) => (
                  <tr
                    key={candidate.row}
                    data-testid={`drive-row-${candidate.row}`}
                    className="border-b border-border-soft/60"
                  >
                    <td className="tabular py-2 pr-3 text-subtle">{candidate.row}</td>
                    <td className="py-2 pr-3 text-heading">{candidate.name || "—"}</td>
                    <td className="py-2 pr-3 text-muted">{candidate.school ?? "—"}</td>
                    <td className="tabular py-2 pr-3 text-muted">{candidate.rosterSize ?? "—"}</td>
                    <td className="py-2 pr-3 text-muted">{candidate.contactEmail ?? "—"}</td>
                    <td className="py-2">
                      {candidate.problems.length === 0 ? (
                        <span className="text-caption text-subtle">—</span>
                      ) : (
                        <span className={cx(pillClass, "bg-secondary-light text-secondary")}>
                          {candidate.problems.map(describeProblem).join("; ")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {chosen.value.alreadyPresent.length > 0 && (
            <p className="mt-3 text-caption text-secondary" data-testid="drive-already">
              Already on this comp: {chosen.value.alreadyPresent.join(", ")}. Importing again would
              create a second team with the same name.
            </p>
          )}

          <ImportConfirm
            compId={compId}
            basePath={base}
            file={chosen.value.file}
            importable={chosen.value.candidates.filter((c) => c.problems.length === 0).length}
          />
        </div>
      )}
    </div>
  );
}
