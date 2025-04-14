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

export function parseEvents(data: unknown): DEvent[] {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.flatMap((event) => {
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
}

export async function getRecentEvents(since: Date): Promise<DEvent[]> {
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
