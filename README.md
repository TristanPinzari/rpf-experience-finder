# RFP Experience Finder (prototype)

Finds the most relevant past projects for a new RFP's "relevant experience" section, using a construction company's document archive.

> **All data in this repository is synthetic.** The company, clients, projects and people are fictional.

## Architecture in one paragraph

An ingestion step reads every project folder and uses an LLM to extract one **structured record per project**: client, client type, sector, values, dates and scope. Each field records which document it came from. Documents are also split into chunks and embedded for **semantic search**. At query time the user pastes RFP requirements. The system extracts the hard criteria and filters the catalog on them. It then ranks the survivors with hybrid keyword and vector search, and the LLM writes a justification for each pick, citing source chunks.

| Prototype | Production equivalent |
|---|---|
| Text files in `data/archive/` | SharePoint, read through Microsoft Graph with delta queries |
| File hashing to skip unchanged files | Graph delta queries |
| Plain-text documents | Azure AI Document Intelligence for PDFs and scans |
| SQLite with FTS5 and in-memory cosine search | Azure AI Search, hybrid search with filters |
| Gemini API free tier | Azure OpenAI in a Canadian region |
| One-off ingestion script | Scheduled sync job, for example Temporal or Azure Functions |

## Setup and running the demo

1. Install Node 22 or newer.
2. Get a Gemini API key at https://aistudio.google.com/apikey.
3. Copy `.env.example` to `.env` and paste the key in.
4. Run `npm run setup` to install dependencies.
5. Run `npm run ingest` to build the catalog. The archive is already included.
6. Run `npm start`, then open http://localhost:3001.

For frontend development, run `npm run server` and `npm run web` in two terminals, then open http://localhost:5173.

The Gemini free tier may use your inputs to improve Google's products. That is fine for synthetic data. Real client data would go through a paid, region-hosted service.

## Build stages

### Stage 1: synthetic archive (done)

The archive in `data/archive/` is already included: 92 messy documents, one folder per project. They were written directly from the spec, because the Gemini free-tier quota ran out during generation. Every planted quirk was checked to be in the intended file.

To regenerate the archive with Gemini instead, use a key with billing enabled:

```
npm run generate -- --force
```

**Files to read, in this order:**

1. `data/spec/projects.json` is the ground truth: 30 fictional projects. Each has a `quirks` field telling the generator where to make documents messy. Examples include a final value that appears only in the change order log, a completion report that contradicts the change order log, and a project called by three different names.
2. `data/spec/past-rfps.json` holds 7 historical RFPs and the projects the company actually listed for each. This is the test set for Stage 5. `asOf` is the RFP date, so projects finished after it don't count.
3. `server/src/domain/taxonomy.ts` defines the fixed vocabularies: client types, sectors, delivery methods. Fixed categories, rather than free text, are what make the catalog filterable.
4. `server/src/llm/gemini.ts` is the only file that talks to Gemini. Two ideas matter here:
   - **Throttling and retries.** The free tier allows only a few requests per minute, so calls are spaced out and rate-limit errors are retried.
   - **Structured output.** A Zod schema is converted to JSON Schema and sent to Gemini, which must answer in that shape. The same schema then validates the answer.
5. `server/src/scripts/generate-archive.ts` makes one call per project and writes the files. It skips folders that already exist, so you can rerun it after failures.

**Why the ground truth matters:** because we know the true facts, Stage 2 can measure how accurately extraction recovers them. Stage 5 can measure how well search recovers the company's real choices.

### Stage 2: ingestion (done)

```
npm run ingest                 # process new or changed project folders
npm run eval:extraction        # score the catalog against the ground truth
```

Ingest reads each project folder and does three things:

1. **Extracts one record per project** with the LLM. Every field records the filename it came from. When documents disagree, the model uses the most authoritative figure and logs the conflict.
2. **Flags records for review** when a key filter field is empty, or a value was contested or only approximate.
3. **Chunks and embeds** every document. Each chunk is embedded with its project name and filename, so a chunk like "phase 2 was delayed" still knows which project it belongs to.

Only folders whose file hashes changed are reprocessed. That is the prototype's version of SharePoint delta sync.

**Results on the synthetic archive:**

