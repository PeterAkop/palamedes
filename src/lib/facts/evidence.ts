import type { EvidenceCheck } from '@/data/cases';
import { getCaseFacts } from '@/lib/facts/case';

// Missing-evidence detection. For a case's route (case type) we hold a
// SUGGESTED checklist of the evidence usually expected, then mark each
// item present/absent by keyword-matching it against the case's extracted
// facts (evidence / document-type / key-fact values).
//
// IMPORTANT: these lists are decision-support defaults, not legal advice
// and not a substitute for the current Immigration Rules — the solicitor
// reviews and decides. Matching is deliberately fuzzy (keyword contains),
// so treat "present" as "the facts mention something relevant", not proof.

interface EvidenceItem {
  label: string;
  keywords: string[];
}

const GENERIC: EvidenceItem[] = [
  { label: 'Valid passport / travel document', keywords: ['passport', 'travel document', 'brp'] },
  {
    label: 'Applicant identity & personal details',
    keywords: ['date of birth', 'dob', 'nationality', 'full name'],
  },
  { label: 'Evidence supporting the application', keywords: ['evidence', 'letter', 'statement'] },
];

const REQUIRED_EVIDENCE: Record<string, EvidenceItem[]> = {
  'spouse-visa': [
    {
      label: 'Relationship genuine & subsisting',
      keywords: [
        'marriage',
        'married',
        'relationship',
        'partner',
        'spouse',
        'wedding',
        'civil partnership',
      ],
    },
    {
      label: 'Cohabitation / living together',
      keywords: [
        'cohabit',
        'living together',
        'joint tenancy',
        'council tax',
        'utility',
        'joint account',
        'same address',
      ],
    },
    {
      label: 'Financial requirement (income or savings)',
      keywords: [
        'income',
        'salary',
        'payslip',
        'p60',
        'employment',
        'financial',
        'savings',
        'bank statement',
        '£',
      ],
    },
    { label: 'English language (A1)', keywords: ['english', 'ielts', 'a1', 'language', 'sela'] },
    {
      label: 'Accommodation',
      keywords: ['accommodation', 'tenancy', 'property', 'housing', 'rent', 'mortgage'],
    },
    {
      label: "Sponsor's status (British / settled)",
      keywords: ['british', 'settled', 'ilr', 'sponsor', 'citizen'],
    },
    { label: 'Valid passport', keywords: ['passport', 'travel document'] },
    { label: 'TB test certificate (if applicable)', keywords: ['tb', 'tuberculosis'] },
  ],
  'family-visa': [
    {
      label: 'Relationship to sponsor',
      keywords: ['relationship', 'parent', 'child', 'family', 'partner', 'spouse', 'marriage'],
    },
    {
      label: 'Financial requirement',
      keywords: ['income', 'salary', 'payslip', 'financial', 'savings', 'bank', '£'],
    },
    { label: 'Accommodation', keywords: ['accommodation', 'tenancy', 'housing', 'rent'] },
    { label: 'English language', keywords: ['english', 'language', 'ielts', 'a1'] },
    { label: "Sponsor's status", keywords: ['british', 'settled', 'sponsor', 'citizen'] },
  ],
  ilr: [
    {
      label: '5 years continuous lawful residence',
      keywords: [
        'residence',
        'continuous',
        '5 year',
        'five year',
        'leave to remain',
        'visa history',
      ],
    },
    { label: 'Life in the UK test', keywords: ['life in the uk', 'koll', 'life in uk'] },
    { label: 'English language (B1)', keywords: ['english', 'b1', 'ielts', 'language'] },
    { label: 'Absences within limits', keywords: ['absence', 'travel', 'days outside', 'trips'] },
    {
      label: 'Financial / employment evidence',
      keywords: ['income', 'salary', 'payslip', 'employment', 'p60'],
    },
    { label: 'Valid passport / BRP', keywords: ['passport', 'brp', 'biometric'] },
  ],
  naturalisation: [
    {
      label: 'Settled status / ILR held 12+ months',
      keywords: ['ilr', 'settled', 'indefinite leave', 'permanent residence'],
    },
    {
      label: 'Continuous residence (3/5 years)',
      keywords: ['residence', 'continuous', '3 year', '5 year', 'three year', 'five year'],
    },
    { label: 'Life in the UK test', keywords: ['life in the uk', 'koll'] },
    { label: 'English language (B1)', keywords: ['english', 'b1', 'language'] },
    {
      label: 'Good character',
      keywords: ['good character', 'conviction', 'criminal', 'tax', 'hmrc'],
    },
    { label: 'Referees', keywords: ['referee', 'reference'] },
    { label: 'Absences within limits', keywords: ['absence', 'travel', 'days outside'] },
  ],
  'work-visa': [
    {
      label: 'Certificate of Sponsorship (CoS)',
      keywords: ['certificate of sponsorship', 'cos', 'sponsor'],
    },
    { label: 'Salary meets threshold', keywords: ['salary', 'income', '£', 'wage'] },
    {
      label: 'Job at required skill level',
      keywords: ['job', 'role', 'occupation', 'soc', 'skill'],
    },
    { label: 'English language', keywords: ['english', 'language', 'ielts'] },
    { label: 'Maintenance funds', keywords: ['maintenance', 'funds', 'savings', 'bank'] },
    { label: 'Valid passport', keywords: ['passport'] },
  ],
  'study-visa': [
    { label: 'CAS (Confirmation of Acceptance)', keywords: ['cas', 'confirmation of acceptance'] },
    {
      label: 'Financial maintenance',
      keywords: ['maintenance', 'funds', 'savings', 'bank', 'tuition'],
    },
    { label: 'English language', keywords: ['english', 'ielts', 'language'] },
    {
      label: 'Academic qualifications',
      keywords: ['qualification', 'degree', 'transcript', 'certificate'],
    },
    { label: 'Valid passport', keywords: ['passport'] },
  ],
  'eu-settlement': [
    { label: 'Identity & nationality', keywords: ['passport', 'id card', 'national'] },
    {
      label: 'Evidence of UK residence',
      keywords: ['residence', 'living', 'address', 'council tax', 'utility'],
    },
    {
      label: 'Relationship to EU citizen (if family member)',
      keywords: ['eu', 'relationship', 'family', 'spouse', 'partner'],
    },
  ],
  extension: [
    {
      label: 'Current leave / visa evidence',
      keywords: ['leave to remain', 'visa', 'brp', 'current'],
    },
    {
      label: 'Continued eligibility for the route',
      keywords: ['eligibility', 'requirement', 'evidence'],
    },
    { label: 'Financial evidence', keywords: ['income', 'salary', 'financial', 'savings'] },
    { label: 'Valid passport', keywords: ['passport'] },
  ],
  appeal: [
    { label: 'Refusal decision letter', keywords: ['refusal', 'decision', 'refused', 'letter'] },
    { label: 'Grounds of appeal', keywords: ['grounds', 'appeal'] },
    { label: 'Witness statement(s)', keywords: ['witness', 'statement'] },
    { label: 'Evidence addressing refusal reasons', keywords: ['evidence', 'document', 'support'] },
  ],
  asylum: [
    {
      label: 'Account / statement of claim',
      keywords: ['statement', 'account', 'claim', 'persecution'],
    },
    { label: 'Identity & nationality', keywords: ['passport', 'identity', 'national'] },
    { label: 'Country / background evidence', keywords: ['country', 'background', 'report'] },
    { label: 'Medical evidence (if relevant)', keywords: ['medical', 'scarring', 'injury'] },
  ],
  sponsorship: [
    { label: 'Sponsor licence', keywords: ['licence', 'license', 'sponsor'] },
    { label: 'Genuine vacancy evidence', keywords: ['vacancy', 'job', 'role', 'advert'] },
    { label: 'Sponsor financial standing', keywords: ['financial', 'accounts', 'company'] },
  ],
};

