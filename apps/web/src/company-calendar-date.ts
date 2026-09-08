const utcCalendarDate = (instant: Date) => instant.toISOString().slice(0, 10);

export function companyCalendarDate(
  timeZone: string | null | undefined,
  instant = new Date(),
) {
  const fallback = utcCalendarDate(instant);
  if (!timeZone?.trim()) return fallback;

  try {
    const parts = new Intl.DateTimeFormat("en-US-u-ca-iso8601-nu-latn", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    const value = (type: "year" | "month" | "day") =>
      parts.find((part) => part.type === type)?.value;
    const year = value("year");
    const month = value("month");
    const day = value("day");
    return year && month && day ? `${year}-${month}-${day}` : fallback;
  } catch (cause) {
    if (cause instanceof RangeError) return fallback;
    throw cause;
  }
}
