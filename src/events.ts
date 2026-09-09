import got from "got";

export interface DEvent {
  v: string;
  c: string;
  drv: string;
  timing: {
    startTime: Date;
    durationSeconds: number;
  };
}

export interface ParsedEventsResult {
  readonly events: DEvent[];
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

/** Where determinate-nixd listens. */
const DAEMON_SOCKET = "/nix/var/determinate/determinate-nixd.socket";

/**
 * The events determinate-nixd recorded since `since`, or undefined when this
 * machine has no determinate-nixd to ask.
 *
 * A machine that runs upstream Nix has no socket at {@link DAEMON_SOCKET}.
 * It therefore reports no events, which is a normal outcome and not a
 * failure of the caller.
 */
export async function getRecentEvents(
  since: Date,
): Promise<ParsedEventsResult | undefined> {
  const queryParam = encodeURIComponent(since.toISOString());

  try {
    const resp = await got
      .get(`http://unix:${DAEMON_SOCKET}:/events/recent?since=${queryParam}`, {
        enableUnixSockets: true,
      })
      .json();

    return parseEvents(resp);
  } catch (error: unknown) {
    if (isSocketAbsent(error)) {
      return undefined;
    }

    throw error;
  }
}

/**
 * Whether `error` reports that the socket is not there.
 *
 * A request to a Unix socket that does not exist fails with ENOENT.
 * `got` wraps the error of the request, thus the code can be on the error or
 * on its cause. Four links is more than any real chain.
 */
function isSocketAbsent(error: unknown): boolean {
  let candidate: unknown = error;

  for (let link = 0; link < 4 && candidate != null; link++) {
    // eslint-disable-next-line no-undef
    if ((candidate as NodeJS.ErrnoException).code === "ENOENT") {
      return true;
    }

    candidate = (candidate as { cause?: unknown }).cause;
  }

  return false;
}
