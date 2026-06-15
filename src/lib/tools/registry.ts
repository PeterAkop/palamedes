// In-code tool registry for the Tools tab. Each tool is an Opus-backed
// document generator: a system prompt that sets the drafting role, plus
// a buildUserPrompt that folds the case context (AI case summary +
// selected source summaries) into the request.
//
// This lives in code (not the DB) so tools can evolve without a
// migration; `generations.tool_id` references these ids. Two tools to
// start, matching STATUS.md's Phase A.1 list.

import type { FirmDetails } from '@/lib/firm/queries';

export interface ToolContext {
  caseTitle: string;
  caseType: string;
  clientName: string;
  // AI case summary (may be absent if never generated).
  caseSummary?: string;
  // The source summaries the lawyer selected as context for this run.
  sourceSummaries: Array<{ title: string; kind: string; aiSummary: string }>;
  // The lawyer's firm letterhead / signatory details — folded into the
  // letter so the draft uses real firm data, not placeholders.
  firm?: FirmDetails;
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
You are drafting for a qualified UK immigration solicitor who will review, edit, and sign the document — you are not giving legal advice to a client and nothing you produce is sent without the solicitor's approval. Use only facts present in the provided case context; never invent names, dates, figures, or references. For the firm's own letterhead and signatory, use the details in the "Firm details" block exactly as given; only fall back to a clearly-marked square-bracket placeholder (e.g. [FIRM ADDRESS], [DATE OF MARRIAGE]) for a detail that is genuinely missing — never guess. Write in British English, in a professional letter register. Output only the letter text — no commentary, no explanation of your choices.`;

// Render the firm letterhead/signatory block. Only the fields the lawyer
// has filled in appear; missing ones are simply absent (the model is
// told to placeholder those).
function renderFirm(firm: FirmDetails): string {
  const lines: Array<[string, string | undefined]> = [
    ['Firm name', firm.firmName],
    ['Address', firm.address],
    ['Phone', firm.phone],
    ['Email', firm.email],
    ['Website', firm.website],
    ['SRA number', firm.sraNumber],
    ['VAT number', firm.vatNumber],
    ['Our-reference prefix', firm.referencePrefix],
    ['Signatory', firm.signatoryName],
    ['Signatory title', firm.signatoryTitle],
    ['Signatory email', firm.signatoryEmail],
    ['Assisting fee earner', firm.assistingFeeEarner],
    ['Complaints/Ombudsman footer', firm.complaintsFooter],
    ['Bank details', firm.bankDetails],
  ];
  const filled = lines.filter(([, v]) => v && v.trim().length > 0);
  if (filled.length === 0) return '';
  return `\nFirm details (use as letterhead / signatory):\n${filled
    .map(([k, v]) => `- ${k}: ${v}`)
    .join('\n')}`;
}

function renderContext(ctx: ToolContext): string {
  const parts: string[] = [
    `Case: ${ctx.caseTitle} (type: ${ctx.caseType})`,
    `Client: ${ctx.clientName}`,
  ];
  if (ctx.firm) {
    const firmBlock = renderFirm(ctx.firm);
    if (firmBlock) parts.push(firmBlock);
  }
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
      `Draft a client care letter for the following matter. Use the Firm details block for the firm name, signatory, address and reference; placeholder only the matter-specific details (fee figures, dates) that aren't in the context.\n\n${renderContext(ctx)}`,
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
