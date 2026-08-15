"use client";

import { useActionState } from "react";
import { cx } from "@/components/styles";
import type { DriveFile } from "@/lib/drive/google";
import { importDriveRosterAction } from "../actions";
import { ScopeFields } from "../ScopeFields";
import { IDLE } from "../state";

/**
 * The confirm step, and it posts a **file reference rather than a roster**.
 *
 * The server re-reads and re-parses the sheet before writing, so what lands is what the spreadsheet
 * says rather than what a form claimed it said. That keeps one source of truth for the import and
 * means this component cannot be edited into inserting teams the preview never displayed.
 */
export function ImportConfirm({
  compId,
  basePath,
  file,
  importable,
}: {
  compId: string;
  basePath: string;
  file: DriveFile;
  importable: number;
}) {
  const [state, action, pending] = useActionState(importDriveRosterAction, IDLE);

  return (
    <form action={action} className="mt-5 flex flex-wrap items-center gap-3">
      <ScopeFields scope={{ compId, basePath }} />
      <input type="hidden" name="fileId" value={file.id} />
      <input type="hidden" name="fileName" value={file.name} />
      <input type="hidden" name="fileMime" value={file.mimeType} />

      <button
        type="submit"
        disabled={pending || importable === 0}
        data-testid="drive-import-submit"
        className="rounded bg-primary px-3 py-1.5 text-caption font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        {pending ? "Importing…" : `Import ${importable} team${importable === 1 ? "" : "s"}`}
      </button>

      <span className="text-caption text-subtle">
        They arrive as <strong>applied</strong>, so nothing is billed until you accept them.
      </span>

      {state.message && (
        <p
          role="status"
          data-testid="drive-import-message"
          className={cx("w-full text-caption", state.status === "error" ? "text-danger" : "text-muted")}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
