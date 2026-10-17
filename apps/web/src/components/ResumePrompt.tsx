"use client";

import { PROFILES } from "@mech-vent/engine";
import { useStore } from "@/engine/store";
import { loadCase } from "@/engine/useEngine";
import { fmt, messages as m } from "@/i18n";

/** Offers the remembered last case; the app itself always opens on Normal lungs. */
export function ResumePrompt() {
  const resumable = useStore((s) => s.resumable);
  const ready = useStore((s) => s.connection === "ready");
  if (!resumable || !ready) return null;

  const dismiss = () => useStore.setState({ resumable: null });
  return (
    <div
      role="region"
      aria-label={m.resumeHeading}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-edge bg-panel px-3 py-2 sm:px-4"
    >
      <p className="text-sm text-ink-2">
        {fmt(m.resumeText, {
          profile: PROFILES[resumable.profileId].name,
          mode: resumable.settings.mode,
        })}
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => {
            loadCase(resumable);
            dismiss();
          }}
          className="rounded bg-pending px-3 py-1.5 text-sm font-medium text-chrome"
        >
          {m.resume_case}
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="rounded border border-edge px-3 py-1.5 text-sm hover:bg-chrome"
        >
          {m.dismiss}
        </button>
      </div>
    </div>
  );
}
