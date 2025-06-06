import { DEvent } from "./events.js";
import { truncateDerivation } from "./util.js";

export function makeMermaidReport(events: DEvent[]): string | undefined {
  // # 50k is the max: https://github.com/mermaid-js/mermaid/blob/c269dc822c528e1afbde34e18a1cad03d972d4fe/src/defaultConfig.js#L55
  const maxLength = 49900;
  let mermaid = "";
  let pruneLevel = -2;

  do {
    pruneLevel += 1;
    mermaid = mermaidify(events, pruneLevel) ?? "";
  } while (mermaid.length > maxLength);

  if (!mermaid) {
    return undefined;
  }

  const lines = [
    "<details open><summary><strong>Build timeline</strong> :hourglass_flowing_sand:</summary>",
    "", // load bearing whitespace, deleting it breaks the details expander / markdown
    mermaid,
    "", // load bearing whitespace, deleting it breaks the details expander / markdown
  ];

  if (pruneLevel === 0) {
    lines.push("> [!NOTE]");
    lines.push(
      "> `/nix/store/[hash]` and the `.drv` suffixes have been removed to make the graph small enough to render.",
    );
  } else if (pruneLevel > 0) {
    lines.push("> [!NOTE]");
    lines.push(
      `> \`/nix/store/[hash]\`, the \`.drv\` suffix, and builds that took less than ${formatDuration(pruneLevel)} have been removed to make the graph small enough to render.`,
    );
  }

  lines.push(""); // load bearing whitespace, deleting it breaks the details expander / markdown
  lines.push("</details>");

  return lines.join("\n");
}

export function mermaidify(
  allEvents: DEvent[],
  pruneLevel: number,
): string | undefined {
  const events = allEvents
    .filter(
      (event) =>
        event.c === "BuiltPathResponseEventV1" ||
        event.c === "BuildFailureResponseEventV1",
    )
    .sort(
      (a, b) => a.timing.startTime.getTime() - b.timing.startTime.getTime(),
    );

  const firstEvent = events.at(0);
  if (firstEvent === undefined) {
    return undefined;
  }

  const zeroMoment = firstEvent.timing.startTime.getTime();

  const lines = [
    "```mermaid",
    "gantt",
    "    dateFormat X",
    "    axisFormat %Mm%Ss",
  ];

  for (const event of events) {
    const duration = event.timing.durationSeconds;
    if (duration < pruneLevel) {
      continue;
    }

    const label = pruneLevel >= 0 ? truncateDerivation(event.drv) : event.drv;
    const tag = event.c === "BuildFailureResponseEventV1" ? "crit" : "d";
    const relativeStartTime =
      (event.timing.startTime.getTime() - zeroMoment) / 1000;

    lines.push(
      `${label} (${formatDuration(duration)}):${tag}, ${relativeStartTime}, ${duration}s`,
    );
  }
  lines.push("```");

  return lines.join("\n");
}

function formatDuration(duration: number): string {
  const durSeconds = duration % 60;
  const durMinutes = (duration - durSeconds) / 60;
  return `${durMinutes > 0 ? `${durMinutes}m` : ""}${durSeconds}s`;
}
