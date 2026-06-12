// Runtime feature flags, read from env. Server-only — flags gate
// behaviour, not UI secrets, but they're resolved on the server and the
// boolean is passed down to client components as a prop.
//
// SEND_TO_CLIENT_ENABLED gates whether a generated letter can be emailed
// to the client. OFF (the default) is a hard safety floor: the send API
// forces the recipient to the lawyer's own connected mailbox regardless
// of what the UI asks for, so a draft can never reach a client by
// accident. ON lets the lawyer choose / confirm a client recipient.
//
// A flag is enabled only for the explicit truthy strings below — any
// other value (including unset) is treated as off.
function envFlag(name: string): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export function sendToClientEnabled(): boolean {
  return envFlag('SEND_TO_CLIENT_ENABLED');
}
