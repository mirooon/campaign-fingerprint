import { connection } from "next/server";
import { Suspense } from "react";
import Viewer from "@/components/viewer/Viewer";
import { loadViewerData } from "@/lib/viewer/data";

/** Reads the pipeline outputs on every request: a new run (or VIEWER_DATA_DIR) shows up without a rebuild. */
async function ViewerWithData() {
  await connection();
  const { graph, campaigns, summaries, error } = loadViewerData();
  if (!graph || !campaigns) {
    return (
      <main className="mx-auto max-w-xl p-10">
        <h1 className="text-lg font-semibold">Graf kampanii</h1>
        <p className="mt-2 text-sm text-slate-600">{error}</p>
      </main>
    );
  }
  return <Viewer graph={graph} campaigns={campaigns} summaries={summaries} />;
}

export default function Home() {
  return (
    <Suspense fallback={<p className="p-6 text-sm text-slate-500">Wczytywanie grafu…</p>}>
      <ViewerWithData />
    </Suspense>
  );
}
