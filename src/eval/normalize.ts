export function normalizeText(
  input: string,
  opts?: {
    macrons?: boolean;
    case?: "insensitive" | "sensitive";
    trim?: boolean;
  }
): string {
  let out = input ?? "";
  if (opts?.trim ?? true) out = out.trim();
  if ((opts?.case ?? "insensitive") === "insensitive")
    out = out.toLocaleLowerCase();
  if (opts?.macrons ?? true) out = normalizeMacrons(out);
  return out;
}

export function normalizeMacrons(input: string): string {
  // Normalize common macron variants to NFC
  return input.normalize("NFC");
}
