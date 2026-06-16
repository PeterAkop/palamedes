'use client';

import { Building2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { saveFirmDetailsAction } from '@/app/settings/actions';
import { FIRM_TEXT_FIELDS, type FirmDetails, type FirmTextField } from '@/lib/firm/fields';

// Firm details form (Settings). These prefill every client-facing
// generated letter — edited once here rather than retyped per draft.
// Client component: tracks "dirty" so Save is disabled until something
// changes, and uses useFormStatus to disable the fields + show a
// spinner while the server action runs.

function Field({
  name,
  label,
  value,
  placeholder,
  type = 'text',
}: {
  name: FirmTextField;
  label: string;
  value?: string;
  placeholder?: string;
  type?: 'text' | 'email';
}) {
  return (
    <label className="form-control w-full">
      <div className="label py-1">
        <span className="label-text text-sm">{label}</span>
      </div>
      <input
        type={type}
        name={name}
        defaultValue={value ?? ''}
        placeholder={placeholder}
        className="input input-bordered input-sm w-full"
      />
    </label>
  );
}

function AreaField({
  name,
  label,
  value,
  placeholder,
}: {
  name: FirmTextField;
  label: string;
  value?: string;
  placeholder?: string;
}) {
  return (
    <label className="form-control w-full">
      <div className="label py-1">
        <span className="label-text text-sm">{label}</span>
      </div>
      <textarea
        name={name}
        defaultValue={value ?? ''}
        placeholder={placeholder}
        rows={3}
        className="textarea textarea-bordered textarea-sm w-full"
      />
    </label>
  );
}

// Submit button — reads the form's pending state so it shows a spinner
// and stays disabled while saving (and when nothing has changed).
function SubmitButton({ dirty }: { dirty: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={!dirty || pending} className="btn btn-primary btn-sm">
      {pending ? (
        <>
          <span className="loading loading-spinner loading-xs" />
          Saving…
        </>
      ) : (
        'Save firm details'
      )}
    </button>
  );
}

// All fields live inside a <fieldset> that disables on submit — reads
// pending from useFormStatus, so it must render inside the <form>.
function FormBody({ firm, dirty }: { firm: FirmDetails; dirty: boolean }) {
  const { pending } = useFormStatus();
  return (
    <fieldset disabled={pending} className="space-y-5 border-0 p-0 m-0 min-w-0 disabled:opacity-60">
      {/* Identity / letterhead */}
      <div>
        <h3 className="text-xs uppercase tracking-wide text-base-content/50 mb-1">Firm identity</h3>
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
          <Field name="firmName" label="Firm name" value={firm.firmName} />
          <Field name="email" label="Firm email" value={firm.email} type="email" />
          <Field name="phone" label="Phone" value={firm.phone} />
          <Field name="website" label="Website" value={firm.website} />
          <Field name="sraNumber" label="SRA number" value={firm.sraNumber} />
          <Field name="vatNumber" label="VAT number" value={firm.vatNumber} />
        </div>
        <AreaField name="address" label="Address" value={firm.address} />
      </div>

      {/* Signatory */}
      <div>
        <h3 className="text-xs uppercase tracking-wide text-base-content/50 mb-1">Signatory</h3>
        <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
          <Field name="signatoryName" label="Name" value={firm.signatoryName} />
          <Field name="signatoryTitle" label="Title" value={firm.signatoryTitle} />
          <Field name="signatoryEmail" label="Email" value={firm.signatoryEmail} type="email" />
          <Field
            name="assistingFeeEarner"
            label="Assisting fee earner"
            value={firm.assistingFeeEarner}
            placeholder="e.g. Mrs Laura Head, Solicitor"
          />
        </div>
      </div>

      {/* Scaffolding / boilerplate */}
      <div>
        <h3 className="text-xs uppercase tracking-wide text-base-content/50 mb-1">
          Letter scaffolding
        </h3>
        <Field
          name="referencePrefix"
          label="Our-reference prefix"
          value={firm.referencePrefix}
          placeholder="e.g. MPB"
        />
        <AreaField
          name="complaintsFooter"
          label="Complaints / Legal Ombudsman footer"
          value={firm.complaintsFooter}
        />
        <AreaField
          name="bankDetails"
          label="Bank details (for payments on account)"
          value={firm.bankDetails}
        />
      </div>

      <p className="text-xs text-base-content/40">
        Firm logo upload arrives with formatted letter export.
      </p>

      <div className="flex justify-end">
        <SubmitButton dirty={dirty} />
      </div>
    </fieldset>
  );
}

export default function FirmSettings({ firm }: { firm: FirmDetails }) {
  const [dirty, setDirty] = useState(false);

  // After a successful save the page revalidates and a fresh `firm`
  // arrives — reset the dirty flag so Save disables again. `firm` is the
  // intended trigger even though the body doesn't read it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on new `firm` after save revalidation
  useEffect(() => {
    setDirty(false);
  }, [firm]);

  // Dirty = any field differs from its initial value (handles editing
  // back to the original, which clears the flag).
  function handleChange(e: React.FormEvent<HTMLFormElement>) {
    const fd = new FormData(e.currentTarget);
    const changed = FIRM_TEXT_FIELDS.some((field) => {
      const current = ((fd.get(field) as string | null) ?? '').trim();
      const original = (firm[field] ?? '').trim();
      return current !== original;
    });
    setDirty(changed);
  }

  return (
    <div className="card bg-base-100 border border-base-300">
      <div className="card-body">
        <h2 className="card-title text-base gap-2">
          <Building2 className="h-4 w-4 text-primary" />
          Firm details
        </h2>
        <p className="text-sm text-base-content/60 -mt-1">
          Used as the letterhead and signatory on generated client letters.
        </p>

        <form action={saveFirmDetailsAction} onChange={handleChange} className="mt-2">
          <FormBody firm={firm} dirty={dirty} />
        </form>
      </div>
    </div>
  );
}
