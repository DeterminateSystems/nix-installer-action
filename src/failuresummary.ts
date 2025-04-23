import { getExecOutput } from "@actions/exec";
import { DEvent } from "./events.js";
import { stripVTControlCharacters } from "node:util";

export function getBuildFailures(events: DEvent[]): DEvent[] {
  return events.filter((event: DEvent): Boolean => {
    return event.c === "BuildFailureResponseEventV1";
  });
}

export interface FailureSummary {
  logLines: string[];
  markdownLines: string[];
}

export async function summarizeFailures(
  events: DEvent[],
  getLog: (drv: string) => Promise<string | undefined> = getLogFromNix,
  maxLength?: number,
): Promise<FailureSummary | undefined> {
  const failures = getBuildFailures(events);

  // CI summaries have a max length of "1024k" which I assume to be 1048576 bytes.
  // Generously, the mermaid doc is about 50,000 bytes.
  // Rounding it all down a bit further for wiggle room, that leaves lots of log space.
  if (maxLength === undefined) {
    maxLength = 995_000;
  }

  if (failures.length === 0) {
    return undefined;
  }

  const logLines = [];
  const markdownLines = [];

  logLines.push(
    `\u001b[38;2;255;0;0mBuild logs from ${failures.length} failure${failures.length === 1 ? "" : "s"}`,
  );
  logLines.push(`Note: Look at the actions summary for a markdown rendering.`);
  markdownLines.push(`### Build error review :boom:`);
  markdownLines.push("> [!NOTE]");
  markdownLines.push(
    `> ${failures.length} build${failures.length === 1 ? "" : "s"} failed`,
  );

  const markdownLogChunks: { drv: string; lines: string[] }[] = [];
  for (const event of failures) {
    const markdownLogChunk = [];
    logLines.push(`::group::Failed build: ${event.drv}`);

    const log =
      (await getLog(event.drv)) ??
      "(failure reading the log for this derivation.)";
    const indented = log.split("\n").map((line) => `    ${line}`);

    markdownLogChunk.push(
      `<details><summary>Failure log: <code>${event.drv.replace(/^(\/nix[^-]*-)(.*)(\.drv)$/, "$1<strong>$2</strong>$3")}</code></summary>`,
    );
    markdownLogChunk.push("");

    for (const line of indented) {
      logLines.push(line);
      markdownLogChunk.push(stripVTControlCharacters(line));
    }
    markdownLogChunk.push("");
    markdownLogChunk.push("</details>");
    markdownLogChunk.push("");

    markdownLogChunks.push({ drv: event.drv, lines: markdownLogChunk });
    logLines.push(`::endgroup::`);
  }

  const skippedDerivations: string[] = [];

  // Add markdown log chunks until we exceed the max length
  let markdownLength = markdownLines.join("\n").length;
  for (const chunk of markdownLogChunks) {
    const chunkLength = chunk.lines.join("\n").length;
    if (markdownLength + chunkLength > maxLength) {
      skippedDerivations.push(chunk.drv);
    } else {
      markdownLines.push(...chunk.lines);
      markdownLength += chunkLength;
    }
  }

  if (skippedDerivations.length > 0) {
    markdownLines.push(
      ...[
        "> [!NOTE]",
        `> The following ${skippedDerivations.length === 1 ? "failure has" : "failures have"} been ommitted due to GitHub Actions summary length limitations.`,
        "> The full logs are available in the post-run phase of the Nix Installer Action.",
      ],
    );

    for (const drv of skippedDerivations) {
      markdownLines.push(`> * \`${drv}\``);
    }
  }

  return { logLines, markdownLines };
}

async function getLogFromNix(drv: string): Promise<string | undefined> {
  const output = await getExecOutput("nix", ["log", drv], {
    silent: true,
  });

  return output.stdout;
}