// Whether we hold a tailored checklist for this route (vs the generic one).
export function hasTailoredEvidence(caseType: string): boolean {
  return caseType in REQUIRED_EVIDENCE;
}

// Mark each expected item present/absent by fuzzy-matching the case's fact
// values. `matchedBy` records the fact value that satisfied a present item.
export function checkEvidence(caseType: string, factValues: string[]): EvidenceCheck[] {
  const items = REQUIRED_EVIDENCE[caseType] ?? GENERIC;
  const haystack = factValues.map((v) => v.toLowerCase());
  return items.map((item) => {
    const matched = haystack.find((v) => item.keywords.some((k) => v.includes(k)));
    return { label: item.label, present: Boolean(matched), matchedBy: matched };
  });
}

// Whether an action-item's text refers to a piece of expected evidence for
// the route (keyword match against the same checklist). Used to drop
// "collect X" tasks that the Evidence checklist already tracks, so the
// have-list (checklist) and do-list (action plan) don't duplicate.
export function taskMatchesEvidence(caseType: string, text: string): boolean {
  const items = REQUIRED_EVIDENCE[caseType] ?? GENERIC;
  const t = text.toLowerCase();
  return items.some((item) => item.keywords.some((k) => t.includes(k)));
}

// Owner-scoped: load the case's facts and build the evidence checklist.
export async function getEvidenceChecklist(
  caseId: string,
  ownerId: string,
  caseType: string,
): Promise<EvidenceCheck[]> {
  const rows = await getCaseFacts(caseId, ownerId);
  const values = rows
    .filter((f) => f.type === 'evidence' || f.type === 'document_type' || f.type === 'key_fact')
    .map((f) => f.value ?? '')
    .filter((v) => v.length > 0);
  return checkEvidence(caseType, values);
}
