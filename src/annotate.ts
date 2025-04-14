import * as core from "@actions/core";

import type { Fix, FixHashesOutputV1, Mismatch } from "./fixHashes.js";

function prettyDerivation(derivation: string): string {
  return derivation.replace(/\/nix\/store\/\w+-/, "");
}

function annotateSingle(
  file: string,
  line: number,
  { derivation, replacement }: Mismatch,
): void {
  const pretty = prettyDerivation(derivation);
  core.error(
    `To correct the hash mismatch for ${pretty}, use ${replacement}`,
    {
      file,
      startLine: line,
    },
  );
}

function annotateMultiple(
  file: string,
  { line, found, mismatches }: Fix,
): void {
  const matches = mismatches
    .map(({ derivation, replacement }) => {
      const pretty = prettyDerivation(derivation);
      return `* For the derivation ${pretty}, use \`${replacement}\``;
    })
    .join("\n");

  core.error(
    `There are multiple replacements for the expression ${found}:\n${matches}`,
    {
      file,
      startLine: line,
    },
  );
}

function annotate(file: string, fix: Fix): void {
  if (fix.mismatches.length === 1) {
    annotateSingle(file, fix.line, fix.mismatches[0]);
  } else {
    annotateMultiple(file, fix);
  }
}

/**
 * Annotates fixed-output derivation hash mismatches using GitHub Actions'
 *
 * @param output The output of `determinate-nixd fix hashes --json`
 * @returns The number of annotations reported to the user
 */
export function annotateMismatches(output: FixHashesOutputV1): number {
  let count = 0;

  for (const { file, fixes } of output.files) {
    for (const fix of fixes) {
      annotate(file, fix);
      count++;
    }
  }

  return count;
}
