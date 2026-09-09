import * as actionsCore from "@actions/core";
import * as actionsExec from "@actions/exec";
import * as github from "@actions/github";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import fs, { mkdirSync, openSync } from "node:fs";
import { userInfo } from "node:os";
import stringArgv from "string-argv";
import * as path from "path";
import {
  DetSysAction,
  inputs,
  log,
  platform,
  recordSpanError,
  stringifyError,
  withSpan,
} from "@determinate-systems/detsys-ts";
import { setTimeout } from "node:timers/promises";
import { getFixHashes } from "./fixHashes.js";
import { annotateMismatches } from "./annotate.js";
import { DEvent, getRecentEvents } from "./events.js";
import { makeMermaidReport } from "./mermaid.js";
import { summarizeFailures } from "./failuresummary.js";
import { SpawnOptions, spawn } from "node:child_process";

// Feature flag names
const FEAT_ANNOTATIONS = "hash-mismatch-annotations";

// Attributes
const ATTR_DETERMINATE_NIX = "detsys.nix_installer.determinate_nix";
const ATTR_HAS_SYSTEMD = "detsys.nix_installer.has_systemd";
const ATTR_IN_ACT = "detsys.nix_installer.in_act";
const ATTR_IN_NAMESPACE_SO = "detsys.nix_installer.in_namespace_so";
const ATTR_NIX_INSTALLER_PLANNER = "detsys.nix_installer.planner";
const ATTR_SENT_SIGTERM = "detsys.nix_installer.sent_sigterm";
const ATTR_EXIT_CODE = "detsys.exit_code";
const ATTR_JOB_CONCLUSION = "detsys.nix_installer.job_conclusion";
const ATTR_LOGIN_SKIPPED_REASON = "detsys.flakehub.login_skipped_reason";
const ATTR_LOGIN_SUCCEEDED = "detsys.flakehub.login_succeeded";
const ATTR_FOD_MISMATCH_COUNT = "detsys.nix_installer.fod_mismatch_count";
const ATTR_SUMMARY_AVAILABLE = "detsys.nix_installer.summary_available";
const ATTR_BUILDS_SUCCEEDED = "detsys.nix_installer.builds_succeeded";
const ATTR_BUILDS_FAILED = "detsys.nix_installer.builds_failed";
const ATTR_BUILDS_UNKNOWN_EVENT = "detsys.nix_installer.builds_unknown_event";
const ATTR_IS_ROOT = "detsys.nix_installer.is_root";
const ATTR_KVM_ENABLED = "detsys.nix_installer.kvm_enabled";
const ATTR_DAEMON_PID = "detsys.nix_installer.daemon_pid";

// Flags
const FLAG_DETERMINATE = "--determinate";
const FLAG_PREFER_UPSTREAM_NIX = "--prefer-upstream-nix";

// Pre/post state keys
const STATE_DAEMONDIR = "DNI_DAEMONDIR";
const STATE_START_DATETIME = "DETERMINATE_NIXD_START_DATETIME";

class NixInstallerAction extends DetSysAction {
  private daemonDir: string;
  determinate: boolean;
  platform: string;
  nixPackageUrl: string | null;
  backtrace: string | null;
  extraArgs: string | null;
  extraConf: string[] | null;
  kvm: boolean;
  githubServerUrl: string | null;
  githubToken: string | null;
  forceNoSystemd: boolean;
  init: string | null;
  jobConclusion: string | null;
  localRoot: string | null;
  logDirectives: string | null;
  logger: string | null;
  sslCertFile: string | null;
  proxy: string | null;
  macCaseSensitive: string | null;
  macEncrypt: string | null;
  macRootDisk: string | null;
  macVolumeLabel: string | null;
  modifyProfile: boolean;
  nixBuildGroupId: number | null;
  nixBuildGroupName: string | null;
  nixBuildUserBase: number | null;
  nixBuildUserCount: number | null;
  nixBuildUserPrefix: string | null;
  planner: string | null;
  reinstall: boolean;
  startDaemon: boolean;
  trustRunnerUser: boolean;
  runnerOs: string | undefined;
  summarize: boolean;

