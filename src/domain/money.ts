/** Formats whole rupees with Indian digit grouping, e.g. 182457 -> "₹1,82,457". */
export function formatINR(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const digits = Math.round(Math.abs(amount)).toString();
  const lastThree = digits.slice(-3);
  const rest = digits.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",")},${lastThree}` : lastThree;
  return `${sign}₹${grouped}`;
}

export function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
