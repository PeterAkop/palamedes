import { Building2 } from 'lucide-react';
import { saveFirmDetailsAction } from '@/app/settings/actions';
import type { FirmDetails, FirmTextField } from '@/lib/firm/queries';

// Firm details form (Settings). These prefill every client-facing
// generated letter — edited once here rather than retyped per draft.
// Server component: the form posts to the server action, which upserts
// and revalidates. No client JS needed.

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

export default function FirmSettings({ firm }: { firm: FirmDetails }) {
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

        <form action={saveFirmDetailsAction} className="mt-2 space-y-5">
          {/* Identity / letterhead */}
          <div>
            <h3 className="text-xs uppercase tracking-wide text-base-content/50 mb-1">
              Firm identity
            </h3>
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
            <button type="submit" className="btn btn-primary btn-sm">
              Save firm details
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
