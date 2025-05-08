import { mermaidify, makeMermaidReport } from "./mermaid.js";
import { DEvent, parseEvents } from "./events.js";
import { expect, test } from "vitest";

/* eslint-disable @typescript-eslint/no-non-null-assertion */

function generateEvents(count: number): DEvent[] {
  const events: DEvent[] = [];

  for (let i = 0; i < count; i++) {
    events.push({
      v: "1",
      c: "BuiltPathResponseEventV1",
      drv: `/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-${i}.drv`,
      timing: {
        startTime: new Date(i * 1000),
        durationSeconds: i,
      },
    });
  }

  return events;
}

test("Empty event list returns no report", () => {
  const report = makeMermaidReport([]);

  expect(report).toBeUndefined();
});

test("Create a very large report doc and make sure it is small enough", () => {
  const report = makeMermaidReport(generateEvents(2500))!;

  // Assert the `.drv` suffix was pruned (1 reference = the NOTE at the end)
  expect(report.match(/\.drv/g)!.length).equals(1);

  // Assert the `/nix/store` prefix was pruned (1 reference = the NOTE at the end)
  expect(report.match(/\/nix\/store\//g)!.length).equals(1);

  // Assert that some events were pruned
  expect(report.match(/dep-/g)!.length).lessThan(2500);
  expect(report.match(/dep-/g)!.length).greaterThan(1500);

  expect(report).toContain("suffix, and builds that took less than ");

  expect(report.length).lessThan(50200);
  expect(report.length).greaterThan(49000);
});

test("Create a medium large report doc and make sure it is small enough", () => {
  const eventCount = 675;
  const report = makeMermaidReport(generateEvents(eventCount))!;

  // Assert the `.drv` suffix was pruned (1 reference = the NOTE at the end)
  expect(report.match(/\.drv/g)!.length).equals(1);

  // Assert the `/nix/store` prefix was pruned (1 reference = the NOTE at the end)
  expect(report.match(/\/nix\/store\//g)!.length).equals(1);

  // Assert that no lines were pruned
  expect(report.match(/dep-/g)!.length).toStrictEqual(eventCount);

  expect(report).toContain(
    "suffixes have been removed to make the graph small enough to render",
  );

  expect(report.length).lessThan(50200);
  expect(report.length).greaterThan(18000);
});

test("Create a small report doc and make sure it isn't pruned", () => {
  const report = makeMermaidReport(generateEvents(100))!;

  // Assert 100 events have the `.drv` suffix, ie: were not pruned
  expect(report.match(/\.drv/g)!.length).equals(100);

  // Assert 100 events have the `.drv` suffix, ie: were not pruned
  expect(report.match(/\/nix\/store\//g)!.length).equals(100);

  expect(report.length).lessThan(50000);
});

test("Generate a really big report and shrink it", () => {
  const events = generateEvents(1000);

  const originalLength = mermaidify(events, -1)!.length;
  const limitedLengthZero = mermaidify(events, 0)!.length;
  const limitedLengthOne = mermaidify(events, 1)!.length;
  const limitedLengthTwo = mermaidify(events, 2)!.length;

  expect(originalLength).greaterThan(limitedLengthZero);
  expect(limitedLengthZero).greaterThan(limitedLengthOne);
  expect(limitedLengthOne).greaterThan(limitedLengthTwo);
});

test("Generate a rough report of various length", () => {
  const { events } = parseEvents([
    {
      v: "1",
      c: "BuiltPathResponseEventV1",
      drv: "/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-0.drv",
      outputs: ["/nix/store/qwlgz5da3pfb53gqpgdmazaj9jczrnly-dep-0"],
      timing: {
        startTime: "2025-04-11T14:38:02Z",
        stopTime: "2025-04-11T14:38:05Z",
        durationSeconds: 0,
      },
    },
    {
      v: "1",
      c: "BuiltPathResponseEventV1",
      drv: "/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv",
      outputs: ["/nix/store/qwlgz5da3pfb53gqpgdmazaj9jczrnly-dep-1"],
      timing: {
        startTime: "2025-04-11T14:38:02Z",
        stopTime: "2025-04-11T14:38:05Z",
        durationSeconds: 1,
      },
    },
    {
      v: "1",
      c: "BuiltPathResponseEventV1",
      drv: "/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-2.drv",
      outputs: ["/nix/store/qwlgz5da3pfb53gqpgdmazaj9jczrnly-dep-2"],
      timing: {
        startTime: "2025-04-11T14:38:02Z",
        stopTime: "2025-04-11T14:38:05Z",
        durationSeconds: 2,
      },
    },
    {
      v: "1",
      c: "BuildFailureResponseEventV1",
      drv: "/nix/store/ykvbksjqrza2zpj6nkbycrdfwgfdpr8g-hash-mismatch-md5-base16.drv",
      timing: {
        startTime: "2025-04-11T14:38:05Z",
        stopTime: "2025-04-11T14:38:09Z",
        durationSeconds: 4,
      },
    },
  ]);

  expect(mermaidify(events, -1)).toStrictEqual(`\`\`\`mermaid
gantt
    dateFormat X
    axisFormat %Mm%Ss
/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-0.drv (0s):d, 0, 0s
/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv (1s):d, 0, 1s
/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-2.drv (2s):d, 0, 2s
/nix/store/ykvbksjqrza2zpj6nkbycrdfwgfdpr8g-hash-mismatch-md5-base16.drv (4s):crit, 3, 4s
\`\`\``);

  expect(mermaidify(events, 0)).toStrictEqual(`\`\`\`mermaid
gantt
    dateFormat X
    axisFormat %Mm%Ss
dep-0 (0s):d, 0, 0s
dep-1 (1s):d, 0, 1s
dep-2 (2s):d, 0, 2s
hash-mismatch-md5-base16 (4s):crit, 3, 4s
\`\`\``);

  expect(mermaidify(events, 1)).toStrictEqual(`\`\`\`mermaid
gantt
    dateFormat X
    axisFormat %Mm%Ss
dep-1 (1s):d, 0, 1s
dep-2 (2s):d, 0, 2s
hash-mismatch-md5-base16 (4s):crit, 3, 4s
\`\`\``);
});

test("Generate a really big report and shrink it", () => {
  const events = generateEvents(1000);

  const originalLength = mermaidify(events, -1)!.length;
  const limitedLengthZero = mermaidify(events, 0)!.length;
  const limitedLengthOne = mermaidify(events, 1)!.length;
  const limitedLengthTwo = mermaidify(events, 2)!.length;

  expect(originalLength).greaterThan(limitedLengthZero);
  expect(limitedLengthZero).greaterThan(limitedLengthOne);
  expect(limitedLengthOne).greaterThan(limitedLengthTwo);
});

test("Really long builds get multi-unit timestamps", () => {
  const { events } = parseEvents([
    {
      v: "1",
      c: "BuiltPathResponseEventV1",
      drv: "/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-0.drv",
      outputs: ["/nix/store/qwlgz5da3pfb53gqpgdmazaj9jczrnly-dep-0"],
      timing: {
        startTime: "2025-04-11T14:38:02Z",
        stopTime: "2026-05-14T13:32:01Z",
        durationSeconds: 34383239,
      },
    },
  ]);

  expect(mermaidify(events, -1)).toStrictEqual(`\`\`\`mermaid
gantt
    dateFormat X
    axisFormat %Mm%Ss
/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-0.drv (573053m59s):d, 0, 34383239s
\`\`\``);
});