| Measure | Result |
|---|---|
| Fields extracted correctly | 254 of 270 (94.1%) |
| Fields left empty, mostly locations the documents never state | 14 |
| Wrong values | 2, both debatable sector labels |
| Records flagged for review | 4 of 30, exactly the ones with planted conflicts or gaps |

The hospital record shows the design working: the completion report says $19.8M, the change order log says $20.1M. The catalog holds $20.1M, cites the change order log, and flags the conflict for a human.

**Lesson for Stage 3:** sector is a single label and two projects reasonably fit two sectors. So sector should boost ranking, not hard-filter projects out.

**Files to read, in this order:**

1. `server/src/domain/project-record.ts`: the extraction schema. The field descriptions are the instructions the model sees.
2. `server/src/ingest/extract.ts`: the prompt, plus code checks that reject citations to files that don't exist, bad dates and bad amounts.
3. `server/src/ingest/chunk.ts`: paragraph-based chunking with overlap.
4. `server/src/db/db.ts`: the four tables, including the full-text index.
5. `server/src/scripts/ingest.ts`: change detection and the all-or-nothing database update per project.
6. `server/src/scripts/eval-extraction.ts`: the scorer. It separates honest empty fields from wrong values.

### Stage 3: search pipeline and API (done)

```
npm run search -- E1           # run a past RFP and compare with what the company chose
npm run search -- "Provide three projects ..."   # any RFP text
npm run server                 # API on http://localhost:3001
```

One search runs four steps. Each step is one file in `server/src/query/`:

1. **`criteria.ts`**: the LLM turns RFP text into hard limits (minimum value, recency, client type) and soft requirements (short phrases describing the work).
2. **`filter.ts`**: SQL applies the hard limits to the catalog. Projects that miss by a small margin are near misses, let back in with a warning only when too few pass. Missing data becomes a warning, never a silent exclusion.
3. **`rank.ts`**: three signals per project. Meaning: the best-matching passage per requirement, by embedding similarity. Keywords: full-text search. Sector: a boost when the sector fits. They are merged with reciprocal rank fusion.
4. **`justify.ts`**: the LLM picks the final projects from the top 8, explains each one, lists honest gaps, and cites passage ids. Code then drops any citation that wasn't shown to it for that project.

`pipeline.ts` runs the steps and records a trace of each, and `server.ts` exposes it:

| Endpoint | Returns |
|---|---|
| `POST /api/search` | Picks with justifications and citations, plus the full trace |
| `GET /api/projects` | The catalog |
| `GET /api/projects/:id` | One record with per-field sources, issues and document list |
| `GET /api/documents/:id` | A source document's full text |

**Results on the 7 past RFPs:** all 21 projects the company actually chose appeared in the final picks and in the ranking's top 5. No citations were invalid. A search takes about 15 seconds, mostly the justification step.

**Caveat:** the documents and the answer key were written together, so this test is easier than real data. It shows the pipeline works end to end. Real accuracy has to be measured on the company's own past proposals.

### Stage 4: React frontend (done)

Built with React and Vite in `web/`. Four pages:

- **Search**: paste RFP text or load one of the 7 past RFPs. Each recommended project shows its key facts, a justification, the requirements it meets with citation buttons, and its gaps. A citation opens the source document with the cited passage highlighted. Below the picks, "How these were chosen" shows the four pipeline steps: extracted criteria, what the filter removed and why, the ranking table with each signal, and citation verification.
- **Catalog**: every extracted project record, filterable, with records needing review marked.
- **Project**: one record, with the source document for every field, the extraction issues, and all source documents.
- **Evaluation**: the extraction and search scores, with the synthetic-data caveat.

**Files to read:** `web/src/api.ts` for the API types, `web/src/pages/SearchPage.tsx` and `web/src/components/Trace.tsx` for the main screen, and `web/src/components/DocumentViewer.tsx` for citation highlighting.

### Stage 5: evaluation (done)

```
npm run eval:extraction     # catalog fields vs ground truth -> data/eval/extraction.json
npm run eval:search         # 7 past RFPs vs the company's real choices -> data/eval/search.json
```

| Measure | Result |
|---|---|
| Catalog fields correct | 254 of 270 (94%) |
| Company's chosen projects found in the final picks | 21 of 21 |
| Company's chosen projects in the ranking's top 5 | 21 of 21 |
| Invalid citations removed | 0 |

The same method works on real data: feed the company's past RFPs through the system and check whether it finds the projects their estimators chose.
