# How the app works — tabs, data, and AI calls

A case page has four tabs (**Overview · Sources · Facts · Tools**). This doc
maps what each tab does, where the AI calls happen, which model runs, and
what each one produces.

> **Models** — `claude-haiku-4-5` (Haiku) does the per-source and case-level
> analysis; `claude-opus-4-8` (Opus) drafts the Tools documents. The Facts
> tiering and the Evidence checklist are **deterministic** (no AI).
>
> **Rendered images** (open directly — no Mermaid viewer needed) live in
> [`diagrams/`](./diagrams): `02-dataflow.png` is the main one, plus
> `01-legend`, `03-tabs`, `04-tools-sequence` (PNG + SVG each). Regenerate
> with `npx @mermaid-js/mermaid-cli -i TABS.md -o diagrams/TABS.png -b white -s 2`.

## Legend

```mermaid
flowchart LR
  AIH["AI · Haiku"]:::haiku
  AIO["AI · Opus"]:::opus
  DET["Deterministic (no AI)"]:::det
  ST[("Data store")]:::store
  classDef haiku fill:#fde68a,stroke:#b45309,color:#1c1917;
  classDef opus fill:#c7d2fe,stroke:#4338ca,color:#1c1917;
  classDef det fill:#e5e7eb,stroke:#6b7280,color:#1c1917;
  classDef store fill:#bbf7d0,stroke:#15803d,color:#1c1917;
```

## End-to-end dataflow

```mermaid
flowchart TB
  %% ---------- Inputs ----------
  subgraph IN["Inputs (how material enters a case)"]
    direction LR
    UP["Upload file"]
    PA["Paste message"]
    NO["Add note"]
    OL["Pull from Outlook<br/>(emails + attachments)"]
    CU["Client upload link<br/>(public, tokenised)"]
  end

  %% ---------- Ingestion ----------
  subgraph ING["Per-source ingestion"]
    direction TB
    SUM["Summarise source<br/>summarizeFile / Note / Pasted"]:::haiku
    EXT["Extract structured facts<br/>extractAndStoreFacts (forced tool-use)"]:::haiku
    DEDUP["Content-hash dedup<br/>(skip same bytes on a case)"]:::det
  end

  %% ---------- Case-level (on reanalyze / summary regen) ----------
  subgraph CASE["Case-level analysis (Pass 2)"]
    direction TB
    CSUM["Case summary<br/>summarizeCaseFromFacts"]:::haiku
    CONS["Action-plan consolidation<br/>merge + classify kind/tool"]:::haiku
  end

  %% ---------- Stores ----------
  subgraph DB["Data stores"]
    direction LR
    S_SRC[("sources<br/>+ aiSummary")]:::store
    S_FACT[("facts<br/>(typed, normalised)")]:::store
    S_CASE[("cases.aiSummary")]:::store
    S_TASK[("case_tasks<br/>(Action plan)")]:::store
    S_GEN[("generations<br/>(tool drafts)")]:::store
    BLOB[("Blob<br/>(raw bytes)")]:::store
  end

  UP & PA & NO & OL & CU --> DEDUP --> SUM --> EXT
  SUM --> S_SRC
  SUM --> BLOB
  EXT --> S_FACT
  S_FACT --> CSUM --> S_CASE
  S_FACT --> CONS --> S_TASK

  %% ---------- Tabs ----------
  subgraph TABS["Case page tabs"]
    direction LR
    T_OV["OVERVIEW<br/>client + case details<br/>+ AI case summary"]
    T_SR["SOURCES<br/>list + per-source<br/>AI summary & facts"]
    T_FA["FACTS<br/>tiered facts · evidence<br/>checklist · action plan"]
    T_TO["TOOLS<br/>generate documents"]
  end

  S_CASE --> T_OV
  S_SRC --> T_SR
  S_FACT --> T_SR
  S_FACT --> T_FA
  S_TASK --> T_FA
  S_FACT --> T_TO
  S_CASE --> T_TO
  S_GEN --> T_TO

  classDef haiku fill:#fde68a,stroke:#b45309,color:#1c1917;
  classDef opus fill:#c7d2fe,stroke:#4338ca,color:#1c1917;
  classDef det fill:#e5e7eb,stroke:#6b7280,color:#1c1917;
  classDef store fill:#bbf7d0,stroke:#15803d,color:#1c1917;
```