  constructor() {
    if (platform.getArchOs() === "X64-macOS") {
      // Holy guacamole this is ugly
      log.error(
        "Determinate Nix Installer no longer supports macOS on Intel. Please migrate to Apple Silicon, and use Nix's built-in Rosetta support to build for Intel. See: https://github.com/DeterminateSystems/nix-src/issues/224",
      );
      const sourceTag = inputs.getStringOrUndefined("source-tag");
      if (sourceTag === undefined) {
        log.notice(
          "Pinning the installer tag to v3.12.2 (the last version to support Intel Macs) as a temporary fallback.",
        );
        process.env["INPUT_SOURCE-TAG"] = "v3.12.2";
      }
    }

    super({
      name: "nix-installer",
      fetchStyle: "nix-style",
      legacySourcePrefix: "nix-installer",
      requireNix: "ignore",
      diagnosticsSuffix: "diagnostic",
    });

    if (actionsCore.getState(STATE_DAEMONDIR) !== "") {
      this.daemonDir = actionsCore.getState(STATE_DAEMONDIR);
    } else {
      this.daemonDir = this.getTemporaryName();
      mkdirSync(this.daemonDir);
      actionsCore.saveState(STATE_DAEMONDIR, this.daemonDir);
    }

    this.determinate =
      inputs.getBool("determinate") || inputs.getBool("flakehub");
    this.platform = platform.getNixPlatform(platform.getArchOs());
    this.nixPackageUrl = inputs.getStringOrNull("nix-package-url");
    this.backtrace = inputs.getStringOrNull("backtrace");
    this.extraArgs = inputs.getStringOrNull("extra-args");
    this.extraConf = inputs.getMultilineStringOrNull("extra-conf");
    this.kvm = inputs.getBool("kvm");
    this.forceNoSystemd = inputs.getBool("force-no-systemd");
    this.githubToken = inputs.getStringOrNull("github-token");
    this.githubServerUrl = inputs.getStringOrNull("github-server-url");
    this.init = inputs.getStringOrNull("init");
    this.jobConclusion = inputs.getStringOrNull("job-status");
    this.localRoot = inputs.getStringOrNull("local-root");
    this.logDirectives = inputs.getStringOrNull("log-directives");
    this.logger = inputs.getStringOrNull("logger");
    this.sslCertFile = inputs.getStringOrNull("ssl-cert-file");
    this.proxy = inputs.getStringOrNull("proxy");
    this.macCaseSensitive = inputs.getStringOrNull("mac-case-sensitive");
    this.macEncrypt = inputs.getStringOrNull("mac-encrypt");
    this.macRootDisk = inputs.getStringOrNull("mac-root-disk");
    this.macVolumeLabel = inputs.getStringOrNull("mac-volume-label");
    this.modifyProfile = inputs.getBool("modify-profile");
    this.nixBuildGroupId = inputs.getNumberOrNull("nix-build-group-id");
    this.nixBuildGroupName = inputs.getStringOrNull("nix-build-group-name");
    this.nixBuildUserBase = inputs.getNumberOrNull("nix-build-user-base");
    this.nixBuildUserCount = inputs.getNumberOrNull("nix-build-user-count");
    this.nixBuildUserPrefix = inputs.getStringOrNull("nix-build-user-prefix");
    this.planner = inputs.getStringOrNull("planner");
    this.reinstall = inputs.getBool("reinstall");
    this.startDaemon = inputs.getBool("start-daemon");
    this.trustRunnerUser = inputs.getBool("trust-runner-user");
    this.summarize = inputs.getBool("summarize");
    this.runnerOs = process.env["RUNNER_OS"];
  }

  async main(): Promise<void> {
    actionsCore.saveState(STATE_START_DATETIME, new Date().toISOString());
    await this.detectAndForceNoSystemd();
    await this.install();
  }

  async post(): Promise<void> {
    await this.annotateMismatches();
    if (this.summarize) {
      try {
        await this.summarizeExecution();
      } catch (err: unknown) {
        // The summarize_execution span already carries the exception and the
        // error status, because withSpan recorded them before the throw. The
        // summary is a nice-to-have, thus the phase carries on.
        log.debug(`Could not summarize the execution: ${stringifyError(err)}`);
      }
    }
    await this.cleanupNoSystemd();
    await this.reportOverall();
  }

  private get isMacOS(): boolean {
    return this.runnerOs === "macOS";
  }

  private get isLinux(): boolean {
    return this.runnerOs === "Linux";
  }

  private get isRunningInAct(): boolean {
    return process.env["ACT"] !== undefined && !(process.env["NOT_ACT"] === "");
  }

  private get isRunningInNamespaceRunner(): boolean {
    return (
      process.env["NSC_VM_ID"] !== undefined &&
      !(process.env["NOT_NAMESPACE"] === "true")
    );
  }

