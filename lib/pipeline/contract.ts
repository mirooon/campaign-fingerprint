/**
 * Integration contract (version CONTRACT_VERSION): what an institution's system hands to the tool
 * (one record per material) and what `analyze-material --json` returns (MaterialResult). Zod schemas
 * are the source of truth; docs/schema/*.json are generated from them (`bun run contract-schema`).
 * Nested details of the result (links, pivots, features) are described loosely on purpose: the stable
 * part of the contract is the verdict, the campaigns and the premises, not every diagnostic field.
 */
import { z } from "zod";

/** Version of the contract; raised when a field is removed or changes meaning (adding an optional field does not). */
export const CONTRACT_VERSION = "1.0";

/** One material as an institution's system may export it (CSV or JSON row); the column names are also read in the synonyms listed in `lib/pipeline/ingest.ts`. */
export const InputRecordSchema = z
  .object({
    id: z.string().min(1).describe("Identifier of the material in the institution's system."),
    platform: z.string().nullable().optional().describe("Platform of the ad (e.g. facebook)."),
    advertiser: z.string().nullable().optional(),
    text: z.string().nullable().optional().describe("Text of the ad."),
    imageUrl: z.string().nullable().optional(),
    imagePath: z.string().nullable().optional().describe("Screenshot or creative, relative to the file."),
    landingUrl: z.string().nullable().optional().describe("Link the ad leads to."),
    firstSeen: z.string().nullable().optional().describe("ISO 8601."),
    lastSeen: z.string().nullable().optional().describe("ISO 8601."),
    persona: z.string().nullable().optional().describe("Impersonated person from the institution's system (several separated by ; or |)."),
    deepfakeScore: z.number().min(0).max(1).nullable().optional().describe("Deepfake score of an external detector, 0..1: a model output, not a fact."),
    videoPath: z.string().nullable().optional(),
  })
  .strict();
export type InputRecord = z.infer<typeof InputRecordSchema>;

/** Batch input: a list of records. */
export const InputFileSchema = z.array(InputRecordSchema);

const EvidenceSchema = z.looseObject({
  evidence: z.string(),
  weight: z.number(),
  strong: z.boolean(),
  discounted: z.boolean(),
});

const LinkSchema = z.looseObject({
  other: z.string(),
  otherCampaign: z.string().nullable(),
  score: z.number(),
  strong: z.boolean(),
  rule: z.string(),
  evidence: z.array(EvidenceSchema),
});

const ItemResultSchema = z.looseObject({
  id: z.string(),
  caseId: z.string().optional(),
  verdict: z.enum(["known_campaign", "similar_campaigns", "new_campaign", "duplicate", "insufficient"]),
  verdictText: z.string(),
  campaign: z.string().nullable(),
  similarCampaigns: z.array(z.string()),
  apart: z.array(z.string()),
  withNew: z.array(z.string()),
  newCampaign: z.string().nullable().optional(),
  duplicateOf: z.looseObject({ id: z.string(), reason: z.string() }).optional(),
  missing: z.array(z.string()).optional(),
  links: z.array(LinkSchema),
  features: z.record(z.string(), z.unknown()),
  errors: z.array(z.string()),
});

/** Output of `analyze-material --json`: one result per material plus the report of the steps. */
export const MaterialResultSchema = z.looseObject({
  mode: z.enum(["offline", "hybrid"]),
  items: z.array(ItemResultSchema),
  newCampaigns: z.array(z.object({ id: z.string(), members: z.array(z.string()), evidence: z.array(z.string()) })).optional(),
  skipped: z.array(z.object({ id: z.string(), reason: z.string() })),
  steps: z.array(z.looseObject({ caseId: z.string(), step: z.string(), status: z.string() })),
  notes: z.array(z.string()),
});

/** The schemas written to docs/schema, by file name. */
export const CONTRACT_SCHEMAS = {
  "input-file.schema.json": InputFileSchema,
  "material-result.schema.json": MaterialResultSchema,
} as const;

/** JSON Schema (draft 2020-12) of a contract schema with `$id` and the contract version. */
export function contractJsonSchema(name: keyof typeof CONTRACT_SCHEMAS): Record<string, unknown> {
  const base = z.toJSONSchema(CONTRACT_SCHEMAS[name]);
  return { ...base, $id: `https://odcisk-kampanii.example/schema/v${CONTRACT_VERSION}/${name}`, "x-contract-version": CONTRACT_VERSION };
}
