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
  getLog?: (drv: string) => Promise<string | undefined>,
): Promise<FailureSummary | undefined> {
  const failures = getBuildFailures(events);

  if (failures.length === 0) {
    return undefined;
  }

  const ret: FailureSummary = {
    logLines: [],
    markdownLines: [],
  };

  ret.logLines.push(
    `\u001b[38;2;255;0;0mBuild logs from ${failures.length} failure${failures.length === 1 ? "" : "s"}`,
  );
  ret.logLines.push(
    `Note: Look at the actions summary for a markdown rendering.`,
  );
  ret.markdownLines.push(`### Build error review :boom:`);
  ret.markdownLines.push("> [!NOTE]");
  ret.markdownLines.push(
    `> ${failures.length} build${failures.length === 1 ? "" : "s"} failed`,
  );

  for (const event of failures) {
    ret.logLines.push(`::group::Failed build: ${event.drv}`);

    const log =
      (await (getLog ?? getLogFromNix)(event.drv)) ??
      "(failure reading the log for this derivation.)";
    const indented = log.split("\n").map((line) => `    ${line}`);

    ret.markdownLines.push(
      `<details><summary>Failure log: <code>${event.drv.replace(/^(\/nix[^-]*-)(.*)(\.drv)$/, "$1<strong>$2</strong>$3")}</code></summary>`,
    );
    ret.markdownLines.push("");

    for (const line of indented) {
      ret.logLines.push(line);
      ret.markdownLines.push(stripVTControlCharacters(line));
    }
    ret.markdownLines.push("");
    ret.markdownLines.push("</details>");
    ret.markdownLines.push("");
    ret.logLines.push(`::endgroup::`);
  }

  return ret;
}

async function getLogFromNix(drv: string): Promise<string | undefined> {
  const output = await getExecOutput("nix", ["log", drv], {
    silent: true,
  });

  return output.stdout;
}
