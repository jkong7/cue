const RULES: [RegExp, string][] = [
  [/\b(?:\d[ -]?){12,18}\d\b/g, "[card number]"],
  [/\b\d{3}-\d{2}-\d{4}\b/g, "[ssn]"],
  [/\b(sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g, "[secret key]"],
  [/\bsk-ant-[A-Za-z0-9_-]{10,}\b/g, "[secret key]"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "[secret key]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "[secret key]"],
  [/\b(password|passcode|pin)\s*(is|:)\s*\S+/gi, "$1 $2 [redacted]"],
];

export function redact(text: string): string {
  return RULES.reduce((t, [re, sub]) => t.replace(re, sub), text);
}
