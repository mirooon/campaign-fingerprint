/**
 * Integration contract: the synthetic example and a real `analyzeMaterial` result validate against the
 * schemas, and the committed docs/schema files are the ones the code generates.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { analyzeMaterial } from "../lib/pipeline/analyzeMaterial";
import { CONTRACT_SCHEMAS, contractJsonSchema, InputFileSchema, MaterialResultSchema } from "../lib/pipeline/contract";
import { compileWatchlist, loadWatchlist } from "../lib/text/persona";
import { runSample, SAMPLE, sampleItems } from "./sampleRun";

let root: string;
let run: Awaited<ReturnType<typeof runSample>>;

beforeAll(async () => {
  run = await runSample();
  root = mkdtempSync(path.join(os.tmpdir(), "contract-"));
  const data = path.join(root, "run");
  mkdirSync(data);
  writeFileSync(path.join(data, "enriched.json"), JSON.stringify(run.ds));
  writeFileSync(path.join(data, "campaigns.json"), JSON.stringify(run.campaigns));
  writeFileSync(path.join(data, "graph.json"), JSON.stringify(run.graph));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("integration contract", () => {
  it("accepts the synthetic example and rejects a score outside 0..1 and an unknown column", () => {
    const example = JSON.parse(readFileSync("docs/schema/example-input.json", "utf8"));
    expect(InputFileSchema.safeParse(example).success).toBe(true);
    expect(InputFileSchema.safeParse([{ id: "x", deepfakeScore: 1.5 }]).success).toBe(false);
    expect(InputFileSchema.safeParse([{ id: "x", nieznana: "kolumna" }]).success).toBe(false);
  });

  it("validates the result of analyze-material", async () => {
    const landing = sampleItems().items.find((it) => it.landingUrl)!;
    const res = await analyzeMaterial(
      { url: landing.landingUrl!, text: landing.text ?? undefined },
      {
        dataDir: path.join(root, "run"),
        workDir: path.join(root, "w"),
        fixtures: path.join(SAMPLE, "fixtures"),
        config: run.config,
        personas: compileWatchlist(loadWatchlist(path.join(SAMPLE, "personas.json"))),
        media: { ocr: false },
      },
    );
    const parsed = MaterialResultSchema.safeParse(JSON.parse(JSON.stringify(res)));
    expect(parsed.error?.issues).toBeUndefined();
    expect(parsed.success).toBe(true);
  });

  it("keeps docs/schema in step with the schemas in the code", () => {
    for (const name of Object.keys(CONTRACT_SCHEMAS) as Array<keyof typeof CONTRACT_SCHEMAS>) {
      expect(JSON.parse(readFileSync(path.join("docs/schema", name), "utf8"))).toEqual(contractJsonSchema(name));
    }
  });
});
