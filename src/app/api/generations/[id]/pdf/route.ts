import { and, desc, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { cases, db, generationMessages, generations } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';
import { renderLetterPdf } from '@/lib/pdf/letter';
import { loadFirmLogo } from '@/lib/pdf/logo';
import { getTool } from '@/lib/tools/registry';

// GET /api/generations/[id]/pdf?logo=1 — download the current draft as a PDF
// letter (for Home Office portal uploads / records). `logo=1` includes the
// firm logo at the top; default is plain text. Owner-scoped.

export const runtime = 'nodejs';

function safeFilename(s: string): string {
  return (s || 'letter')
    .replace(/[^\w.\-() ]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const ownerId = await getCurrentUserId();

  const [gen] = await db
    .select({ id: generations.id, toolId: generations.toolId, caseTitle: cases.title })
    .from(generations)
    .innerJoin(cases, eq(generations.caseId, cases.id))
    .where(and(eq(generations.id, params.id), eq(generations.ownerId, ownerId)))
    .limit(1);
  if (!gen) {
    return NextResponse.json({ error: 'generation_not_found' }, { status: 404 });
  }

  const [latest] = await db
    .select({ content: generationMessages.content })
    .from(generationMessages)
    .where(
      and(eq(generationMessages.generationId, params.id), eq(generationMessages.role, 'assistant')),
    )
    .orderBy(desc(generationMessages.createdAt))
    .limit(1);
  if (!latest) {
    return NextResponse.json({ error: 'no_draft' }, { status: 409 });
  }

  const withLogo = req.nextUrl.searchParams.get('logo') === '1';
  const logo = withLogo ? await loadFirmLogo(ownerId) : undefined;

  const pdf = await renderLetterPdf({ content: latest.content, logo });

  const tool = getTool(gen.toolId);
  const filename = safeFilename(`${tool?.label ?? 'Letter'} - ${gen.caseTitle}.pdf`);

  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(pdf.length),
    },
  });
}
