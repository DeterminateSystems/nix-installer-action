import * as actions_core from "@actions/core";
import * as github from "@actions/github";
import { mkdtemp, chmod, access } from "node:fs/promises";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream";
import fetch from "node-fetch";
import { promisify } from "node:util";
import fs from "node:fs";
import stringArgv from "string-argv";

class NixInstallerAction {
  platform: string;
  nix_package_url: string | null;
  backtrace: string | null;
  extra_args: string | null;
  extra_conf: string[] | null;
  github_token: string | null;
  // TODO: linux_init
  init: string | null;
  local_root: string | null;
  log_directives: string | null;
  logger: string | null;
  ssl_cert_file: string | null;
  proxy: string | null;
  mac_case_sensitive: string | null;
  mac_encrypt: string | null;
  mac_root_disk: string | null;
  mac_volume_label: string | null;
  modify_profile: boolean;
  nix_build_group_id: number | null;
  nix_build_group_name: string | null;
  nix_build_user_base: number | null;
  nix_build_user_count: number | null;
  nix_build_user_prefix: string | null;
  planner: string | null;
  reinstall: boolean;
  start_daemon: boolean;
  diagnostic_endpoint: string | null;
  trust_runner_user: boolean | null;
  nix_installer_url: URL;

  // Connects the installation diagnostic report to the post-run diagnostic report.
  // This is for monitoring the real impact of Nix updates, to avoid breaking large
  // swaths of users at once with botched Nix releases. For example:
  // https://github.com/NixOS/nix/issues/9052.
  attribution: string;

  constructor() {
    this.platform = get_nix_platform();
    this.nix_package_url = action_input_string_or_null("nix-package-url");
    this.backtrace = action_input_string_or_null("backtrace");
    this.extra_args = action_input_string_or_null("extra-args");
    this.extra_conf = action_input_multiline_string_or_null("extra-conf");
    this.github_token = action_input_string_or_null("github-token");
    this.init = action_input_string_or_null("init");
    this.local_root = action_input_string_or_null("local-root");
    this.log_directives = action_input_string_or_null("log-directives");
    this.logger = action_input_string_or_null("logger");
    this.ssl_cert_file = action_input_string_or_null("ssl-cert-file");
    this.proxy = action_input_string_or_null("proxy");
    this.mac_case_sensitive = action_input_string_or_null("mac-case-sensitive");
    this.mac_encrypt = action_input_string_or_null("mac-encrypt");
    this.mac_root_disk = action_input_string_or_null("mac-root-disk");
    this.mac_volume_label = action_input_string_or_null("mac-volume-label");
    this.modify_profile = action_input_bool("modify-profile");
    this.nix_build_group_id = action_input_number_or_null("nix-build-group-id");
    this.nix_build_group_name = action_input_string_or_null(
      "nix-build-group-name",
    );
    this.nix_build_user_base = action_input_number_or_null(
      "nix_build-user-base",
    );
    this.nix_build_user_count = action_input_number_or_null(
      "nix-build-user-count",
    );
    this.nix_build_user_prefix = action_input_string_or_null(
      "nix-build-user-prefix",
    );
    this.planner = action_input_string_or_null("planner");
    this.reinstall = action_input_bool("reinstall");
    this.start_daemon = action_input_bool("start-daemon");
    this.diagnostic_endpoint = action_input_string_or_null(
      "diagnostic-endpoint",
    );
    this.trust_runner_user = action_input_bool("trust-runner-user");
    this.nix_installer_url = resolve_nix_installer_url(this.platform);
    this.attribution = randomUUID();
  }

