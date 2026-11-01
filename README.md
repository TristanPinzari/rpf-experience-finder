# Precedent

Finds a construction company's most relevant past projects for a new RFP, with every claim cited back to a source document.

When a construction company bids on a government contract, the proposal must list relevant past projects. The evidence is spread across thousands of documents, and nobody knows all of it. Precedent reads the archive once, then answers each new RFP in about 15 seconds with a ranked shortlist, a justification for each pick, honest gaps, and citations to the original files.

> **All data in this repository is synthetic.** The company, clients, projects and people are fictional.

## How it works

Precedent is a retrieval-augmented generation (RAG) system with two layers. Plain vector search handles fuzzy requirements well but numbers and dates badly, and RFPs mix both.

1. **A structured project catalog.** An LLM reads each project's folder and extracts one record: client, client type, sector, original and final value, dates and scope. Every field records the document it came from. When documents contradict each other, the most authoritative figure is used and the record is flagged for human review.
2. **A hybrid search index.** Every document is split into passages, and each passage is embedded as a vector. Passages are also indexed for full-text keyword search.

A search runs four steps:

1. **Read the RFP.** The LLM splits the requirements into hard limits, such as "at least $5M, completed in the last 7 years, public client," and soft requirements, such as "construction under live traffic."
2. **Filter.** SQL applies the hard limits to the catalog. Projects that miss by a small margin come back as near misses, with a warning, only when too few pass. Missing data becomes a warning, never a silent exclusion.
3. **Rank.** Each surviving project is scored on three signals: meaning, from the best-matching passage for each soft requirement; keywords, from BM25 full-text search; and sector fit. The rankings are merged with reciprocal rank fusion.
4. **Justify.** The LLM chooses the final projects from the top 8, explains each pick, lists gaps, and cites passages. Code then removes any citation that points to a passage the model wasn't shown.

The interface shows every step, so a reader can see exactly why each project was chosen and open any cited passage in its source document.

## Results

Measured against the synthetic archive's ground truth: 30 projects, 92 deliberately messy documents, and 7 past RFPs with the projects the company actually chose.

| Measure | Result |
|---|---|
| Catalog fields extracted correctly | 254 of 270 (94%) |
| Wrong values, as opposed to fields left empty | 2, both debatable sector labels |
| Records flagged for review | 4 of 30, exactly the ones with planted conflicts or gaps |
| Company's chosen projects found in the final picks | 21 of 21 |
| Company's chosen projects in the ranking's top 5 | 21 of 21 |
| Invalid citations removed | 0 |

**Caveat:** the documents and the answer key were written together, so this test is easier than real data. It shows the pipeline works end to end, not real-world accuracy. On a real archive, the same method applies: run the company's past RFPs through the system and check whether it finds the projects their estimators chose.

## Stack, and the path to production

React, Vite, TypeScript, Express, SQLite with FTS5, Zod, and the Gemini API for the LLM and embeddings.

| Prototype | Production equivalent |
|---|---|
| Text files in `data/archive/` | SharePoint, read through Microsoft Graph |
| File hashes to reprocess only changed folders | Graph delta queries |
| Plain-text documents | Azure AI Document Intelligence for PDFs and scans |
| SQLite full-text search and in-memory vector search | Azure AI Search, hybrid search with filters |
| Gemini API | Azure OpenAI in a Canadian region |
| One-off ingestion script | Scheduled sync job, for example Temporal or Azure Functions |

## Running it

1. Install Node 22 or newer.
2. Clone the repository:
   ```
   git clone https://github.com/TristanPinzari/precedent.git
   cd precedent
   ```
3. Get a Gemini API key at https://aistudio.google.com/apikey.
4. Copy `.env.example` to `.env` and paste the key in.
5. Install dependencies:
   ```
   npm run setup
   ```
6. Build the catalog and search index from the included archive:
   ```
   npm run ingest
   ```
7. Start the app, then open http://localhost:3001:
   ```
   npm start
   ```

For frontend development, run `npm run server` and `npm run web` in two terminals, then open http://localhost:5173.

The Gemini free tier may use inputs to improve Google's products. That is fine for synthetic data. Real client data would go through a paid, region-hosted service.

### Other commands

```
npm run search -- E1                  # run a past RFP from the command line, compared with the company's choices
npm run search -- "Provide three..."  # run any RFP text
npm run eval:extraction               # score the catalog against the ground truth
npm run eval:search                   # run all 7 past RFPs and save the results
npm run ingest -- --force             # reprocess every project
```

## Code tour

**Data**
- `data/spec/projects.json`: the ground truth for 30 fictional projects. Each has a `quirks` field describing the mess planted in its documents. Examples include a final value that appears only in the change order log, a completion report that contradicts the change order log, and a project called by three different names.
- `data/spec/past-rfps.json`: 7 past RFPs and the projects the company listed for each. Each has an RFP date, so projects finished after it are not eligible.
- `data/archive/`: the 92 documents, one folder per project, standing in for SharePoint. They were written from the spec by hand, so every planted quirk lands exactly where intended. `npm run generate -- --force` can regenerate them with Gemini instead.

**Ingestion**, in `server/src/`
- `domain/taxonomy.ts`: fixed vocabularies for client types, sectors and delivery methods. Fixed categories, rather than free text, make the catalog filterable.
- `domain/project-record.ts`: the extraction schema. The field descriptions are the instructions the model sees.
- `ingest/extract.ts`: the extraction prompt, plus code checks that reject citations to files that don't exist, malformed dates and invalid amounts.
- `ingest/chunk.ts`: paragraph-based chunking with overlap.
- `db/db.ts`: the SQLite tables, including the full-text index.
- `scripts/ingest.ts`: change detection, and an all-or-nothing database update per project.
- `llm/gemini.ts`: the only file that calls Gemini. A Zod schema is converted to JSON Schema, Gemini must answer in that shape, and the same schema validates the reply. It also throttles calls, retries errors, and switches models when one is overloaded.

**Search**, in `server/src/query/`
- `criteria.ts`, `filter.ts`, `rank.ts`, `justify.ts`: the four search steps, in order.
- `pipeline.ts`: runs the steps and records a trace of each.

**API**, in `server/src/server.ts`

| Endpoint | Returns |
|---|---|
| `POST /api/search` | Picks with justifications and citations, plus the full trace |
| `GET /api/projects` | The catalog |
| `GET /api/projects/:id` | One record, with the source for every field, its issues and its documents |
| `GET /api/documents/:id` | A source document's full text |
| `GET /api/eval` | The latest evaluation results |

**Frontend**, in `web/src/`
- `pages/SearchPage.tsx` and `components/Trace.tsx`: the search screen and the step-by-step trace.
- `components/DocumentViewer.tsx`: opens a cited document with the passage highlighted.
- `pages/CatalogPage.tsx`, `pages/ProjectPage.tsx` and `pages/EvalPage.tsx`: the catalog, project records and evaluation results.

## Design notes

- **Sector boosts ranking instead of filtering.** Some projects reasonably fit two sectors, such as utility relocation for a light rail line. A hard sector filter would wrongly drop them.
- **Empty is better than wrong.** Extraction leaves a field empty when no document states it, and the scorer counts empty fields separately from wrong values. A wrong value on an unflagged record is the failure that matters most.
- **Review flags have to be rare to mean anything.** An early version flagged 29 of 30 records. Issues now carry a severity, and only real conflicts, approximate figures and missing key fields trigger review.
