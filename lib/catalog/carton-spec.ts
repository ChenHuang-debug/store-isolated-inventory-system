export type CartonSpecStatus = "pending" | "confirmed";

export function formatCartonSpec(
  unitsPerCarton: number | null,
  status: CartonSpecStatus,
  unit = "件",
) {
  if (status === "confirmed") return `${unitsPerCarton} ${unit}/箱`;
  return unitsPerCarton === null ? "待确认" : `临时 ${unitsPerCarton} / 待确认`;
}
