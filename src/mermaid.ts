import { DEvent } from "./events.js";

export function makeMermaidReport(events: DEvent[]): string | undefined {
  // # 50k is the max: https://github.com/mermaid-js/mermaid/blob/c269dc822c528e1afbde34e18a1cad03d972d4fe/src/defaultConfig.js#L55
  let mermaid: string | undefined;
  let pruneLevel = -2;

  do {
    pruneLevel += 1;
    mermaid = mermaidify(events, pruneLevel);
  } while ((mermaid?.length ?? 0) > 49900);

  if (mermaid === undefined) {
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
      `> \`/nix/store/[hash]\`, the \`.drv\` suffix, and builds that took less than ${pruneLevel}s have been removed to make the graph small enough to render.`,
    );
  }

  lines.push(""); // load bearing whitespace, deleting it breaks the details expander / markdown
  lines.push("</details>");

  return lines.join("\n");
}

export function mermaidify(
  events: DEvent[],
  pruneLevel: number,
): string | undefined {
  events = events.filter(
    (event) =>
      event.c === "BuiltPathResponseEventV1" ||
      event.c === "BuildFailureResponseEventV1",
  );
  events.sort(function (a: DEvent, b: DEvent) {
    return a.timing.startTime.getTime() - b.timing.startTime.getTime();
  });

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

    const label =
      pruneLevel >= 0
        ? event.drv
            .replace(/^\/nix\/store\/[a-z0-9]+-/, "")
            .replace(/\.drv$/, "")
        : event.drv;
    const tag = event.c === "BuildFailureResponseEventV1" ? "crit" : "d";
    const relativeStartTime =
      (event.timing.startTime.getTime() - zeroMoment) / 1000;

    lines.push(
      `${label} (${duration}s):${tag}, ${relativeStartTime}, ${duration}s`,
    );
  }
  lines.push("```");

  return lines.join("\n");
}
