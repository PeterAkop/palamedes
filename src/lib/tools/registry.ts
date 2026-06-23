// In-code tool registry for the Tools tab. Each tool is a Sonnet-backed
// document generator: a system prompt that sets the drafting role, plus
// a buildUserPrompt that folds the case context into the request — the
// structured Facts Store (authoritative for concrete details) plus the
// AI case summary and selected source summaries for narrative context.
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
  // Deterministic structured facts (the Facts Store), rendered as a stable
  // facts sheet — the authoritative source for concrete details (names,
  // dates, figures, references). Absent if no facts extracted yet.
  caseFacts?: string;
  // The source summaries the lawyer selected as context for this run.
  sourceSummaries: Array<{ title: string; kind: string; aiSummary: string }>;
  // Matter references for the letterhead. Lawyer-set; absent ones must
  // be placeholdered, never invented.
  ourReference?: string;
  yourReference?: string;
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
  // LLM tools provide a prompt; template tools (e.g. Request Documents)
  // build their content deterministically and omit these.
  systemPrompt?: string;
  buildUserPrompt?: (ctx: ToolContext) => string;
  // Template tools: the generation route builds the content directly
  // (no Opus call) — see buildRequestDocumentsEmail.
  template?: boolean;
}

// Shared closing guidance appended to every tool's system prompt — the
// non-negotiables for a solicitor-facing draft.
const SHARED_GUARDRAILS = `
You are drafting for a qualified UK immigration solicitor who will review, edit, and sign the document — you are not giving legal advice to a client and nothing you produce is sent without the solicitor's approval. Use only facts present in the provided case context; never invent names, dates, figures, or references. When the "Verified case facts" block gives a specific value (a name, date, figure, address, or reference), treat it as the authoritative source for that detail and prefer it over anything implied by the narrative summaries. For the firm's own letterhead and signatory, use the details in the "Firm details" block exactly as given; only fall back to a clearly-marked square-bracket placeholder (e.g. [FIRM ADDRESS], [DATE OF MARRIAGE]) for a detail that is genuinely missing — never guess. For the matter references, use the "Our reference" and "Your reference" values from the "Matter references" block exactly if given; if a reference is not provided, write a clearly-marked placeholder ([OUR REFERENCE] / [YOUR REFERENCE]) — never fabricate a reference number. Write in British English throughout — UK spelling (e.g. -ise endings, "colour", "organisation", "apologise") and UK date format ("22 June 2026", never M/D/Y), in a professional letter register. Never use US spelling. Output only the letter text — no commentary, no explanation of your choices.`;

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
    // Note: the firm reference *prefix* is intentionally NOT passed to the
    // model — the per-matter "Our reference" governs (see renderContext),
    // so the model can't pad the prefix into a fabricated number.
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
  // Matter references — only the ones the lawyer set; absent ones the
  // model must placeholder (per the guardrail), not invent.
  const refLines: string[] = [];
  if (ctx.ourReference?.trim()) refLines.push(`- Our reference: ${ctx.ourReference}`);
  if (ctx.yourReference?.trim()) refLines.push(`- Your reference: ${ctx.yourReference}`);
  parts.push(
    refLines.length > 0
      ? `\nMatter references:\n${refLines.join('\n')}`
      : '\nMatter references: (none set — use [OUR REFERENCE] / [YOUR REFERENCE] placeholders, do not invent)',
  );
  // Structured facts first — the authoritative grounding for concrete
  // details. The narrative summaries below are supporting context.
  parts.push(
    ctx.caseFacts
      ? `\nVerified case facts (structured extraction — authoritative for names, dates, figures, and references):\n${ctx.caseFacts}`
      : '\nVerified case facts: (none extracted yet)',
  );
  parts.push(
    ctx.caseSummary
      ? `\nCase summary (narrative context):\n${ctx.caseSummary}`
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
    id: 'request-documents',
    label: 'Request Documents',
    description:
      'Email the client a secure link to upload the documents still needed for the case.',
    category: 'Onboarding',
    template: true,
  },
  {
    id: 'client-care-letter',
    label: 'Client Care Letter',
    description: 'SRA-compliant client care / engagement letter for new instructions.',
    category: 'Onboarding',
    systemPrompt: `You draft SRA-compliant client care (engagement) letters for a UK immigration law firm, in the style of a high-street firm's standard letter. Open with a reference block (OUR REFERENCE using the firm's reference prefix, YOUR REFERENCE, DATE), then "Dear [client]" and a "Re:" line naming the matter. Use clear headed sections covering: an opening confirming instructions and referring to the accompanying terms of business; "Responsibility for your matter" (the named signatory has conduct, assisted by any assisting fee earner); "Your Instructions" (the background from the case context); "Advice and Next Steps" (merits and the process ahead); "Costs and expenses" (the agreed fee and what it includes, disbursements); "Money on account" (any sum received on account); "Our service" and the complaints procedure including the right to escalate to the Legal Ombudsman (legalombudsman.org.uk); and "How you can help us". Close by asking the client to confirm by email that they have received and agree to the letter and terms of business, then sign off "Yours sincerely" with the signatory's name, the firm name and the signatory's email.${SHARED_GUARDRAILS}`,
    buildUserPrompt: (ctx) =>
      `Draft a client care letter for the following matter. Use the Firm details block for the reference prefix, signatory, assisting fee earner, firm name and email; use bracketed placeholders only for matter-specific details (fee figures, dates, sums on account) that aren't in the context.\n\n${renderContext(ctx)}`,
  },
  {
    id: 'client-advice-email',
    label: 'Client Advice Email',
    description: 'Plain-English advice email to a client: process, fees, and documents needed.',
    category: 'Advice',
    systemPrompt: `You draft plain-English advice emails from a UK immigration solicitor to their client, explaining what to do next on their matter. Keep the tone professional but approachable and practical, as in a real solicitor-to-client email. Where relevant, cover: the application/form to be made (with the relevant gov.uk link if known, otherwise a bracketed placeholder); the Home Office fees and any health surcharge; a numbered "The process is" list of steps; a clear "The documents you need are" list tailored to the matter; any financial or evidential requirement explained in practical terms; and the firm's service options/fees for assisting. Close with an offer to answer questions and "Yours faithfully" with the signatory's name. Use real figures/links only if present in the context; never invent fee amounts or form numbers.${SHARED_GUARDRAILS}`,
    buildUserPrompt: (ctx) =>
      `Draft a client advice email for the following matter — explain the process, fees and the documents the client needs to provide. Tailor the document list to the matter type. Placeholder any fee figure, form number or gov.uk link not given in the context.\n\n${renderContext(ctx)}`,
  },
  {
    id: 'letter-of-representation',
    label: 'Letter of Representation',
    description: 'Formal representations to the Home Office / UKVI applying the Immigration Rules.',
    category: 'Representations',
    systemPrompt: `You draft formal letters of representation addressed to the Home Office / UKVI in support of an immigration application. Open with a reference block (the relevant application form, OUR REFERENCE using the firm's prefix, YOUR REFERENCE, DATE), then "Dear Sir/Madam", a heading naming the application and route, and a NAME / DOB / NATIONALITY block. State who you are instructed by, give the "Background", then under "The Law" work through each relevant requirement of the applicable Appendix in turn (e.g. validity, suitability, eligibility/qualifying period, continuous residence, English language, Knowledge of Life in the UK), citing the specific rule paragraph references you rely on and applying the client's facts to each. Where a precise rule reference or figure is required but not certain from the context, insert a clearly-marked bracketed placeholder (e.g. [APPENDIX X PARA Y]) rather than stating a rule you are not sure of — accuracy of the law matters more than completeness. Conclude that the client qualifies and ask the caseworker to grant the application, then sign off "Yours faithfully" with the firm name.${SHARED_GUARDRAILS}`,
    buildUserPrompt: (ctx) =>
      `Draft a letter of representation for the following matter, working through the relevant Immigration Rules requirements and applying the client's facts. Cite the rule paragraphs you rely on; where you are not certain of a precise reference or figure, use a bracketed placeholder rather than guessing.\n\n${renderContext(ctx)}`,
  },
  {
    id: 'witness-statement',
    label: 'Witness Statement',
    description: 'First-person witness statement for a tribunal appeal, with statement of truth.',
    category: 'Tribunal',
    systemPrompt: `You draft witness statements for use in First-tier Tribunal immigration appeals. Begin with the tribunal heading ("In the First-tier Tribunal" with the appeal reference if known), the parties ("Between: [Appellant] / [name] and the Secretary of State for the Home Department, Respondent"), and "Witness statement of [name]". Write the body in the first person as the witness ("I, [name], of [address], make this statement in support of..."), in clear numbered paragraphs setting out the relevant facts from the case context. End with a "STATEMENT OF TRUTH" in the standard form ("I believe that the facts stated in this witness statement are true. I understand that proceedings for contempt of court may be brought against anyone who makes... a false statement..."), followed by Signed / Name / Dated lines. If the case context indicates the statement was interpreted, add the standard interpreter declaration naming the interpreter (the signatory) and the language. Use bracketed placeholders for any fact, date, address or reference not in the context.${SHARED_GUARDRAILS}`,
    buildUserPrompt: (ctx) =>
      `Draft a first-person witness statement for the following appeal, in numbered paragraphs, ending with the statement of truth (and an interpreter declaration if the context indicates one is needed). Placeholder any fact, date, address or appeal reference not given.\n\n${renderContext(ctx)}`,
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

// Build the "Request Documents" email deterministically (template tool):
// firm letterhead + a secure upload link + the list of documents still
// needed. `[DATE]` / `[OUR REFERENCE]` are left as fillable placeholders;
// the materials are a list the lawyer can prune (× per item).
export function buildRequestDocumentsEmail(args: {
  ctx: ToolContext;
  uploadUrl: string;
  missing: string[];
}): string {
  const { ctx, uploadUrl, missing } = args;
  const f = ctx.firm;
  const out: string[] = [];

  if (f?.firmName) out.push(`**${f.firmName}**`);
  if (f?.address) out.push(f.address);
  const contact = [
    f?.phone && `Tel: ${f.phone}`,
    f?.email && `Email: ${f.email}`,
    f?.website && `Web: ${f.website}`,
  ]
    .filter(Boolean)
    .join('  ');
  if (contact) out.push(contact);
  out.push('', '---', '');

  out.push(`OUR REFERENCE: ${ctx.ourReference?.trim() || '[OUR REFERENCE]'}`);
  out.push('DATE: [DATE]');
  out.push('');

  out.push(`Dear ${ctx.clientName},`);
  out.push('');
  out.push('**Re: Documents needed for your application**');
  out.push('');
  out.push(
    'To progress your matter, we need some documents from you. Please upload them securely using the link below:',
  );
  out.push('');
  out.push(uploadUrl);
  out.push('');

  if (missing.length > 0) {
    out.push('The documents we still need are:');
    out.push('');
    for (const m of missing) out.push(`- ${m}`);
    out.push('');
  } else {
    out.push('Please upload any documents relevant to your application.');
    out.push('');
  }

  out.push('If any of these do not apply to you, please let us know.');
  out.push('');
  out.push('Once we have received your documents, we will review them and be in touch.');
  out.push('');
  out.push('Yours sincerely,');
  out.push('');
  if (f?.signatoryName) out.push(f.signatoryName);
  if (f?.firmName) out.push(f.firmName);
  const signEmail = f?.signatoryEmail ?? f?.email;
  if (signEmail) out.push(signEmail);

  return out.join('\n');
}