## What each tab does

```mermaid
flowchart TB
  subgraph OV["OVERVIEW — read-only snapshot"]
    OV1["Client card (name, contact, nationality)"]:::det
    OV2["Case details (type, status, references, deadline)"]:::det
    OV3["AI case summary<br/>regenerate → summarizeCaseFromFacts"]:::haiku
  end

  subgraph SR["SOURCES — the evidence pile"]
    SR1["List every source + status"]:::det
    SR2["Add: upload / paste / note / pull Outlook"]:::det
    SR3["On add → summarise + extract facts"]:::haiku
    SR4["Per-source: AI summary + extracted facts<br/>+ origin badge (Outlook / Client upload)"]:::det
  end

  subgraph FA["FACTS — the analysis"]
    FA1["Tiered facts: Critical / Supporting / Raw<br/>(grouped by source)"]:::det
    FA2["Evidence checklist (keyword match vs facts)"]:::det
    FA3["Action plan (case_tasks): check off, dismiss,<br/>add; classified + deep-links to Tools;<br/>deadline-aware summary"]:::det
  end

  subgraph TO["TOOLS — document generation"]
    TO1["Pick a tool + sources, click Generate"]:::det
    TO2["Opus drafts the document (streamed)"]:::opus
    TO3["Refine by chat → Opus rewrites in place"]:::opus
    TO4["Request Documents = template (no AI)"]:::det
    TO5["Send via Outlook (Graph) / edit / placeholders"]:::det
  end

  classDef haiku fill:#fde68a,stroke:#b45309,color:#1c1917;
  classDef opus fill:#c7d2fe,stroke:#4338ca,color:#1c1917;
  classDef det fill:#e5e7eb,stroke:#6b7280,color:#1c1917;
```

## Tools tab — generation sequence

```mermaid
sequenceDiagram
  actor L as Lawyer
  participant UI as ToolRunner (UI)
  participant API as /api/generations
  participant LLM as Opus
  participant DB as generations

  L->>UI: Pick tool + sources, Generate
  alt Template tool (Request Documents)
    UI->>API: POST (template)
    API->>API: mint upload link + build email (no AI)
    API-->>UI: stream static content
  else LLM tool (letters, statements…)
    UI->>API: POST (tool + case context)
    API->>LLM: case summary + facts + sources
    LLM-->>UI: stream draft (NDJSON)
    API->>DB: persist draft
    L->>UI: Refine by chat
    UI->>LLM: rewrite from current draft
    LLM-->>UI: stream new version
  end
  L->>UI: Edit / fill placeholders / Send (Graph)
```

## Where every AI call lives

| Trigger | Where | Model | Produces |
|---|---|---|---|
| Add a source (upload/paste/note/Outlook/client) | `summarizeFile / summarizeNote / summarizePastedMessage` | Haiku | `sources.aiSummary` |
| Add a source | `extractAndStoreFacts` (forced tool-use, temp 0) | Haiku | rows in `facts` |
| Regenerate summary / Reanalyze | `summarizeCaseFromFacts` | Haiku | `cases.aiSummary` |
| Regenerate summary / Reanalyze | `consolidateCaseActionItems` (merge + classify) | Haiku | `case_tasks` |
| Tools → Generate | `streamGeneration` | Opus | a `generations` draft |
| Tools → Refine | `/api/generations/[id]/messages` | Opus | rewritten draft |
| Facts tiering, Evidence checklist, Request Documents email | — | none | deterministic |