  private executionEnvironment(): ExecuteEnvironment {
    const execution_env: ExecuteEnvironment = {};

    execution_env.NIX_INSTALLER_NO_CONFIRM = "true";
    execution_env.NIX_INSTALLER_ATTRIBUTION = `GH-${this.attribution}`;

    if (this.backtrace !== null) {
      execution_env.RUST_BACKTRACE = this.backtrace;
    }
    if (this.modify_profile !== null) {
      if (this.modify_profile) {
        execution_env.NIX_INSTALLER_MODIFY_PROFILE = "true";
      } else {
        execution_env.NIX_INSTALLER_MODIFY_PROFILE = "false";
      }
    }

    if (this.nix_build_group_id !== null) {
      execution_env.NIX_INSTALLER_NIX_BUILD_GROUP_ID = `${this.nix_build_group_id}`;
    }

    if (this.nix_build_group_name !== null) {
      execution_env.NIX_INSTALLER_NIX_BUILD_GROUP_NAME =
        this.nix_build_group_name;
    }

    if (this.nix_build_user_prefix !== null) {
      execution_env.NIX_INSTALLER_NIX_BUILD_USER_PREFIX =
        this.nix_build_user_prefix;
    }

    if (this.nix_build_user_count !== null) {
      execution_env.NIX_INSTALLER_NIX_BUILD_USER_COUNT = `${this.nix_build_user_count}`;
    }

    if (this.nix_build_user_base !== null) {
      execution_env.NIX_INSTALLER_NIX_BUILD_USER_ID_BASE = `${this.nix_build_user_count}`;
    }

    if (this.nix_package_url !== null) {
      execution_env.NIX_INSTALLER_NIX_PACKAGE_URL = `${this.nix_package_url}`;
    }

    if (this.proxy !== null) {
      execution_env.NIX_INSTALLER_PROXY = this.proxy;
    }

    if (this.ssl_cert_file !== null) {
      execution_env.NIX_INSTALLER_SSL_CERT_FILE = this.ssl_cert_file;
    }

    if (this.diagnostic_endpoint !== null) {
      execution_env.NIX_INSTALLER_DIAGNOSTIC_ENDPOINT =
        this.diagnostic_endpoint;
    }

    // TODO: Error if the user uses these on not-MacOS
    if (this.mac_encrypt !== null) {
      if (process.env.RUNNER_OS !== "macOS") {
        throw new Error("`mac-encrypt` while `$RUNNER_OS` was not `macOS`");
      }
      execution_env.NIX_INSTALLER_ENCRYPT = this.mac_encrypt;
    }

    if (this.mac_case_sensitive !== null) {
      if (process.env.RUNNER_OS !== "macOS") {
        throw new Error(
          "`mac-case-sensitive` while `$RUNNER_OS` was not `macOS`",
        );
      }
      execution_env.NIX_INSTALLER_CASE_SENSITIVE = this.mac_case_sensitive;
    }

    if (this.mac_volume_label !== null) {
      if (process.env.RUNNER_OS !== "macOS") {
        throw new Error(
          "`mac-volume-label` while `$RUNNER_OS` was not `macOS`",
        );
      }
      execution_env.NIX_INSTALLER_VOLUME_LABEL = this.mac_volume_label;
    }

    if (this.mac_root_disk !== null) {
      if (process.env.RUNNER_OS !== "macOS") {
        throw new Error("`mac-root-disk` while `$RUNNER_OS` was not `macOS`");
      }
      execution_env.NIX_INSTALLER_ROOT_DISK = this.mac_root_disk;
    }

    if (this.logger !== null) {
      execution_env.NIX_INSTALLER_LOGGER = this.logger;
    }

    if (this.log_directives !== null) {
      execution_env.NIX_INSTALLER_LOG_DIRECTIVES = this.log_directives;
    }

    // TODO: Error if the user uses these on MacOS
    if (this.init !== null) {
      if (process.env.RUNNER_OS === "macOS") {
        throw new Error(
          "`init` is not a valid option when `$RUNNER_OS` is `macOS`",
        );
      }
      execution_env.NIX_INSTALLER_INIT = this.init;
    }

    if (this.start_daemon !== null) {
      if (this.start_daemon) {
        execution_env.NIX_INSTALLER_START_DAEMON = "true";
      } else {
        execution_env.NIX_INSTALLER_START_DAEMON = "false";
      }
    }

    let extra_conf = "";
    if (this.github_token !== null) {
      extra_conf += `access-tokens = github.com=${this.github_token}`;
      extra_conf += "\n";
    }
    if (this.trust_runner_user !== null) {
      extra_conf += `trusted-users = root ${process.env.USER}`;
      extra_conf += "\n";
    }
    if (this.extra_conf !== null && this.extra_conf.length !== 0) {
      extra_conf += this.extra_conf.join("\n");
      extra_conf += "\n";
    }
    execution_env.NIX_INSTALLER_EXTRA_CONF = extra_conf;

    if (process.env.ACT && !process.env.NOT_ACT) {
      actions_core.info(
        "Detected `$ACT` environment, assuming this is a https://github.com/nektos/act created container, set `NOT_ACT=true` to override this. This will change the setting of the `init` to be compatible with `act`",
      );
      execution_env.NIX_INSTALLER_INIT = "none";
    }

    return execution_env;
  }

