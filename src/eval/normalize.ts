export function normalizeText(
  input: string,
  opts?: {
    macrons?: boolean;
    case?: "insensitive" | "sensitive";
    trim?: boolean;
    // Strip surrounding quotes if the whole answer is wrapped
    stripOuterQuotes?: boolean;
    // Remove punctuation characters while preserving letters incl. macrons
    punctuation?: "strip" | "keep";
    // Collapse internal whitespace to single spaces
    whitespace?: "collapse" | "keep";
  }
): string {
  let out = input ?? "";
  if (opts?.trim ?? true) out = out.trim();
  if ((opts?.case ?? "insensitive") === "insensitive")
    out = out.toLocaleLowerCase();
  if (opts?.macrons ?? true) out = normalizeMacrons(out);
  if (opts?.stripOuterQuotes) out = stripOuterQuotes(out);
  // Default to stripping punctuation (common harmless differences like trailing full stops)
  if ((opts?.punctuation ?? "strip") === "strip") out = stripPunctuation(out);
  if ((opts?.whitespace ?? "keep") === "collapse")
    out = collapseWhitespace(out);
  return out;
}

export function normalizeMacrons(input: string): string {
  // Normalize common macron variants to NFC
  return input.normalize("NFC");
}

function stripOuterQuotes(input: string): string {
  const s = input.trim();
  const pairs: [string, string][] = [
    ["'", "'"],
    ['"', '"'],
    ["“", "”"],
    ["‘", "’"],
    ["`", "`"],
  ];
  for (const [l, r] of pairs) {
    if (s.startsWith(l) && s.endsWith(r) && s.length >= 2) {
      return s.slice(1, -1).trim();
    }
  }
  return input;
}

function stripPunctuation(input: string): string {
  // Keep letters (incl. macrons) and whitespace; drop everything else
  return input.replace(/[^\p{L}\s]/gu, "");
}

function collapseWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}
