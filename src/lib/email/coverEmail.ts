import type { FirmDetails } from '@/lib/firm/queries';

// Build the covering email that goes out when a letter is sent as a PDF
// attachment: a firm header, a one-line "please find attached", a signoff,
// and a firm footer — assembled from the lawyer's firm settings. Only the
// fields they've filled in appear.

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildCoverEmailHtml(args: {
  firm: FirmDetails;
  documentLabel: string;
  caseTitle?: string;
}): string {
  const { firm, documentLabel, caseTitle } = args;
  const firmName = firm.firmName?.trim();

  // Header: firm name + a contact line of whatever's set.
  const headerContact = [firm.address, firm.phone, firm.email, firm.website]
    .map((v) => v?.trim())
    .filter(Boolean)
    .map((v) => esc(v as string))
    .join(' &nbsp;·&nbsp; ');
  const header = `
    <div style="border-bottom:2px solid #e5e7eb;padding-bottom:8px;margin-bottom:18px">
      ${firmName ? `<div style="font-size:18px;font-weight:bold;color:#111">${esc(firmName)}</div>` : ''}
      ${headerContact ? `<div style="font-size:12px;color:#666;margin-top:2px">${headerContact}</div>` : ''}
    </div>`;

  // Body.
  const re = caseTitle ? ` in relation to ${esc(caseTitle)}` : '';
  const body = `
    <p>Please find the ${esc(documentLabel)} attached${re}.</p>
    <p>Should you have any questions, please do not hesitate to contact us.</p>`;

  // Signoff.
  const signatory = [firm.signatoryName, firm.signatoryTitle]
    .map((v) => v?.trim())
    .filter(Boolean)
    .map((v) => esc(v as string))
    .join(', ');
  const signoff = `
    <p style="margin-top:16px">Kind regards,<br/>
      ${signatory ? `${signatory}<br/>` : ''}
      ${firmName ? esc(firmName) : ''}
    </p>`;

  // Footer: SRA / VAT / complaints line.
  const footerBits = [
    firm.sraNumber ? `SRA no. ${esc(firm.sraNumber.trim())}` : '',
    firm.vatNumber ? `VAT no. ${esc(firm.vatNumber.trim())}` : '',
    firm.complaintsFooter ? esc(firm.complaintsFooter.trim()) : '',
  ].filter(Boolean);
  const footer = footerBits.length
    ? `<div style="border-top:1px solid #e5e7eb;margin-top:18px;padding-top:8px;font-size:11px;color:#888">
        ${footerBits.join('<br/>')}
      </div>`
    : '';

  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;line-height:1.5">${header}${body}${signoff}${footer}</div>`;
}
