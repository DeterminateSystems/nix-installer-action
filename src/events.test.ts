import { expect, test } from "vitest";
import { getRecentEvents, parseEvents } from "./events.js";

// Handy test for locally making sure you can fetch recent events:
// biome-ignore lint/correctness/noConstantCondition: testing
if (false) {
  test("Parsing existing events", async () => {
    expect(await getRecentEvents(new Date(Date.now() - 1000000))).toStrictEqual(
      [{}],
    );
  });
}

test("Parsing existing events", () => {
  const { events } = parseEvents([
    {
      v: "1",
      c: "BuiltPathResponseEventV1",
      drv: "/nix/store/m96zgji4fhi70s2zs6pq5pric6ch7p4h-stdenv-darwin.drv",
      outputs: ["/nix/store/dalhfz3l75w4b4q06sxzqgb2wfydvkbv-stdenv-darwin"],
      timing: null,
    },
    {
      v: "1",
      c: "BuiltPathResponseEventV1",
      drv: "/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv",
      outputs: ["/nix/store/qwlgz5da3pfb53gqpgdmazaj9jczrnly-dep-1"],
      timing: {
        startTime: "2025-04-11T14:38:02Z",
        stopTime: "2025-04-11T14:38:05Z",
        durationSeconds: 3,
      },
    },
    {
      v: "1",
      c: "BuildFailureResponseEventV1",
      drv: "/nix/store/ykvbksjqrza2zpj6nkbycrdfwgfdpr8g-hash-mismatch-md5-base16.drv",
      timing: {
        startTime: "2025-04-11T14:36:44Z",
        stopTime: "2025-04-11T14:36:44Z",
        durationSeconds: 0,
      },
    },
  ]);
  expect(events).toStrictEqual([
    {
      v: "1",
      c: "BuiltPathResponseEventV1",
      drv: "/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv",
      timing: {
        durationSeconds: 3,
        startTime: new Date("2025-04-11T14:38:02Z"),
      },
    },
    {
      v: "1",
      c: "BuildFailureResponseEventV1",
      drv: "/nix/store/ykvbksjqrza2zpj6nkbycrdfwgfdpr8g-hash-mismatch-md5-base16.drv",
      timing: {
        durationSeconds: 0,
        startTime: new Date("2025-04-11T14:36:44Z"),
      },
    },
  ]);
});