  private async execute_install(binary_path: string): Promise<number> {
    const execution_env = this.executionEnvironment();
    actions_core.info(
      `Execution environment: ${JSON.stringify(execution_env, null, 4)}`,
    );

    const args = ["install"];
    if (this.planner) {
      args.push(this.planner);
    } else {
      args.push(get_default_planner());
    }

    if (this.extra_args) {
      const extra_args = stringArgv(this.extra_args);
      args.concat(extra_args);
    }

    const merged_env = {
      ...process.env, // To get $PATH, etc
      ...execution_env,
    };

    const spawned = spawn(`${binary_path}`, args, {
      env: merged_env,
    });

    spawned.stdout.setEncoding("utf-8");
    spawned.stdout.on("data", (data) => {
      const trimmed = data.trimEnd();
      if (trimmed.length >= 0) {
        actions_core.info(trimmed);
      }
    });

    spawned.stderr.setEncoding("utf-8");
    spawned.stderr.on("data", (data) => {
      const trimmed = data.trimEnd();
      if (trimmed.length >= 0) {
        actions_core.info(trimmed);
      }
    });

    const exit_code: number = await new Promise((resolve, _reject) => {
      spawned.on("close", resolve);
    });

    if (exit_code !== 0) {
      throw new Error(`Non-zero exit code of \`${exit_code}\` detected`);
    }

    return exit_code;
  }

  async install(): Promise<void> {
    const existing_install = await this.detect_existing();
    if (existing_install) {
      if (this.reinstall) {
        // We need to uninstall, then reinstall
        actions_core.info(
          "Nix was already installed, `reinstall` is set, uninstalling for a reinstall",
        );
        await this.execute_uninstall();
      } else {
        // We're already installed, and not reinstalling, just set GITHUB_PATH and finish early
        await this.set_github_path();
        actions_core.info("Nix was already installed, using existing install");
        return;
      }
    }
    // Normal just doing of the install
    const binary_path = await this.fetch_binary();
    await this.execute_install(binary_path);
    await this.set_github_path();
  }

  async set_github_path(): Promise<void> {
    // Interim versions of the `nix-installer` crate may have already manipulated `$GITHUB_PATH`, as root even! Accessing that will be an error.
    try {
      const nix_var_nix_profile_path = "/nix/var/nix/profiles/default/bin";
      const home_nix_profile_path = `${process.env.HOME}/.nix-profile/bin`;
      actions_core.addPath(nix_var_nix_profile_path);
      actions_core.addPath(home_nix_profile_path);
      actions_core.info(
        `Added \`${nix_var_nix_profile_path}\` and \`${home_nix_profile_path}\` to \`$GITHUB_PATH\``,
      );
    } catch (error) {
      actions_core.info(
        "Skipping setting $GITHUB_PATH in action, the `nix-installer` crate seems to have done this already. From `nix-installer` version 0.11.0 and up, this step is done in the action. Prior to 0.11.0, this was only done in the `nix-installer` binary.",
      );
    }
  }

  async execute_uninstall(): Promise<number> {
    const spawned = spawn(`/nix/nix-installer`, ["uninstall"], {
      env: {
        NIX_INSTALLER_NO_CONFIRM: "true",
        ...process.env, // To get $PATH, etc
      },
    });

    spawned.stdout.setEncoding("utf-8");
    spawned.stdout.on("data", (data) => {
      const trimmed = data.trimEnd();
      if (trimmed.length >= 0) {
        actions_core.info(trimmed);
      }
    });

    spawned.stderr.setEncoding("utf-8");
    spawned.stderr.on("data", (data) => {
      const trimmed = data.trimEnd();
      if (trimmed.length >= 0) {
        actions_core.info(trimmed);
      }
    });

    const exit_code: number = await new Promise((resolve, _reject) => {
      spawned.on("close", resolve);
    });

    if (exit_code !== 0) {
      throw new Error(`Non-zero exit code of \`${exit_code}\` detected`);
    }

    return exit_code;
  }

  async detect_existing(): Promise<boolean> {
    const receipt_path = "/nix/receipt.json";
    try {
      await access(receipt_path);
      // There is a /nix/receipt.json
      return true;
    } catch {
      // No /nix/receipt.json
      return false;
    }
  }

