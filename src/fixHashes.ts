import { getExecOutput } from "@actions/exec";

export interface Mismatch {
  readonly derivation: string;
  readonly expected: string;
}

export interface Fix {
  readonly line: number;
  readonly found: string;
  readonly mismatches: readonly Mismatch[];
}

export interface FileFix {
  readonly file: string;
  readonly fixes: readonly Fix[];
}

export interface FixHashesOutputV1 {
  readonly version: "v1";
  readonly files: readonly FileFix[];
}

export async function getFixHashes(): Promise<FixHashesOutputV1> {
  const output = await getExecOutput("determinate-nixd", [
    "fix",
    "hashes",
    "--json",
  ]);

  if (output.exitCode !== 0) {
    throw new Error(
      `determinate-nixd fix hashes returned non-zero exit code ${output.exitCode} with the following error output:\n${output.stderr}`,
    );
  }

  return JSON.parse(output.stdout);
}