  // Detect if we're in a GHA runner which is Linux and doesn't have Systemd.
  // This is a common case in self-hosted runners, providers like [Namespace](https://namespace.so/),
  // and especially GitHub Enterprise Server.
  async detectAndForceNoSystemd(): Promise<void> {
    // The group is the span of this operation. A second span inside it, for
    // the check on its own, would report the same work twice.
    return log.group("detect_systemd", "Detecting systemd...", async () => {
      if (!this.isLinux) {
        if (this.forceNoSystemd) {
          this.forceNoSystemd = false;
          log.warning(
            "Ignoring force-no-systemd which is set to true, as it is only supported on Linux.",
          );
        }
        return;
      }

      const systemdCheck = fs.statSync("/run/systemd/system", {
        throwIfNoEntry: false,
      });
      if (systemdCheck?.isDirectory()) {
        this.setAttribute(ATTR_HAS_SYSTEMD, true);
      } else {
        this.setAttribute(ATTR_HAS_SYSTEMD, false);

        this.forceNoSystemd = true;
        this.init = "none";
        this.planner = "linux";
      }
    });
  }

  private async executionEnvironment(): Promise<ExecuteEnvironment> {
    const executionEnv: ExecuteEnvironment = {};

    executionEnv.NIX_INSTALLER_NO_CONFIRM = "true";
    executionEnv.NIX_INSTALLER_DIAGNOSTIC_ATTRIBUTION = JSON.stringify(
      this.getCorrelationHashes(),
    );

    if (this.backtrace !== null) {
      executionEnv.RUST_BACKTRACE = this.backtrace;
    }
    if (this.modifyProfile !== null) {
      if (this.modifyProfile) {
        executionEnv.NIX_INSTALLER_MODIFY_PROFILE = "true";
      } else {
        executionEnv.NIX_INSTALLER_MODIFY_PROFILE = "false";
      }
    }

    if (this.nixBuildGroupId !== null) {
      executionEnv.NIX_INSTALLER_NIX_BUILD_GROUP_ID = `${this.nixBuildGroupId}`;
    }

    if (this.nixBuildGroupName !== null) {
      executionEnv.NIX_INSTALLER_NIX_BUILD_GROUP_NAME = this.nixBuildGroupName;
    }

    if (this.nixBuildUserPrefix !== null) {
      executionEnv.NIX_INSTALLER_NIX_BUILD_USER_PREFIX =
        this.nixBuildUserPrefix;
    }

    if (this.nixBuildUserCount !== null) {
      executionEnv.NIX_INSTALLER_NIX_BUILD_USER_COUNT = `${this.nixBuildUserCount}`;
    }

    if (this.nixBuildUserBase !== null) {
      executionEnv.NIX_INSTALLER_NIX_BUILD_USER_ID_BASE = `${this.nixBuildUserBase}`;
    }

    if (this.nixPackageUrl !== null) {
      executionEnv.NIX_INSTALLER_NIX_PACKAGE_URL = `${this.nixPackageUrl}`;
    }

    if (this.proxy !== null) {
      executionEnv.NIX_INSTALLER_PROXY = this.proxy;
    }

    if (this.sslCertFile !== null) {
      executionEnv.NIX_INSTALLER_SSL_CERT_FILE = this.sslCertFile;
    }

    executionEnv.NIX_INSTALLER_DIAGNOSTIC_ENDPOINT =
      (await this.getDiagnosticsUrl())?.toString() ?? "";

    // TODO: Error if the user uses these on not-MacOS
    if (this.macEncrypt !== null) {
      if (!this.isMacOS) {
        throw new Error("`mac-encrypt` while `$RUNNER_OS` was not `macOS`");
      }
      executionEnv.NIX_INSTALLER_ENCRYPT = this.macEncrypt;
    }

    if (this.macCaseSensitive !== null) {
      if (!this.isMacOS) {
        throw new Error(
          "`mac-case-sensitive` while `$RUNNER_OS` was not `macOS`",
        );
      }
      executionEnv.NIX_INSTALLER_CASE_SENSITIVE = this.macCaseSensitive;
    }

    if (this.macVolumeLabel !== null) {
      if (!this.isMacOS) {
        throw new Error(
          "`mac-volume-label` while `$RUNNER_OS` was not `macOS`",
        );
      }
      executionEnv.NIX_INSTALLER_VOLUME_LABEL = this.macVolumeLabel;
    }

    if (this.macRootDisk !== null) {
      if (!this.isMacOS) {
        throw new Error("`mac-root-disk` while `$RUNNER_OS` was not `macOS`");
      }
      executionEnv.NIX_INSTALLER_ROOT_DISK = this.macRootDisk;
    }

    if (this.logger !== null) {
      executionEnv.NIX_INSTALLER_LOGGER = this.logger;
    }

    if (this.logDirectives !== null) {
      executionEnv.NIX_INSTALLER_LOG_DIRECTIVES = this.logDirectives;
    }

    // TODO: Error if the user uses these on MacOS
    if (this.init !== null) {
      if (this.isMacOS) {
        throw new Error(
          "`init` is not a valid option when `$RUNNER_OS` is `macOS`",
        );
      }
      executionEnv.NIX_INSTALLER_INIT = this.init;
    }

    if (this.startDaemon !== null) {
      if (this.startDaemon) {
        executionEnv.NIX_INSTALLER_START_DAEMON = "true";
      } else {
        executionEnv.NIX_INSTALLER_START_DAEMON = "false";
      }
    }

    let extraConf = "";
    if (this.githubServerUrl !== null && this.githubToken !== null) {
      const serverUrl = this.githubServerUrl.replace("https://", "");
      extraConf += `access-tokens = ${serverUrl}=${this.githubToken}`;
      extraConf += "\n";
    }
    if (this.trustRunnerUser) {
      const user = userInfo().username;
      if (user) {
        extraConf += `trusted-users = root ${user}`;
      } else {
        extraConf += `trusted-users = root`;
      }
      extraConf += "\n";
    }
    extraConf += `build-provenance-tags = ${JSON.stringify(this.getBuildProvenanceTags())}\n`;
    if (this.extraConf !== null && this.extraConf.length !== 0) {
      extraConf += this.extraConf.join("\n");
      extraConf += "\n";
    }
    executionEnv.NIX_INSTALLER_EXTRA_CONF = extraConf;

    if (this.isRunningInAct) {
      this.setAttribute(ATTR_IN_ACT, true);
      log.info(
        "Detected `$ACT` environment, assuming this is a https://github.com/nektos/act created container, set `NOT_ACT=true` to override this. This will change the setting of the `init` to be compatible with `act`",
      );
      executionEnv.NIX_INSTALLER_INIT = "none";
    }

    if (this.isRunningInNamespaceRunner) {
      this.setAttribute(ATTR_IN_NAMESPACE_SO, true);
      log.info(
        "Detected Namespace runner, assuming this is a https://namespace.so created container, set `NOT_NAMESPACE=true` to override this. This will change the setting of the `init` to be compatible with Namespace",
      );
      executionEnv.NIX_INSTALLER_INIT = "none";
    }

    return executionEnv;
  }

