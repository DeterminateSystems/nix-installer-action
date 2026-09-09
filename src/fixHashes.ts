import { getExecOutput } from "@actions/exec";
import { which } from "@actions/io";

/** The program that reports the hash mismatches. */
const DETERMINATE_NIXD = "determinate-nixd";

export interface Mismatch {
  readonly derivation: string;
  readonly replacement: string;
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

/**
 * The hash mismatches since `since`, or undefined when this runner has no
 * determinate-nixd to ask.
 *
 * A run whose install did not finish has no {@link DETERMINATE_NIXD} on the
 * path. It reports no mismatches, which is a normal outcome and not a failure
 * of the caller.
 */
export async function getFixHashes(
  since: string,
): Promise<FixHashesOutputV1 | undefined> {
  if ((await which(DETERMINATE_NIXD, false)) === "") {
    return undefined;
  }

  const output = await getExecOutput(
    DETERMINATE_NIXD,
    ["fix", "hashes", "--json", "--since", since],
    { silent: true },
  );

  if (output.exitCode !== 0) {
    throw new Error(
      `determinate-nixd fix hashes returned non-zero exit code ${output.exitCode} with the following error output:\n${output.stderr}`,
    );
  }

  return JSON.parse(output.stdout);
}
