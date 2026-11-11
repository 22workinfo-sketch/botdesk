/**
 * Common and priority IANA Timezones supported in BackStage.
 * Users can also supply any valid IANA timezone name.
 */
export interface TimeZoneOption {
  value: string;
  label: string;
  region: string;
}

export const COMMON_TIMEZONES: TimeZoneOption[] = [
  { value: "Asia/Bangkok", label: "Asia/Bangkok (UTC+07:00 - Bangkok, Hanoi, Jakarta)", region: "Southeast Asia" },
  { value: "Asia/Yangon", label: "Asia/Yangon (UTC+06:30 - Myanmar Time)", region: "Southeast Asia" },
  { value: "Asia/Singapore", label: "Asia/Singapore (UTC+08:00 - Singapore, Kuala Lumpur)", region: "Southeast Asia" },
  { value: "UTC", label: "UTC (UTC+00:00 - Coordinated Universal Time)", region: "Global" },
  { value: "Asia/Tokyo", label: "Asia/Tokyo (UTC+09:00 - Tokyo, Seoul)", region: "East Asia" },
  { value: "Asia/Hong_Kong", label: "Asia/Hong_Kong (UTC+08:00 - Hong Kong, Beijing)", region: "East Asia" },
  { value: "Asia/Dubai", label: "Asia/Dubai (UTC+04:00 - Gulf Standard Time)", region: "Middle East" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata (UTC+05:30 - India Standard Time)", region: "South Asia" },
  { value: "Europe/London", label: "Europe/London (GMT/BST - London, Dublin)", region: "Europe" },
  { value: "Europe/Berlin", label: "Europe/Berlin (CET/CEST - Berlin, Paris, Rome)", region: "Europe" },
  { value: "America/New_York", label: "America/New_York (EST/EDT - New York, Toronto)", region: "Americas" },
  { value: "America/Chicago", label: "America/Chicago (CST/CDT - Chicago, Dallas)", region: "Americas" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (PST/PDT - Los Angeles, Vancouver)", region: "Americas" },
  { value: "Australia/Sydney", label: "Australia/Sydney (AEST/AEDT - Sydney, Melbourne)", region: "Oceania" },
];

/**
 * Validates whether a given string is a recognized IANA timezone identifier.
 */
export function isValidIanaTimeZone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== "string") return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

export interface ParsedZonedDateTimeResult {
  utcDate: Date;
  isoUtc: string;
  formattedLocal: string;
  timeZone: string;
}

/**
 * Parses date string (YYYY-MM-DD), time string (HH:mm), and IANA timezone into an exact UTC Date.
 * Validates date existence (e.g. rejects Feb 30) and detects DST gaps or invalid offsets.
 */
export function validateAndParseZonedDateTime(
  dateStr: string,
  timeStr: string,
  timeZone: string
): ParsedZonedDateTimeResult {
  const trimmedDate = (dateStr || "").trim();
  const trimmedTime = (timeStr || "").trim();
  const trimmedTz = (timeZone || "").trim();

  if (!trimmedDate) {
    throw new Error("Scheduled date is required (YYYY-MM-DD).");
  }
  if (!trimmedTime) {
    throw new Error("Scheduled time is required (HH:mm).");
  }
  if (!trimmedTz) {
    throw new Error("Timezone is required.");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmedDate)) {
    throw new Error(`Invalid date format "${trimmedDate}". Expected YYYY-MM-DD format.`);
  }

  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(trimmedTime)) {
    throw new Error(`Invalid time format "${trimmedTime}". Expected HH:mm 24-hour format.`);
  }

  if (!isValidIanaTimeZone(trimmedTz)) {
    throw new Error(`Invalid or unrecognized IANA timezone name: "${trimmedTz}".`);
  }

  const [year, month, day] = trimmedDate.split("-").map(Number);
  const timeParts = trimmedTime.split(":").map(Number);
  const hour = timeParts[0];
  const min = timeParts[1];
  const sec = timeParts[2] || 0;

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || min < 0 || min > 59) {
    throw new Error("Scheduled date or time components are out of valid astronomical range.");
  }

  // Treat input components as UTC initial guess
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, min, sec, 0));

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: trimmedTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const parts = formatter.formatToParts(utcGuess);
  const getVal = (type: string) => Number(parts.find((p) => p.type === type)?.value);

  let formattedHour = getVal("hour");
  if (formattedHour === 24) formattedHour = 0;

  const asTz = new Date(
    Date.UTC(
      getVal("year"),
      getVal("month") - 1,
      getVal("day"),
      formattedHour,
      getVal("minute"),
      getVal("second")
    )
  );

  const offsetMs = asTz.getTime() - utcGuess.getTime();
  const actualUtc = new Date(utcGuess.getTime() - offsetMs);

  // Round-trip verification: verify that actualUtc formatted in trimmedTz reproduces input values
  const rtParts = formatter.formatToParts(actualUtc);
  const getRt = (type: string) => Number(rtParts.find((p) => p.type === type)?.value);

  let rtHour = getRt("hour");
  if (rtHour === 24) rtHour = 0;

  if (
    getRt("year") !== year ||
    getRt("month") !== month ||
    getRt("day") !== day ||
    rtHour !== hour ||
    getRt("minute") !== min
  ) {
    throw new Error(
      `The specified local time (${trimmedDate} ${trimmedTime}) is invalid or does not exist in timezone "${trimmedTz}" (e.g. invalid calendar date or daylight saving transition gap).`
    );
  }

  const formattedLocal = new Intl.DateTimeFormat("en-US", {
    timeZone: trimmedTz,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(actualUtc);

  return {
    utcDate: actualUtc,
    isoUtc: actualUtc.toISOString(),
    formattedLocal,
    timeZone: trimmedTz,
  };
}

/**
 * Validates that a scheduled UTC date is at least `minSecondsInFuture` seconds in the future.
 */
export function validateFutureSchedule(utcDate: Date, minSecondsInFuture = 30): void {
  const now = Date.now();
  const target = utcDate.getTime();

  if (isNaN(target)) {
    throw new Error("Invalid schedule timestamp.");
  }

  if (target <= now) {
    throw new Error("Scheduled time must be in the future. Past dates cannot be scheduled.");
  }

  if (target < now + minSecondsInFuture * 1000) {
    throw new Error(
      `Scheduled time is too soon. Please select a time at least ${minSecondsInFuture} seconds in the future, or use "Send Now".`
    );
  }
}

/**
 * Formats a UTC date for user display in a specific timezone.
 */
export function formatScheduledDisplay(
  utcDate: Date | string | null | undefined,
  timeZone?: string | null
): string {
  if (!utcDate) return "Not scheduled";
  const dateObj = typeof utcDate === "string" ? new Date(utcDate) : utcDate;
  if (isNaN(dateObj.getTime())) return "Invalid date";

  const tz = timeZone && isValidIanaTimeZone(timeZone) ? timeZone : "UTC";

  try {
    const formatted = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      dateStyle: "medium",
      timeStyle: "short",
    }).format(dateObj);

    return `${formatted} (${tz})`;
  } catch {
    return dateObj.toISOString();
  }
}
