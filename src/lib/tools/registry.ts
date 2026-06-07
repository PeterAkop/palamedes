// In-code tool registry for the Tools tab. Each tool is an Opus-backed
// document generator: a system prompt that sets the drafting role, plus
// a buildUserPrompt that folds the case context (AI case summary +
// selected source summaries) into the request.
//
// This lives in code (not the DB) so tools can evolve without a
// migration; `generations.tool_id` references these ids. Two tools to
// start, matching STATUS.md's Phase A.1 list.

export interface ToolContext {
  caseTitle: string;
  caseType: string;
  clientName: string;
  // AI case summary (may be absent if never generated).
  caseSummary?: string;
  // The source summaries the lawyer selected as context for this run.
  sourceSummaries: Array<{ title: string; kind: string; aiSummary: string }>;
  // Optional free-text steer the lawyer typed when kicking off the run.
  instructions?: string;
}

export interface ToolDef {
  id: string;
  label: string;
  description: string;
  category: string;
  systemPrompt: string;
  buildUserPrompt: (ctx: ToolContext) => string;
}

// Shared closing guidance appended to every tool's system prompt — the
// non-negotiables for a solicitor-facing draft.
const SHARED_GUARDRAILS = `
You are drafting for a qualified UK immigration solicitor who will review, edit, and sign the document — you are not giving legal advice to a client and nothing you produce is sent without the solicitor's approval. Use only facts present in the provided case context; never invent names, dates, figures, or references. Where a detail is needed but missing, insert a clearly-marked placeholder in square brackets (e.g. [DATE OF MARRIAGE]) rather than guessing. Write in British English, in a professional letter register. Output only the letter text — no commentary, no explanation of your choices.`;

function renderContext(ctx: ToolContext): string {
  const parts: string[] = [
    `Case: ${ctx.caseTitle} (type: ${ctx.caseType})`,
    `Client: ${ctx.clientName}`,
  ];
  parts.push(
    ctx.caseSummary
      ? `\nCase summary:\n${ctx.caseSummary}`
      : '\nCase summary: (none generated yet)',
  );
  if (ctx.sourceSummaries.length > 0) {
    const block = ctx.sourceSummaries
      .map((s, i) => `${i + 1}. [${s.kind}] ${s.title}\n   ${s.aiSummary}`)
      .join('\n\n');
    parts.push(`\nSelected source summaries:\n${block}`);
  }
  if (ctx.instructions) {
    parts.push(`\nAdditional instructions from the solicitor:\n${ctx.instructions}`);
  }
  return parts.join('\n');
}

export const TOOLS: ToolDef[] = [
  {
    id: 'client-care-letter',
    label: 'Client Care Letter',
    description: 'SRA-compliant client care / engagement letter for new instructions.',
    category: 'Onboarding',
    systemPrompt: `You draft SRA-compliant client care (engagement) letters for a UK immigration law firm. Cover the matters the SRA Code requires: scope of work, who will handle the matter, fees and how they are calculated, likely disbursements, the complaints procedure and the right to complain to the Legal Ombudsman, and data-protection handling. Structure it as a formal letter with clear headed sections.${SHARED_GUARDRAILS}`,
    buildUserPrompt: (ctx) =>
      `Draft a client care letter for the following matter. Use placeholders for firm-specific details (fee rates, named fee-earner, firm address) that aren't in the context.\n\n${renderContext(ctx)}`,
  },
  {
    id: 'cover-letter-spouse-visa',
    label: 'Cover Letter — Spouse Visa',
    description: 'Cover letter for a spouse visa application bundle to the Home Office.',
    category: 'Cover letters',
    systemPrompt: `You draft cover letters that accompany UK spouse visa application bundles submitted to the Home Office. Set out the application being made, the relationship and its genuineness, how the financial requirement (Appendix FM / Appendix FM-SE) is met, the English language requirement, and an index of the enclosed evidence. Reference the specific evidence in the case context. Structure it as a formal letter to the Home Office caseworker.${SHARED_GUARDRAILS}`,
    buildUserPrompt: (ctx) =>
      `Draft a spouse visa cover letter for the following matter, citing the evidence in the source summaries and flagging any gaps with bracketed placeholders.\n\n${renderContext(ctx)}`,
  },
];

export function getTool(id: string): ToolDef | undefined {
  return TOOLS.find((t) => t.id === id);
}