  private async fetch_binary(): Promise<string> {
    if (!this.local_root) {
      actions_core.info(`Fetching binary from ${this.nix_installer_url}`);
      const response = await fetch(this.nix_installer_url);
      if (!response.ok) {
        throw new Error(
          `Got a status of ${response.status} from \`${this.nix_installer_url}\`, expected a 200`,
        );
      }

      const tempdir = await mkdtemp(join(tmpdir(), "nix-installer-"));
      const tempfile = join(tempdir, `nix-installer-${this.platform}`);

      if (!response.ok) {
        throw new Error(`unexpected response ${response.statusText}`);
      }

      if (response.body !== null) {
        const streamPipeline = promisify(pipeline);
        await streamPipeline(response.body, fs.createWriteStream(tempfile));
        actions_core.info(`Downloaded \`nix-installer\` to \`${tempfile}\``);
      } else {
        throw new Error("No response body recieved");
      }

      // Make executable
      await chmod(tempfile, fs.constants.S_IXUSR | fs.constants.S_IXGRP);

      return tempfile;
    } else {
      const local_path = join(
        this.local_root,
        `nix-installer-${this.platform}`,
      );
      actions_core.info(`Using binary ${local_path}`);
      return local_path;
    }
  }

  async report_overall(): Promise<void> {
    if (this.diagnostic_endpoint == null) {
      return;
    }

    try {
      await fetch(this.diagnostic_endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          "post-github-workflow-run-report": true,
          conclusion: await this.get_workflow_conclusion(),
        }),
      });
    } catch (error) {
      actions_core.debug(
        `Error submitting post-run diagnostics report: ${error}`,
      );
    }
  }

  private async get_workflow_conclusion(): Promise<
    | undefined
    | "success"
    | "failure"
    | "cancelled"
    | "unknown"
    | "unknown-no-job"
  > {
    if (this.github_token == null) {
      return undefined;
    }

    try {
      const octokit = github.getOctokit(this.github_token);
      const jobs = await octokit.paginate(
        octokit.rest.actions.listJobsForWorkflowRun,
        {
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          run_id: github.context.runId,
        },
      );

      const job = jobs
        .filter((candidate) => candidate.name === github.context.job)
        .at(0);
      if (job === undefined) {
        return "unknown-no-job";
      }

      const outcomes = (job.steps || []).map((j) => j.conclusion || "unknown");

      // Possible values: success, failure, cancelled, or skipped
      // from: https://docs.github.com/en/actions/learn-github-actions/contexts

      if (outcomes.includes("failure")) {
        // Any failures fails the job
        return "failure";
      }
      if (outcomes.includes("cancelled")) {
        // Any cancellations cancels the job
        return "cancelled";
      }

      // Assume success if no jobs failed or were canceled
      return "success";
    } catch (error) {
      actions_core.debug(`Error determining final disposition: ${error}`);
      return "unknown";
    }
  }
}

type ExecuteEnvironment = {
  // All env vars are strings, no fanciness here.
  RUST_BACKTRACE?: string;
  NIX_INSTALLER_MODIFY_PROFILE?: string;
  NIX_INSTALLER_NIX_BUILD_GROUP_NAME?: string;
  NIX_INSTALLER_NIX_BUILD_GROUP_ID?: string;
  NIX_INSTALLER_NIX_BUILD_USER_PREFIX?: string;
  NIX_INSTALLER_NIX_BUILD_USER_COUNT?: string;
  NIX_INSTALLER_NIX_BUILD_USER_ID_BASE?: string;
  NIX_INSTALLER_NIX_PACKAGE_URL?: string;
  NIX_INSTALLER_PROXY?: string;
  NIX_INSTALLER_SSL_CERT_FILE?: string;
  NIX_INSTALLER_DIAGNOSTIC_ENDPOINT?: string;
  NIX_INSTALLER_ATTRIBUTION?: string;
  NIX_INSTALLER_ENCRYPT?: string;
  NIX_INSTALLER_CASE_SENSITIVE?: string;
  NIX_INSTALLER_VOLUME_LABEL?: string;
  NIX_INSTALLER_ROOT_DISK?: string;
  NIX_INSTALLER_INIT?: string;
  NIX_INSTALLER_START_DAEMON?: string;
  NIX_INSTALLER_NO_CONFIRM?: string;
  NIX_INSTALLER_EXTRA_CONF?: string;
  NIX_INSTALLER_LOG_DIRECTIVES?: string;
  NIX_INSTALLER_LOGGER?: string;
};

