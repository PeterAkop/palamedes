// Shared formatting helpers. Pure (no server deps) so they're safe to use
// in both server and client components.

// Format a money amount for display, e.g. formatCurrency(18000) -> "£18,000".
// Whole amounts drop the ".00"; non-integers keep 2 dp. Unknown currency
// codes fall back to "<amount> <CCY>".
export function formatCurrency(amount: number, currency = 'GBP'): string {
  if (!Number.isFinite(amount)) return '';
  const code = (currency || 'GBP').toUpperCase();
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: code,
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString('en-GB')} ${code}`;
  }
}

// Format a stored money fact value for display. New facts store the
// formatted string already (e.g. "£18,000"); legacy facts store
// "<amount> <CCY>" (e.g. "18000 GBP") — parse and reformat those so the UI
// is consistent without needing re-extraction.
export function formatMoneyDisplay(value: string): string {
  const match = value.trim().match(/^(-?[\d,]+(?:\.\d+)?)\s+([A-Za-z]{3})$/);
  if (!match) return value;
  const amount = Number.parseFloat(match[1].replace(/,/g, ''));
  if (!Number.isFinite(amount)) return value;
  return formatCurrency(amount, match[2]);
}
