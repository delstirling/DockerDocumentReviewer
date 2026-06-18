"use client";

import React from "react";

export default function TextExtractingOverlay({
  status = "Text Extracting…",
  substatus,
}: {
  status?: string;
  substatus?: string | null;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      aria-live="polite"
      aria-busy="true"
      role="status"
    >
      <div className="flex flex-col items-center rounded-lg bg-black/70 px-6 py-5">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-white/60 border-t-transparent mb-3" />
        <p className="text-white text-lg font-semibold">{status}</p>
        {substatus ? (
          <p className="text-white/80 text-sm mt-1">{substatus}</p>
        ) : null}
      </div>
    </div>
  );
}