  getBuildProvenanceTags(): Record<string, string> {
    const mapping = {
      GITHUB_WORKFLOW_REF: "github_workflow_ref",
      GITHUB_WORKFLOW_SHA: "github_workflow_sha",
      GITHUB_SHA: "github_sha",
      GITHUB_RUN_ATTEMPT: "github_run_attempt",
      GITHUB_RUN_ID: "github_run_id",
      GITHUB_RUN_NUMBER: "github_run_number",
      GITHUB_JOB: "github_job",
      GITHUB_REF: "github_ref",
      GITHUB_REPOSITORY: "github_repository",
      GITHUB_SERVER_URL: "github_server_url",
    };

    const tags = Object.entries(mapping)
      .map(([sourceKey, targetKey]) => [targetKey, process.env[sourceKey]])
      .filter(([_, value]) => value !== undefined);
    return { ...Object.fromEntries(tags), builder: "github-actions" };
  }

  private get installerArgs(): string[] {
    const args = ["install"];

    if (this.planner) {
      this.setAttribute(ATTR_NIX_INSTALLER_PLANNER, this.planner);
      args.push(this.planner);
    } else {
      this.setAttribute(ATTR_NIX_INSTALLER_PLANNER, this.defaultPlanner);
      args.push(this.defaultPlanner);
    }

    if (this.extraArgs) {
      const extraArgs = stringArgv(this.extraArgs);
      args.push(...extraArgs);
    }

    if (this.determinate) {
      this.setAttribute(ATTR_DETERMINATE_NIX, true);

      log.info(`Installing Determinate Nix using the ${FLAG_DETERMINATE} flag`);

      if (!this.extraArgs) {
        args.push(FLAG_DETERMINATE);
      }

      if (this.extraArgs && !this.extraArgs.includes(FLAG_DETERMINATE)) {
        args.push(FLAG_DETERMINATE);
      }
    } else {
      args.push(FLAG_PREFER_UPSTREAM_NIX);
    }

    return args;
  }

  private async executeInstall(binaryPath: string): Promise<number> {
    return withSpan("execute_install", async (span) => {
      const executionEnv = await this.executionEnvironment();

      const exitCode = await actionsExec.exec(binaryPath, this.installerArgs, {
        env: {
          ...executionEnv,
          ...process.env, // To get $PATH, etc
          ...(await this.getTelemetryEnvironment()),
        },
      });

      span.setAttribute(ATTR_EXIT_CODE, exitCode);

      if (exitCode !== 0) {
        // withSpan records the exception and sets the span status to error.
        throw new Error(`Non-zero exit code of \`${exitCode}\` detected`);
      }

      return exitCode;
    });
  }