function get_nix_platform(): string {
  const env_os = process.env.RUNNER_OS;
  const env_arch = process.env.RUNNER_ARCH;

  if (env_os === "macOS" && env_arch === "X64") {
    return "x86_64-darwin";
  } else if (env_os === "macOS" && env_arch === "ARM64") {
    return "aarch64-darwin";
  } else if (env_os === "Linux" && env_arch === "X64") {
    return "x86_64-linux";
  } else if (env_os === "Linux" && env_arch === "ARM64") {
    return "aarch64-linux";
  } else {
    throw new Error(
      `Unsupported \`RUNNER_OS\` (currently \`${env_os}\`) and \`RUNNER_ARCH\` (currently \`${env_arch}\`)  combination`,
    );
  }
}

function get_default_planner(): string {
  const env_os = process.env.RUNNER_OS;

  if (env_os === "macOS") {
    return "macos";
  } else if (env_os === "Linux") {
    return "linux";
  } else {
    throw new Error(`Unsupported \`RUNNER_OS\` (currently \`${env_os}\`)`);
  }
}

function resolve_nix_installer_url(platform: string): URL {
  // Only one of these are allowed.
  const nix_installer_branch = action_input_string_or_null(
    "nix-installer-branch",
  );
  const nix_installer_pr = action_input_number_or_null("nix-installer-pr");
  const nix_installer_revision = action_input_string_or_null(
    "nix-installer-revision",
  );
  const nix_installer_tag = action_input_string_or_null("nix-installer-tag");
  const nix_installer_url = action_input_string_or_null("nix-installer-url");

  let resolved_nix_installer_url = null;
  let num_set = 0;

  if (nix_installer_branch !== null) {
    num_set += 1;
    resolved_nix_installer_url = new URL(
      `https://install.determinate.systems/nix/branch/${nix_installer_branch}/nix-installer-${platform}?ci=github`,
    );
  } else if (nix_installer_pr !== null) {
    num_set += 1;
    resolved_nix_installer_url = new URL(
      `https://install.determinate.systems/nix/pr/${nix_installer_pr}/nix-installer-${platform}?ci=github`,
    );
  } else if (nix_installer_revision !== null) {
    num_set += 1;
    resolved_nix_installer_url = new URL(
      `https://install.determinate.systems/nix/rev/${nix_installer_revision}/nix-installer-${platform}?ci=github`,
    );
  } else if (nix_installer_tag !== null) {
    num_set += 1;
    resolved_nix_installer_url = new URL(
      `https://install.determinate.systems/nix/tag/${nix_installer_tag}/nix-installer-${platform}?ci=github`,
    );
  } else if (nix_installer_url !== null) {
    num_set += 1;
    resolved_nix_installer_url = new URL(nix_installer_url);
  } else {
    resolved_nix_installer_url = new URL(
      `https://install.determinate.systems/nix/nix-installer-${platform}?ci=github`,
    );
  }

  if (num_set > 1) {
    throw new Error(
      `The following options are mututally exclusive, but ${num_set} were set: \`nix_installer_branch\`, \`nix_installer_pr\`, \`nix_installer_revision\`, \`nix_installer_tag\`, and \`nix_installer_url\``,
    );
  }
  return resolved_nix_installer_url;
}

function action_input_string_or_null(name: string): string | null {
  const value = actions_core.getInput(name);
  if (value === "") {
    return null;
  } else {
    return value;
  }
}

function action_input_multiline_string_or_null(name: string): string[] | null {
  const value = actions_core.getMultilineInput(name);
  if (value.length === 0) {
    return null;
  } else {
    return value;
  }
}

function action_input_number_or_null(name: string): number | null {
  const value = actions_core.getInput(name);
  if (value === "") {
    return null;
  } else {
    return Number(value);
  }
}

function action_input_bool(name: string): boolean {
  return actions_core.getBooleanInput(name);
}

async function main(): Promise<void> {
  try {
    const installer = new NixInstallerAction();

    const isPost = !!process.env["STATE_isPost"];
    if (!isPost) {
      actions_core.saveState("isPost", "true");
      await installer.install();
    } else {
      installer.report_overall();
    }
  } catch (error) {
    if (error instanceof Error) actions_core.setFailed(error);
  }
}

main();
