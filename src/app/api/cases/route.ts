import { and, eq } from 'drizzle-orm';
import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { CASE_TYPES, cases, clients, db } from '@/db/db';
import { getCurrentUserId } from '@/lib/auth';

// POST /api/cases — create a case, optionally creating its client too.
// The body carries EITHER an existing `clientId` OR a `newClient`
// object; Zod's discriminated-ish union (refine) enforces exactly one.
//
// Note on atomicity: the Neon HTTP driver doesn't support interactive
// transactions (results can't flow between statements in one request),
// so when creating a new client we insert the client, then the case,
// as two sequential writes. If the case insert failed we'd be left
// with an orphan client — acceptable for the single-user POC; revisit
// with a server-side function or the pooled TCP driver if it matters.

export const runtime = 'nodejs';

const NewClientSchema = z.object({
  firstName: z.string().min(1).max(100),
  lastName: z.string().min(1).max(100),
  email: z.string().email().max(200).optional().or(z.literal('')),
  phone: z.string().max(50).optional(),
  nationality: z.string().max(100).optional(),
});

const CaseBodySchema = z
  .object({
    clientId: z.string().uuid().optional(),
    newClient: NewClientSchema.optional(),
    title: z.string().min(1).max(200),
    caseType: z.enum(CASE_TYPES),
    homeOfficeReference: z.string().max(100).optional(),
    // Date-only string (yyyy-mm-dd); the `date` column stores it as-is.
    deadline: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  })
  .refine((b) => Boolean(b.clientId) !== Boolean(b.newClient), {
    message: 'Provide exactly one of clientId or newClient',
  });

export async function POST(req: NextRequest) {
  const ownerId = getCurrentUserId();

  const json = await req.json().catch(() => null);
  const parsed = CaseBodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', issues: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const body = parsed.data;

  // Resolve the client id — verify ownership of an existing client, or
  // create a new one.
  let clientId: string;
  if (body.clientId) {
    const existing = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, body.clientId), eq(clients.ownerId, ownerId)))
      .limit(1);
    if (existing.length === 0) {
      return NextResponse.json({ error: 'client_not_found' }, { status: 404 });
    }
    clientId = existing[0].id;
  } else if (body.newClient) {
    const nc = body.newClient;
    const [created] = await db
      .insert(clients)
      .values({
        ownerId,
        firstName: nc.firstName,
        lastName: nc.lastName,
        email: nc.email || null,
        phone: nc.phone || null,
        nationality: nc.nationality || null,
      })
      .returning({ id: clients.id });
    clientId = created.id;
  } else {
    // Unreachable — the Zod refine guarantees exactly one of
    // clientId / newClient — but keeps the type-checker happy.
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }

  const [createdCase] = await db
    .insert(cases)
    .values({
      clientId,
      ownerId,
      title: body.title,
      caseType: body.caseType,
      status: 'open',
      homeOfficeReference: body.homeOfficeReference || null,
      deadline: body.deadline || null,
    })
    .returning({ id: cases.id });

  return NextResponse.json({ caseId: createdCase.id }, { status: 201 });
}
