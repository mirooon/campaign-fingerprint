import { connection } from "next/server";
import { Suspense } from "react";
import Shell from "@/components/viewer/Shell";
import { loadViewerData, SAMPLE_BASE } from "@/lib/viewer/data";

/** Reads the pipeline outputs on every request: a new run (or VIEWER_DATA_DIR) shows up without a rebuild. */
async function ViewerWithData() {
  await connection();
  const { graph, campaigns, nearMisses, summaries, error } = loadViewerData();
  if (!graph || !campaigns) {
    return (
      <main className="mx-auto max-w-xl p-10">
        <h1 className="text-lg font-semibold">Graf kampanii</h1>
        <p className="mt-2 text-sm text-slate-600">{error}</p>
      </main>
    );
  }
  return <Shell graph={graph} campaigns={campaigns} nearMisses={nearMisses} summaries={summaries} synthetic={SAMPLE_BASE} />;
}

export default function Home() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-slate-500">Wczytywanie grafu…</p>}>
      <ViewerWithData />
    </Suspense>
  );
}
