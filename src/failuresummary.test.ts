import { expect, test } from "vitest";
import {
  FailureSummary,
  getBuildFailures,
  summarizeFailures,
} from "./failuresummary.js";

/* eslint-disable @typescript-eslint/no-non-null-assertion */

test("Select for failure events", () => {
  const events = [
    {
      v: "1",
      c: "BuildFailureResponseEventV1",
      drv: `/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv`,
      timing: {
        startTime: new Date(1 * 1000),
        durationSeconds: 1,
      },
    },
    {
      v: "1",
      c: "BuiltPathResponseEventV1",
      drv: `/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-2.drv`,
      timing: {
        startTime: new Date(2 * 1000),
        durationSeconds: 2,
      },
    },
    {
      v: "1",
      c: "BuildFailureResponseEventV1",
      drv: `/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv`,
      timing: {
        startTime: new Date(3 * 1000),
        durationSeconds: 3,
      },
    },
  ];

  expect(getBuildFailures(events)).toStrictEqual([
    {
      v: "1",
      c: "BuildFailureResponseEventV1",
      drv: `/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv`,
      timing: {
        startTime: new Date(1 * 1000),
        durationSeconds: 1,
      },
    },
    {
      v: "1",
      c: "BuildFailureResponseEventV1",
      drv: `/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv`,
      timing: {
        startTime: new Date(3 * 1000),
        durationSeconds: 3,
      },
    },
  ]);
});

test("Summarize Failures", async () => {
  const events = [
    {
      v: "1",
      c: "BuildFailureResponseEventV1",
      drv: `/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv`,
      timing: {
        startTime: new Date(1 * 1000),
        durationSeconds: 1,
      },
    },
    {
      v: "1",
      c: "BuiltPathResponseEventV1",
      drv: `/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-2.drv`,
      timing: {
        startTime: new Date(2 * 1000),
        durationSeconds: 2,
      },
    },
    {
      v: "1",
      c: "BuildFailureResponseEventV1",
      drv: `/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv`,
      timing: {
        startTime: new Date(3 * 1000),
        durationSeconds: 3,
      },
    },
  ];

  const logMaker = async (drv: string): Promise<string | undefined> => {
    if (drv.includes("dep-1")) {
      return `${drv}\n`.repeat(9).trimEnd();
    } else {
      return `${drv}\n`.repeat(25).trimEnd();
    }
  };

  const summary: FailureSummary = (await summarizeFailures(events, logMaker))!;

  expect(summary.markdownLines.join("\n"))
    .toStrictEqual(`### Build error review :boom:
> [!NOTE]
> 2 builds failed
<details><summary>Failure log: <code>/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-<strong>dep-1</strong>.drv</code></summary>

    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv

</details>

<details><summary>Failure log: <code>/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-<strong>dep-3</strong>.drv</code></summary>

    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv

</details>
`);

  expect(summary.logLines.join("\n"))
    .toStrictEqual(`\u001b[38;2;255;0;0mBuild logs from 2 failures
The following build logs are also available in the Markdown summary:
::group::Failed build: /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
::endgroup::
::group::Failed build: /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
::endgroup::`);
});

test("Omit some logs if there are too many", async () => {
  const events = [
    {
      v: "1",
      c: "BuildFailureResponseEventV1",
      drv: `/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv`,
      timing: {
        startTime: new Date(1 * 1000),
        durationSeconds: 1,
      },
    },
    {
      v: "1",
      c: "BuiltPathResponseEventV1",
      drv: `/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-2.drv`,
      timing: {
        startTime: new Date(2 * 1000),
        durationSeconds: 2,
      },
    },
    {
      v: "1",
      c: "BuildFailureResponseEventV1",
      drv: `/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv`,
      timing: {
        startTime: new Date(3 * 1000),
        durationSeconds: 3,
      },
    },
  ];

  const logMaker = async (drv: string): Promise<string | undefined> => {
    return `${drv}\n`.repeat(5).trimEnd();
  };

  const summary: FailureSummary = (await summarizeFailures(
    events,
    logMaker,
    500,
  ))!;

  expect(summary.markdownLines.join("\n"))
    .toStrictEqual(`### Build error review :boom:
> [!NOTE]
> 2 builds failed
<details><summary>Failure log: <code>/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-<strong>dep-1</strong>.drv</code></summary>

    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv

</details>

> [!NOTE]
> The following failure has been ommitted due to GitHub Actions summary length limitations.
> The full logs are available in the post-run phase of the Nix Installer Action.
> * \`/nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv\``);

  expect(summary.logLines.join("\n"))
    .toStrictEqual(`\u001b[38;2;255;0;0mBuild logs from 2 failures
The following build logs are also available in the Markdown summary:
::group::Failed build: /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-1.drv
::endgroup::
The following build logs are NOT available in the Markdown summary:
::group::Failed build: /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
    /nix/store/rz9hrpay90sjrid5hx3x8v606ji679xa-dep-3.drv
::endgroup::`);
});
