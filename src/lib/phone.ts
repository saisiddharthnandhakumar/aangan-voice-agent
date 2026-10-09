/**
 * Normalise an Indian phone number to +91XXXXXXXXXX (E.164). Returns null when it cannot be
 * read as a 10-digit Indian mobile or landline. Other countries pass through if already E.164.
 */
export function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") && !trimmed.startsWith("+91")) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  let national = digits;
  if (national.startsWith("0091")) national = national.slice(4);
  else if (national.length === 12 && national.startsWith("91")) national = national.slice(2);
  else if (national.length === 11 && national.startsWith("0")) national = national.slice(1);
  return /^\d{10}$/.test(national) ? `+91${national}` : null;
}

/** The 10-digit national number, which HubSpot search wants (docs/PLATFORM_NOTES.md section 3.5). */
export function nationalNumber(e164: string): string {
  return e164.replace(/^\+91/, "");
}
