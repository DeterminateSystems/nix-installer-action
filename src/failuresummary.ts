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
  logLines.push(`Note: Look at the actions summary for a markdown rendering.`);
  markdownLines.push(`### Build error review :boom:`);
  markdownLines.push("> [!NOTE]");
  markdownLines.push(
    `> ${failures.length} build${failures.length === 1 ? "" : "s"} failed`,
  );

  for (const event of failures) {
    logLines.push(`::group::Failed build: ${event.drv}`);

    const log =
      (await getLog(event.drv)) ??
      "(failure reading the log for this derivation.)";
    const indented = log.split("\n").map((line) => `    ${line}`);

    markdownLines.push(
      `<details><summary>Failure log: <code>${event.drv.replace(/^(\/nix[^-]*-)(.*)(\.drv)$/, "$1<strong>$2</strong>$3")}</code></summary>`,
    );
    markdownLines.push("");

    for (const line of indented) {
      logLines.push(line);
      markdownLines.push(stripVTControlCharacters(line));
    }
    markdownLines.push("");
    markdownLines.push("</details>");
    markdownLines.push("");
    logLines.push(`::endgroup::`);
  }

  return { logLines, markdownLines };
}

async function getLogFromNix(drv: string): Promise<string | undefined> {
  const output = await getExecOutput("nix", ["log", drv], {
    silent: true,
  });

  return output.stdout;
}
