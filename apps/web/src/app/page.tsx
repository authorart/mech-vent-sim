import { ENGINE_CONTRACT_VERSION } from "@mech-vent/engine";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-2xl font-semibold tracking-tight">MedVent Simulator</h1>
      <p className="text-sm text-zinc-500">Engine contract v{ENGINE_CONTRACT_VERSION}</p>
    </main>
  );
}