  async install(): Promise<void> {
    return withSpan("install", async (span) => {
      const existingInstall = await this.detectExisting();
      if (existingInstall) {
        if (this.reinstall) {
          // We need to uninstall, then reinstall
          log.info(
            "Nix was already installed, `reinstall` is set, uninstalling for a reinstall",
          );
          await this.executeUninstall();
        } else {
          // We're already installed, and not reinstalling, just log in to FlakeHub, set GITHUB_PATH and finish early
          await this.setGithubPath();

          if (this.determinate) {
            await this.flakehubLogin();
          }

          log.info("Nix was already installed, using existing install");
          return;
        }
      }

      if (this.kvm) {
        const kvmEnabled = await this.setupKvm();

        span.setAttribute(ATTR_KVM_ENABLED, kvmEnabled);
        if (kvmEnabled) {
          log.info("\u001b[32m Accelerated KVM is enabled \u001b[33m⚡️");
          actionsCore.exportVariable("DETERMINATE_NIX_KVM", "1");
        } else {
          log.info("KVM is not available.");
          actionsCore.exportVariable("DETERMINATE_NIX_KVM", "0");
        }
      }

      await log.group("install_nix", "Installing Nix", async () => {
        const binaryPath = await this.fetchBinary();
        await this.executeInstall(binaryPath);
      });

      if (this.forceNoSystemd) {
        await this.spawnDetached();
      }

      await this.setGithubPath();

      if (this.determinate) {
        await this.flakehubLogin();
      }
    });
  }

  async spawnDetached(): Promise<void> {
    return log.group(
      "spawn_daemon",
      "Directly spawning the daemon, since systemd is not available.",
      async () => {
        const outputPath = path.join(this.daemonDir, "daemon.log");

        // The daemon log goes out as a log record if this phase fails. A log
        // record body has no length limit, and a span attribute is cut at
        // 8192 characters, thus more of the log arrives than an attribute
        // could carry.
        this.stapleFile("daemon.log", outputPath);

        const output = openSync(outputPath, "a");

        const daemonBin = this.determinate
          ? "/usr/local/bin/determinate-nixd"
          : "/nix/var/nix/profiles/default/bin/nix-daemon";
        const daemonCliFlags = this.determinate ? ["daemon"] : [];

        let executable: string;
        let args: string[];

        if (userInfo().uid === 0) {
          executable = daemonBin;
          args = daemonCliFlags;
        } else {
          executable = "sudo";
          args = [daemonBin].concat(daemonCliFlags);
        }

        const opts: SpawnOptions = {
          stdio: ["ignore", output, output],
          detached: true,
          env: {
            ...process.env,
            ...(await this.getTelemetryEnvironment()),
          },
        };

        // Display the final command for debugging purposes
        log.debug("Full daemon start command:");
        log.debug(`${executable} ${args.join(" ")}`);

        // Start the server, and wait for the socket to exist
        const daemon = spawn(executable, args, opts);

        const pidFile = path.join(this.daemonDir, "daemon.pid");
        if (daemon.pid) {
          this.setAttribute(ATTR_DAEMON_PID, daemon.pid);
          await writeFile(pidFile, daemon.pid.toString());
        }

        for (let i = 0; i <= 2400; i++) {
          // Approximately 2 minutes
          if (daemon.signalCode !== null || daemon.exitCode !== null) {
            let msg: string;
            if (daemon.signalCode) {
              msg = `Daemon was killed by signal ${daemon.signalCode}`;
            } else {
              msg = `Daemon exited with code ${daemon.exitCode}`;
            }

            throw new Error(msg);
          }

          if (await this.doesTheSocketExistYet()) {
            break;
          }

          await setTimeout(50);
        }

        if (!(await this.doesTheSocketExistYet())) {
          throw new Error("Timed out waiting for the daemon socket to appear.");
        }

        daemon.unref();
      },
    );
  }

