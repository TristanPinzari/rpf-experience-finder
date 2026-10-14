import { z } from "zod";
import { CLIENT_TYPES, SECTORS } from "../domain/taxonomy.js";
import { generateJson } from "../llm/gemini.js";

// Step 1: turn free-text RFP requirements into structured criteria.
// Hard limits (value, recency, client type) become SQL filters.
// Everything else becomes short phrases for semantic and keyword search.

export const RfpCriteria = z.object({
  summary: z.string().describe("One sentence describing the experience the RFP is asking for."),
  projectsRequested: z
    .number()
    .int()
    .nullable()
    .describe("How many projects the RFP asks for, e.g. 3. Null if not stated."),
  minValue: z
    .number()
    .nullable()
    .describe("Mandatory minimum construction value per project, in dollars. Null if none or if it is only a preference."),
  completedWithinYears: z
    .number()
    .nullable()
    .describe("Projects must have been completed within this many years. Null if not stated."),
  clientTypes: z
    .array(z.enum(CLIENT_TYPES))
    .describe(
      "Client types the RFP REQUIRES. 'public sector clients' means every type except private. Empty if the RFP does not restrict client type or accepts private owners.",
    ),
  sectors: z
    .array(z.enum(SECTORS))
    .describe("Sectors most relevant to this RFP. Used to boost ranking, never to exclude."),
  requirements: z
    .array(z.string())
    .describe(
      "Each distinct experience requirement or preference as a short standalone phrase, e.g. 'rehabilitation of highway bridges', 'construction under live traffic with staged lane closures'. Between 2 and 6 items.",
    ),
  keywords: z
    .array(z.string())
    .describe("Specific technical terms worth exact keyword matching, e.g. 'LEED', 'ICRA', 'heritage'. Can be empty."),
});
export type RfpCriteria = z.infer<typeof RfpCriteria>;

const SYSTEM = `You read the "relevant experience" section of a construction RFP and turn it into search criteria for a past-project catalog.
Only treat something as a hard limit (minValue, completedWithinYears, clientTypes) if the RFP states it as mandatory.
Preferences ("preference will be given", "rated higher") go into requirements, not hard limits.
Requirements describe the kind of work and conditions only. Do not repeat hard limits (value, dates, client type, number of projects) as requirements.`;

export async function extractCriteria(rfpText: string): Promise<RfpCriteria> {
  return generateJson({ schema: RfpCriteria, system: SYSTEM, prompt: rfpText, temperature: 0, label: "criteria" });
}
