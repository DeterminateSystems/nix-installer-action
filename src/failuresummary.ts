import { getExecOutput } from "@actions/exec";
import { DEvent } from "./events.js";
import { stripVTControlCharacters } from "node:util";

// CI summaries have a max length of "1024k" which I assume to be 1048576 bytes.
// Generously, the mermaid doc is about 50,000 bytes.
// Rounding it all down a bit further for wiggle room, that leaves lots of log space.
const defaultMaxSummaryLength = 995_000;

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
  maxLength: number = defaultMaxSummaryLength,
): Promise<FailureSummary | undefined> {
  const failures = getBuildFailures(events);

  if (failures.length === 0) {
    return undefined;
  }

  const logLines = [];
  const markdownLines = [];

  logLines.push(
    `\u001b[38;2;255;0;0mBuild logs from ${failures.length} failure${failures.length === 1 ? "" : "s"}`,
  );
  logLines.push(
    `The following build logs are also available in the Markdown summary:`,
  );
  markdownLines.push(`### Build error review :boom:`);
  markdownLines.push("> [!NOTE]");
  markdownLines.push(
    `> ${failures.length} build${failures.length === 1 ? "" : "s"} failed`,
  );

  const markdownLogChunks: {
    drv: string;
    txtLines: string[];
    mdLines: string[];
  }[] = [];
  for (const event of failures) {
    const markdownLogChunk = [];
    const txtLogChunk = [];
    txtLogChunk.push(`::group::Failed build: ${event.drv}`);

    const log =
      (await getLog(event.drv)) ??
      "(failure reading the log for this derivation.)";
    const indented = log.split("\n").map((line) => `    ${line}`);

    markdownLogChunk.push(
      `<details><summary>Failure log: <code>${event.drv.replace(/^(\/nix[^-]*-)(.*)(\.drv)$/, "$1<strong>$2</strong>$3")}</code></summary>`,
    );
    markdownLogChunk.push("");

    for (const line of indented) {
      txtLogChunk.push(line);
      markdownLogChunk.push(stripVTControlCharacters(line));
    }
    markdownLogChunk.push("");
    markdownLogChunk.push("</details>");
    markdownLogChunk.push("");

    markdownLogChunks.push({
      drv: event.drv,
      mdLines: markdownLogChunk,
      txtLines: txtLogChunk,
    });
    txtLogChunk.push(`::endgroup::`);
  }

  const skippedChunks = [];

  // Add markdown log chunks until we exceed the max length
  let markdownLength = markdownLines.join("\n").length;
  for (const chunk of markdownLogChunks) {
    const chunkLength = chunk.mdLines.join("\n").length;
    if (markdownLength + chunkLength > maxLength) {
      skippedChunks.push(chunk);
    } else {
      logLines.push(...chunk.txtLines);
      markdownLines.push(...chunk.mdLines);
      markdownLength += chunkLength;
    }
  }

  if (skippedChunks.length > 0) {
    markdownLines.push(
      "> [!NOTE]",
      `> The following ${skippedChunks.length === 1 ? "failure has" : "failures have"} been ommitted due to GitHub Actions summary length limitations.`,
      "> The full logs are available in the post-run phase of the Nix Installer Action.",
    );

    logLines.push(
      "The following build logs are NOT available in the Markdown summary:",
    );
    for (const chunk of skippedChunks) {
      markdownLines.push(`> * \`${chunk.drv}\``);
      logLines.push(...chunk.txtLines);
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
