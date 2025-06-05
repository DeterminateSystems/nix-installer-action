import got from "got";

export interface Event {
  v: string;
  c: string;
  drv: string;
  timing: {
    startTime: Date;
    durationSeconds: number;
  };
}

export interface ParsedEventsResult {
  readonly events: Event[];
  readonly hasMismatches: boolean;
}

export function parseEvents(data: unknown): ParsedEventsResult {
  let hasMismatches = false;

  if (!Array.isArray(data)) {
    return { events: [], hasMismatches };
  }

  const events = data.flatMap((event) => {
    // If this was a hash mismatch event, note it and move on
    if (event.v === "1" && event.c === "HashMismatchResponseEventV1") {
      hasMismatches = true;
      return [];
    }

    // Otherwise, determine if it's an event we're interested in
    if (
      event.v === "1" &&
      (event.c === "BuildFailureResponseEventV1" ||
        event.c === "BuiltPathResponseEventV1") &&
      Object.hasOwn(event, "drv") &&
      typeof event.drv === "string" &&
      Object.hasOwn(event, "timing") &&
      typeof event.timing === "object" &&
      event.timing !== null
    ) {
      const timing = event.timing as { [key: string]: unknown };

      if (
        Object.hasOwn(timing, "startTime") &&
        typeof timing.startTime === "string" &&
        Object.hasOwn(timing, "durationSeconds") &&
        typeof timing.durationSeconds === "number"
      ) {
        const date = Date.parse(timing.startTime);
        if (!Number.isNaN(date)) {
          return [
            {
              v: event.v,
              c: event.c,
              drv: event.drv,
              timing: {
                startTime: new Date(date),
                durationSeconds: timing.durationSeconds,
              },
            },
          ];
        }
      }
    }

    return [];
  });

  return { events, hasMismatches };
}

export async function getRecentEvents(
  since: Date,
): Promise<ParsedEventsResult> {
  const queryParam = encodeURIComponent(since.toISOString());

  const resp = await got
    .get(
      `http://unix:/nix/var/determinate/determinate-nixd.socket:/events/recent?since=${queryParam}`,
      {
        enableUnixSockets: true,
      },
    )
    .json();

  return parseEvents(resp);
}
