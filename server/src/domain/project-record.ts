import { z } from "zod";
import { CLIENT_TYPES, DELIVERY_METHODS, SECTORS } from "./taxonomy.js";

export const ISSUE_SEVERITIES = ["conflict", "uncertain", "missing"] as const;

// One structured record per project, extracted by the LLM from all of the
// project's documents. Every important field carries the filename it came
// from, so any value in the catalog can be traced back to a source document.

const sourced = <T extends z.ZodType>(value: T, description: string) =>
  z.object({
    value: value.nullable().describe(`${description} Null if no document states it.`),
    source: z
      .string()
      .nullable()
      .describe("Exact filename of the document the value was taken from, or null."),
  });

export const ExtractedProject = z.object({
  name: sourced(z.string(), "The project's full formal name."),
  aliases: z.array(z.string()).describe("Other names or abbreviations used for the project in the documents."),
  client: sourced(z.string(), "The owner or client organization that contracted the work."),
  clientType: sourced(
    z.enum(CLIENT_TYPES),
    "Who the contract was with. federal = federal departments, agencies and crown corporations. provincial = provincial ministries and provincial agencies (e.g. a provincial transit agency). municipal = cities, towns, regions. broader_public_sector = school boards, hospitals, colleges and universities, and publicly funded non-profits such as community health centres. private = companies and developers; a private owner stays private even if it receives government funding.",
  ),
  sector: sourced(z.enum(SECTORS), "The type of facility or infrastructure built."),
  location: sourced(
    z.string(),
    "City or town where the work was done, as 'City, ON', e.g. 'Guelph, ON'. The company works in Ontario, so assume ON when the province is not written. If only the client municipality is named (e.g. 'City of Westhaven'), use that city.",
  ),
  originalValue: sourced(z.number(), "Original contract price at award, in dollars, e.g. 8400000."),
  finalValue: sourced(
    z.number(),
    "Final contract value in dollars after all change orders. Prefer the latest, most complete figure (usually a final change order log) over earlier reports.",
  ),
  startDate: sourced(z.string(), "Construction start as YYYY-MM."),
  completionDate: sourced(z.string(), "Actual substantial completion as YYYY-MM (not the originally scheduled date)."),
  deliveryMethod: sourced(z.enum(DELIVERY_METHODS), "Contract delivery method."),
  scopeSummary: z.string().describe("Two or three sentences describing the work, written for a proposal."),
  features: z
    .array(z.string())
    .describe(
      "Short tags for notable conditions relevant to future bids, e.g. 'occupied building', 'live traffic', 'heritage restoration', 'LEED Gold', 'security clearance'.",
    ),
  keyPersonnel: z.array(z.object({ role: z.string(), name: z.string() })),
  issues: z
    .array(
      z.object({
        field: z.string(),
        severity: z
          .enum(ISSUE_SEVERITIES)
          .describe(
            "conflict = documents state different values for the same fact. uncertain = the value used is approximate ('approximately', 'nearly') or inferred. missing = no document states it.",
          ),
        description: z.string(),
      }),
    )
    .describe(
      "Problems a reviewer should know about. Do NOT report: a rounded figure such as '$9.2M' (that is exact enough), or a difference between a scheduled and an actual date (always use the actual date; that is normal, not a problem).",
    ),
});

export type ExtractedProject = z.infer<typeof ExtractedProject>;

/** Fields whose absence makes a record unusable for filtering, so it needs human review. */
export const KEY_FIELDS = ["clientType", "sector", "finalValue", "completionDate"] as const;
