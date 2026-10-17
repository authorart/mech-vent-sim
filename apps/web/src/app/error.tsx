"use client";

/** Keeps a render error from blanking the simulator; offers a restart. */
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <main className="m-auto max-w-prose p-8">
      <h1 className="text-xl font-semibold">The simulator display stopped</h1>
      <p className="mt-2 text-ink-2">{error.message}</p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded bg-pending px-4 py-2 font-medium text-chrome"
      >
        Restart the display
      </button>
    </main>
  );
}
