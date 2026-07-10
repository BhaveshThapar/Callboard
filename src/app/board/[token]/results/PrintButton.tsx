"use client";

import { primaryButtonClass } from "@/components/styles";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className={primaryButtonClass}>
      Print or save as PDF
    </button>
  );
}