  async doesTheSocketExistYet(): Promise<boolean> {
    const socketPath = "/nix/var/nix/daemon-socket/socket";
    try {
      await stat(socketPath);
      return true;
    } catch (error: unknown) {
      // eslint-disable-next-line no-undef
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        log.debug(`Socket '${socketPath}' does not exist yet`);
        return false;
      }

      log.warning(
        `Error waiting for the Nix Daemon socket: ${stringifyError(error)}`,
      );

      // The throw reaches the spawn_daemon span, and withSpan records the
      // exception there in the way OpenTelemetry defines.
      throw error;
    }
  }

  async summarizeExecution(): Promise<void> {
    return withSpan("summarize_execution", async (span) => {
      const startDate = new Date(actionsCore.getState(STATE_START_DATETIME));
      const recent = await getRecentEvents(startDate);

      if (recent === undefined) {
        // A runner with upstream Nix has no determinate-nixd to ask, thus
        // this run has no summary.
        span.setAttribute(ATTR_SUMMARY_AVAILABLE, false);
        log.debug(
          "determinate-nixd has no socket on this runner, so there is no build summary.",
        );
        return;
      }

      span.setAttribute(ATTR_SUMMARY_AVAILABLE, true);

      const { events, hasMismatches } = recent;

      span.setAttribute("detsys.event_count", events.length);
      span.setAttribute("detsys.has_mismatches", hasMismatches);

      await this.reportPassFailCount(events);

      const mermaidSummary = makeMermaidReport(events);
      const failureSummary = await summarizeFailures(events);

      const showResults = mermaidSummary || failureSummary || hasMismatches;

      if (showResults) {
        actionsCore.summary.addRaw(
          `## ![](https://avatars.githubusercontent.com/u/80991770?s=30) Determinate Nix build summary`,
          true,
        );
        actionsCore.summary.addRaw("\n", true);
      }

      if (mermaidSummary !== undefined) {
        actionsCore.summary.addRaw(mermaidSummary, true);
        actionsCore.summary.addRaw("\n", true);
      }

      if (hasMismatches) {
        actionsCore.summary.addRaw(
          [
            "> [!TIP]",
            "> Some derivations failed to build due to the hash in the Nix expression being outdated.",
            "> To find out how to automatically update your Nix expressions in GitHub Actions, see [our guide](https://docs.determinate.systems/guides/automatically-fix-hashes-in-github-actions).",
            "",
          ].join("\n"),
          true,
        );
      }

      if (failureSummary !== undefined) {
        for (const logLine of failureSummary.logLines) {
          log.info(logLine);
        }

        actionsCore.summary.addRaw(
          failureSummary.markdownLines.join("\n"),
          true,
        );
        actionsCore.summary.addRaw("\n", true);
      }

      if (showResults) {
        actionsCore.summary.addRaw("---", true);
        actionsCore.summary.addRaw(
          `_Please let us know what you think about this summary on the [Determinate Systems Discord](https://determinate.systems/discord)._`,
          true,
        );
        actionsCore.summary.addRaw("\n", true);
        await actionsCore.summary.write();
      }
    });
  }

  async reportPassFailCount(events: DEvent[]): Promise<void> {
    let built = 0;
    let failed = 0;
    let unknown = 0;

    for (const event of events) {
      switch (event.c) {
        case "BuiltPathResponseEventV1":
          built++;
          break;
        case "BuildFailureResponseEventV1":
          failed++;
          break;
        default:
          unknown++;
      }
    }

    this.setAttribute(ATTR_BUILDS_SUCCEEDED, built);
    this.setAttribute(ATTR_BUILDS_FAILED, failed);
    this.setAttribute(ATTR_BUILDS_UNKNOWN_EVENT, unknown);
  }

  async setGithubPath(): Promise<void> {
    // Interim versions of the `nix-installer` crate may have already manipulated `$GITHUB_PATH`, as root even! Accessing that will be an error.
    try {
      const paths = [];

      if (this.determinate) {
        paths.push("/usr/local/bin");
      }

      paths.push("/nix/var/nix/profiles/default/bin");
      paths.push(`${process.env["HOME"]}/.nix-profile/bin`);

      for (const p of paths) {
        actionsCore.addPath(p);
        log.debug(`Added \`${p}\` to \`$GITHUB_PATH\``);
      }
    } catch {
      log.info(
        "Skipping setting $GITHUB_PATH in action, the `nix-installer` crate seems to have done this already. From `nix-installer` version 0.11.0 and up, this step is done in the action. Prior to 0.11.0, this was only done in the `nix-installer` binary.",
      );
    }
  }

  async flakehubLogin(): Promise<void> {
    return withSpan("flakehub_login", async (span) => {
      const canLogin =
        process.env["ACTIONS_ID_TOKEN_REQUEST_URL"] &&
        process.env["ACTIONS_ID_TOKEN_REQUEST_TOKEN"];

      if (!canLogin) {
        const pr = github.context.payload.pull_request;
        const base = pr?.base?.repo?.full_name;
        const head = pr?.head?.repo?.full_name;

        if (pr && base !== head) {
          span.setAttribute(ATTR_LOGIN_SKIPPED_REASON, "fork");

          log.info(
            `FlakeHub is disabled because this is a fork. GitHub Actions does not allow OIDC authentication from forked repositories ("${head}" is not from the same repository as "${base}").`,
          );
          return;
        }

        span.setAttribute(ATTR_LOGIN_SKIPPED_REASON, "not-configured");

        log.info(
          "FlakeHub is disabled because the workflow is misconfigured. Please make sure that `id-token: write` and `contents: read` are set for this step's (or job's) permissions so that GitHub Actions provides OIDC token endpoints.",
        );
        log.info(
          `For more information, see https://docs.determinate.systems/guides/github-actions/#nix-installer-action`,
        );
        return;
      }

      // The span of the login command itself. The flakehub_login span around
      // it also covers the runs that do not log in at all.
      await log.group(
        "determinate_nixd_login",
        "Logging in to FlakeHub",
        async () => {
          try {
            await actionsExec.exec(`determinate-nixd`, [
              "login",
              "github-action",
            ]);
            span.setAttribute(ATTR_LOGIN_SUCCEEDED, true);
          } catch (e: unknown) {
            span.setAttribute(ATTR_LOGIN_SUCCEEDED, false);
            log.warning(`FlakeHub Login failure: ${stringifyError(e)}`);

            // The login failed, thus the span failed. The Action continues:
            // the caller catches nothing, because nothing is thrown.
            recordSpanError(span, e);
          }
        },
      );
    });
  }

  async executeUninstall(): Promise<number> {
    return withSpan("uninstall", async (span) => {
      const exitCode = await actionsExec.exec(
        `/nix/nix-installer`,
        ["uninstall"],
        {
          env: {
            NIX_INSTALLER_NO_CONFIRM: "true",
            ...process.env, // To get $PATH, etc
            ...(await this.getTelemetryEnvironment()),
          },
        },
      );

      span.setAttribute("detsys.exit_code", exitCode);

      if (exitCode !== 0) {
        throw new Error(`Non-zero exit code of \`${exitCode}\` detected`);
      }

      return exitCode;
    });
  }

  async detectExisting(): Promise<boolean> {
    return withSpan("detect_existing", async (span) => {
      const receiptPath = "/nix/receipt.json";
      try {
        await access(receiptPath);
        // There is a /nix/receipt.json
        span.setAttribute("detsys.existing_install", true);
        log.info(
          "\u001b[32m Nix is already installed: found /nix/receipt.json \u001b[33m",
        );
        return true;
      } catch {
        // No /nix/receipt.json
      }

      try {
        const exitCode = await actionsExec.exec("nix", ["--version"], {});

        if (exitCode === 0) {
          span.setAttribute("detsys.existing_install", true);
          log.info(
            "\u001b[32m Nix is already installed: `nix --version` exited 0 \u001b[33m",
          );
          // Working existing installation of `nix` available, possibly a self-hosted runner
          return true;
        }
      } catch {
        // nix --version was not successful
      }

      span.setAttribute("detsys.existing_install", false);
      return false;
    });
  }

  private async canAccessKvm(): Promise<boolean> {
    try {
      await access("/dev/kvm", fs.constants.R_OK | fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  // The group is the span of this operation. The caller used to wrap the call
  // in a group of its own, which reported the same work twice.
  private async setupKvm(): Promise<boolean> {
    return log.group("setup_kvm", "Configuring KVM", async ({ span }) => {
      const currentUser = userInfo();
      const isRoot = currentUser.uid === 0;
      const maybeSudo = isRoot ? "" : "sudo";

      span.setAttribute(ATTR_IS_ROOT, isRoot);

      // First check to see whether the current user can open the KVM device node
      if (await this.canAccessKvm()) {
        span.setAttribute("detsys.kvm_accessible", true);
        return true;
      }

      span.setAttribute("detsys.kvm_accessible", false);

      // The current user can't access KVM, so try adding a udev rule to allow access to all users and groups
      const kvmRules =
        "/etc/udev/rules.d/99-determinate-nix-installer-kvm.rules";
      try {
        const writeFileExitCode = await actionsExec.exec(
          "sh",
          [
            "-c",
            `echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | ${maybeSudo} tee ${kvmRules} > /dev/null`,
          ],
          {
            silent: true,
            listeners: {
              stdout: (data: Buffer) => {
                const trimmed = data.toString("utf-8").trimEnd();
                if (trimmed.length >= 0) {
                  log.debug(trimmed);
                }
              },
              stderr: (data: Buffer) => {
                const trimmed = data.toString("utf-8").trimEnd();
                if (trimmed.length >= 0) {
                  log.debug(trimmed);
                }
              },
            },
          },
        );

        if (writeFileExitCode !== 0) {
          throw new Error(
            `Non-zero exit code of \`${writeFileExitCode}\` detected while writing '${kvmRules}'`,
          );
        }

        const debugRootRunThrow = async (
          action: string,
          command: string,
          args: string[],
        ): Promise<void> => {
          if (!isRoot) {
            args = [command, ...args];
            command = "sudo";
          }
          const reloadExitCode = await actionsExec.exec(command, args, {
            silent: true,
            listeners: {
              stdout: (data: Buffer) => {
                const trimmed = data.toString("utf-8").trimEnd();
                if (trimmed.length >= 0) {
                  log.debug(trimmed);
                }
              },
              stderr: (data: Buffer) => {
                const trimmed = data.toString("utf-8").trimEnd();
                if (trimmed.length >= 0) {
                  log.debug(trimmed);
                }
              },
            },
          });

          if (reloadExitCode !== 0) {
            throw new Error(
              `Non-zero exit code of \`${reloadExitCode}\` detected while ${action}.`,
            );
          }
        };

        await debugRootRunThrow("reloading udev rules", "udevadm", [
          "control",
          "--reload-rules",
        ]);

        await debugRootRunThrow("triggering udev against kvm", "udevadm", [
          "trigger",
          "--name-match=kvm",
        ]);

        return true;
      } catch {
        if (isRoot) {
          await actionsExec.exec("rm", ["-f", kvmRules]);
        } else {
          await actionsExec.exec("sudo", ["rm", "-f", kvmRules]);
        }

        return false;
      }
    });
  }

  private async fetchBinary(): Promise<string> {
    if (!this.localRoot) {
      return await this.fetchExecutable();
    } else {
      const localPath = join(this.localRoot, `nix-installer-${this.platform}`);
      log.info(`Using binary ${localPath}`);
      return localPath;
    }
  }

  async cleanupNoSystemd(): Promise<void> {
    return withSpan("cleanup_no_systemd", async (span) => {
      if (!this.forceNoSystemd) {
        // Nothing to do, we didn't use the double fork
        return;
      }

      const pidFile = path.join(this.daemonDir, "daemon.pid");
      const pid = parseInt(await readFile(pidFile, { encoding: "ascii" }));
      log.debug(`found daemon pid: ${pid}`);
      if (!pid) {
        throw new Error("the daemon did not start successfully");
      }

      span.setAttribute("detsys.daemon_pid", pid);

      log.debug(`killing daemon process ${pid}`);

      try {
        // Repeatedly signal 0 the daemon to test if it is up.
        // If it exits, kill will raise an exception which breaks us out of this control flow and skips the sigterm.
        // If it doesn't exit in 30s, we SIGTERM it.
        for (let i = 0; i < 30 * 10; i++) {
          process.kill(pid, 0);
          await setTimeout(100);
        }

        span.setAttribute("detsys.sent_sigterm", true);
        this.setAttribute(ATTR_SENT_SIGTERM, true);
        log.info(`Sending the daemon a SIGTERM`);
        process.kill(pid, "SIGTERM");
      } catch {
        // Perfectly normal to get an exception here, because the process shut down.
      }

      if (actionsCore.isDebug()) {
        log.info("Entire log:");
        const entireLog = await readFile(
          path.join(this.daemonDir, "daemon.log"),
          "utf-8",
        );
        log.info(entireLog);
      }
    });
  }

  async reportOverall(): Promise<void> {
    // How the job ended is a property of the run, thus it belongs on the span
    // of the run and not in an event of its own.
    this.setAttribute(ATTR_JOB_CONCLUSION, this.jobConclusion ?? "unknown");
  }

  private get defaultPlanner(): string {
    if (this.isMacOS) {
      return "macos";
    } else if (this.isLinux) {
      return "linux";
    } else {
      throw new Error(
        `Unsupported \`RUNNER_OS\` (currently \`${this.runnerOs}\`)`,
      );
    }
  }

  private async annotateMismatches(): Promise<void> {
    return withSpan("annotate_mismatches", async (span) => {
      if (!this.determinate) {
        return;
      }

      const active = this.getFeature(FEAT_ANNOTATIONS)?.variant;
      if (!active) {
        log.debug("The annotations feature is disabled for this run");
        return;
      }

      try {
        log.debug("Getting hash fixes from determinate-nixd");

        const since = actionsCore.getState(STATE_START_DATETIME);
        const mismatches = await getFixHashes(since);
        if (mismatches.version !== "v1") {
          throw new Error(
            `Unsupported \`determinate-nixd fix hashes\` output (got ${mismatches.version}, expected v1)`,
          );
        }

        log.debug("Annotating mismatches");
        // One number, thus one attribute. It was a span attribute named
        // detsys.annotation_count and an event that held the same count.
        const count = annotateMismatches(mismatches);
        span.setAttribute(ATTR_FOD_MISMATCH_COUNT, count);
      } catch (error) {
        // Don't hard fail the action if something exploded; this feature is only a nice-to-have
        log.warning(`Could not consume hash mismatch events: ${error}`);

        // The operation failed, thus the span failed. The Action continues:
        // the caller catches nothing, because nothing is thrown.
        recordSpanError(span, error);
      }
    });
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
  NIX_INSTALLER_DIAGNOSTIC_ATTRIBUTION?: string;
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

function main(): void {
  new NixInstallerAction().execute();
}

main();
