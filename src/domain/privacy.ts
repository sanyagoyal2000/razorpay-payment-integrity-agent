/** "varun.reddy33@yahoo.co.in" → "v•••••••••••@yahoo.co.in". */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  if (!domain) return "•••";
  return `${local.slice(0, 1)}${"•".repeat(Math.max(3, local.length - 1))}@${domain}`;
}

/** "+91 79959 56219" → "+91 ••••• •6219": keeps the country code and last four digits. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 4) return "••••";
  const last = digits.slice(-4);
  const country = phone.trim().startsWith("+") ? `+${digits.slice(0, digits.length - 10)} ` : "";
  return `${country}••••• •${last}`;
}
