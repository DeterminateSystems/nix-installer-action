import * as actionsCore from "@actions/core";
import * as github from "@actions/github";
import * as actionsExec from "@actions/exec";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import fs from "node:fs";
import { userInfo } from "node:os";
import stringArgv from "string-argv";
import * as path from "path";
import { DetSysAction, inputs, platform, stringifyError } from "detsys-ts";
import { randomUUID } from "node:crypto";
import got from "got";

// Nix installation events
const EVENT_INSTALL_NIX_FAILURE = "install_nix_failure";
const EVENT_INSTALL_NIX_START = "install_nix_start";
const EVENT_INSTALL_NIX_SUCCESS = "install_nix_start";
const EVENT_SETUP_KVM = "setup_kvm";
const EVENT_UNINSTALL_NIX = "uninstall";

// Docker events
const EVENT_CLEAN_UP_DOCKER_SHIM = "clean_up_docker_shim";
const EVENT_START_DOCKER_SHIM = "start_docker_shim";

// FlakeHub events
const EVENT_LOGIN_TO_FLAKEHUB = "login_to_flakehub";

// Other events
const EVENT_CONCLUDE_WORKFLOW = "conclude_workflow";

// Facts
const FACT_DETERMINATE_NIX = "determinate_nix";
const FACT_HAS_DOCKER = "has_docker";
const FACT_HAS_SYSTEMD = "has_systemd";
const FACT_IN_ACT = "in_act";
const FACT_IN_NAMESPACE_SO = "in_namespace_so";
const FACT_NIX_INSTALLER_PLANNER = "nix_installer_planner";

// Flags
const FLAG_DETERMINATE = "--determinate";

type WorkflowConclusion =
  | "success"
  | "failure"
  | "cancelled"
  | "unavailable"
  | "no-jobs";

class NixInstallerAction extends DetSysAction {
  determinate: boolean;
  platform: string;
  nixPackageUrl: string | null;
  backtrace: string | null;
  extraArgs: string | null;
  extraConf: string[] | null;
  kvm: boolean;
  githubServerUrl: string | null;
  githubToken: string | null;
  forceDockerShim: boolean;
  init: string | null;
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

  constructor() {
    super({
      name: "nix-installer",
      fetchStyle: "nix-style",
      legacySourcePrefix: "nix-installer",
      requireNix: "ignore",
      diagnosticsSuffix: "diagnostic",
    });

    this.determinate =
      inputs.getBool("determinate") || inputs.getBool("flakehub");
    this.platform = platform.getNixPlatform(platform.getArchOs());
    this.nixPackageUrl = inputs.getStringOrNull("nix-package-url");
    this.backtrace = inputs.getStringOrNull("backtrace");
    this.extraArgs = inputs.getStringOrNull("extra-args");
    this.extraConf = inputs.getMultilineStringOrNull("extra-conf");
    this.kvm = inputs.getBool("kvm");
    this.forceDockerShim = inputs.getBool("force-docker-shim");
    this.githubToken = inputs.getStringOrNull("github-token");
    this.githubServerUrl = inputs.getStringOrNull("github-server-url");
    this.init = inputs.getStringOrNull("init");
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
    this.runnerOs = process.env["RUNNER_OS"];
  }

  async main(): Promise<void> {
    await this.scienceDebugFly();
    await this.detectAndForceDockerShim();
    await this.install();
  }

  async post(): Promise<void> {
    await this.cleanupDockerShim();
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

  async scienceDebugFly(): Promise<void> {
    try {
      const feat = this.getFeature("debug-probe-urls");
      if (feat === undefined || feat.payload === undefined) {
        return;
      }

      const { timeoutMs, url }: { timeoutMs: number; url: string } = JSON.parse(
        feat.payload,
      );
      try {
        const resp = await got.get(url, {
          timeout: {
            request: timeoutMs,
          },
        });

        this.recordEvent("debug-probe-urls:response", {
          debug_probe_urls_ip: resp.ip, // eslint-disable-line camelcase
          debug_probe_urls_ok: resp.ok, // eslint-disable-line camelcase
          debug_probe_urls_status_code: resp.statusCode, // eslint-disable-line camelcase
          debug_probe_urls_body: resp.body, // eslint-disable-line camelcase
          // eslint-disable-next-line camelcase
          debug_probe_urls_elapsed:
            (resp.timings.end ?? 0) - resp.timings.start,
        });
      } catch (e: unknown) {
        this.recordEvent("debug-probe-urls:exception", {
          debug_probe_urls_exception: stringifyError(e), // eslint-disable-line camelcase
        });
      }
    } catch (err: unknown) {
      this.recordEvent("debug-probe-urls:error", {
        exception: stringifyError(err),
      });
    }
  }

  // Detect if we're in a GHA runner which is Linux, doesn't have Systemd, and does have Docker.
  // This is a common case in self-hosted runners, providers like [Namespace](https://namespace.so/),
  // and especially GitHub Enterprise Server.
  async detectAndForceDockerShim(): Promise<void> {
    if (!this.isLinux) {
      if (this.forceDockerShim) {
        actionsCore.warning(
          "Ignoring force-docker-shim which is set to true, as it is only supported on Linux.",
        );
        this.forceDockerShim = false;
      }
      return;
    }

    if (this.isRunningInAct) {
      actionsCore.debug(
        "Not bothering to detect if the docker shim should be used, as it is typically incompatible with act.",
      );
      return;
    }

    const systemdCheck = fs.statSync("/run/systemd/system", {
      throwIfNoEntry: false,
    });
    if (systemdCheck?.isDirectory()) {
      this.addFact(FACT_HAS_SYSTEMD, true);
      if (this.forceDockerShim) {
        actionsCore.warning(
          "Systemd is detected, but ignoring it since force-docker-shim is enabled.",
        );
      } else {
        return;
      }
    }
    this.addFact(FACT_HAS_SYSTEMD, false);

    actionsCore.debug(
      "Linux detected without systemd, testing for Docker with `docker info` as an alternative daemon supervisor.",
    );

    this.addFact(FACT_HAS_DOCKER, false); // Set to false here, and only in the success case do we set it to true
    let exitCode;
    try {
      exitCode = await actionsExec.exec("docker", ["info"], {
        silent: true,
        listeners: {
          stdout: (data: Buffer) => {
            const trimmed = data.toString("utf-8").trimEnd();
            if (trimmed.length >= 0) {
              actionsCore.debug(trimmed);
            }
          },
          stderr: (data: Buffer) => {
            const trimmed = data.toString("utf-8").trimEnd();
            if (trimmed.length >= 0) {
              actionsCore.debug(trimmed);
            }
          },
        },
      });
    } catch {
      actionsCore.debug("Docker not detected, not enabling docker shim.");
      return;
    }

    if (exitCode !== 0) {
      if (this.forceDockerShim) {
        actionsCore.warning(
          "docker info check failed, but trying anyway since force-docker-shim is enabled.",
        );
      } else {
        return;
      }
    }
    this.addFact(FACT_HAS_DOCKER, true);

    if (
      !this.forceDockerShim &&
      (await this.detectDockerWithMountedDockerSocket())
    ) {
      actionsCore.debug(
        "Detected a Docker container with a Docker socket mounted, not enabling docker shim.",
      );
      return;
    }

    actionsCore.startGroup(
      "Enabling the Docker shim for running Nix on Linux in CI without Systemd.",
    );

    if (this.init !== "none") {
      actionsCore.info(`Changing init from '${this.init}' to 'none'`);
      this.init = "none";
    }
    if (this.planner !== "linux") {
      actionsCore.info(`Changing planner from '${this.planner}' to 'linux'`);
      this.planner = "linux";
    }

    this.forceDockerShim = true;

    actionsCore.endGroup();
  }

  // Detect if we are running under `act` or some other system which is not using docker-in-docker,
  // and instead using a mounted docker socket.
  // In the case of the socket mount solution, the shim will cause issues since the given mount paths will
  // equate to mount paths on the host, not mount paths to the docker container in question.
  async detectDockerWithMountedDockerSocket(): Promise<boolean> {
    let cgroupsBuffer;
    try {
      // If we are inside a docker container, the last line of `/proc/self/cgroup` should be
      // 0::/docker/$SOME_ID
      //
      // If we are not, the line will likely be `0::/`
      cgroupsBuffer = await readFile("/proc/self/cgroup", {
        encoding: "utf-8",
      });
    } catch (e) {
      actionsCore.debug(
        `Did not detect \`/proc/self/cgroup\` existence, bailing on docker container ID detection:\n${e}`,
      );
      return false;
    }

    const cgroups = cgroupsBuffer.trim().split("\n");
    const lastCgroup = cgroups[cgroups.length - 1];
    const lastCgroupParts = lastCgroup.split(":");
    const lastCgroupPath = lastCgroupParts[lastCgroupParts.length - 1];
    if (!lastCgroupPath.includes("/docker/")) {
      actionsCore.debug(
        "Did not detect a container ID, bailing on docker.sock detection",
      );
      return false;
    }
    // We are in a docker container, now to determine if this container is visible from
    // the `docker` command, and if so, if there is a `docker.socket` mounted.
    const lastCgroupPathParts = lastCgroupPath.split("/");
    const containerId = lastCgroupPathParts[lastCgroupPathParts.length - 1];

    // If we cannot `docker inspect` this discovered container ID, we'll fall through to the `catch` below.
    let stdoutBuffer = "";
    let stderrBuffer = "";
    let exitCode;
    try {
      exitCode = await actionsExec.exec("docker", ["inspect", containerId], {
        silent: true,
        listeners: {
          stdout: (data: Buffer) => {
            stdoutBuffer += data.toString("utf-8");
          },
          stderr: (data: Buffer) => {
            stderrBuffer += data.toString("utf-8");
          },
        },
      });
    } catch (e) {
      actionsCore.debug(
        `Could not execute \`docker inspect ${containerId}\`, bailing on docker container inspection:\n${e}`,
      );
      return false;
    }

    if (exitCode !== 0) {
      actionsCore.debug(
        `Unable to inspect detected docker container with id \`${containerId}\`, bailing on container inspection (exit ${exitCode}):\n${stderrBuffer}`,
      );
      return false;
    }

    const output = JSON.parse(stdoutBuffer);
    // `docker inspect $ID` prints an array containing objects.
    // In our use case, we should only see 1 item in the array.
    if (output.length !== 1) {
      actionsCore.debug(
        `Got \`docker inspect ${containerId}\` output which was not one item (was ${output.length}), bailing on docker.sock detection.`,
      );
      return false;
    }
    const item = output[0];
    // On this array item we want the `Mounts` field, which is an array
    // containing `{ Type, Source, Destination, Mode}`.
    // We are looking for a `Destination` ending with `docker.sock`.
    const mounts = item["Mounts"];
    if (typeof mounts !== "object") {
      actionsCore.debug(
        `Got non-object in \`Mounts\` field of \`docker inspect ${containerId}\` output, bailing on docker.sock detection.`,
      );
      return false;
    }

    let foundDockerSockMount = false;
    for (const mount of mounts) {
      const destination = mount["Destination"];
      if (typeof destination === "string") {
        if (destination.endsWith("docker.sock")) {
          foundDockerSockMount = true;
          break;
        }
      }
    }

    return foundDockerSockMount;
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
      executionEnv.NIX_INSTALLER_NIX_BUILD_USER_ID_BASE = `${this.nixBuildUserCount}`;
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
    if (this.extraConf !== null && this.extraConf.length !== 0) {
      extraConf += this.extraConf.join("\n");
      extraConf += "\n";
    }
    executionEnv.NIX_INSTALLER_EXTRA_CONF = extraConf;

    if (this.isRunningInAct) {
      this.addFact(FACT_IN_ACT, true);
      actionsCore.info(
        "Detected `$ACT` environment, assuming this is a https://github.com/nektos/act created container, set `NOT_ACT=true` to override this. This will change the setting of the `init` to be compatible with `act`",
      );
      executionEnv.NIX_INSTALLER_INIT = "none";
    }

    if (this.isRunningInNamespaceRunner) {
      this.addFact(FACT_IN_NAMESPACE_SO, true);
      actionsCore.info(
        "Detected Namespace runner, assuming this is a https://namespace.so created container, set `NOT_NAMESPACE=true` to override this. This will change the setting of the `init` to be compatible with Namespace",
      );
      executionEnv.NIX_INSTALLER_INIT = "none";
    }

    return executionEnv;
  }

  private get installerArgs(): string[] {
    const args = ["install"];

    if (this.planner) {
      this.addFact(FACT_NIX_INSTALLER_PLANNER, this.planner);
      args.push(this.planner);
    } else {
      this.addFact(FACT_NIX_INSTALLER_PLANNER, this.defaultPlanner);
      args.push(this.defaultPlanner);
    }

    if (this.extraArgs) {
      const extraArgs = stringArgv(this.extraArgs);
      args.push(...extraArgs);
    }

    if (this.determinate) {
      this.addFact(FACT_DETERMINATE_NIX, true);

      actionsCore.info(
        `Installing Determinate Nix using the ${FLAG_DETERMINATE} flag`,
      );

      if (!this.extraArgs) {
        args.push(FLAG_DETERMINATE);
      }

      if (this.extraArgs && !this.extraArgs.includes(FLAG_DETERMINATE)) {
        args.push(FLAG_DETERMINATE);
      }
    }

    return args;
  }

  private async executeInstall(binaryPath: string): Promise<number> {
    const executionEnv = await this.executionEnvironment();
    actionsCore.debug(
      `Execution environment: ${JSON.stringify(executionEnv, null, 4)}`,
    );

    this.recordEvent(EVENT_INSTALL_NIX_START);
    const exitCode = await actionsExec.exec(binaryPath, this.installerArgs, {
      env: {
        ...executionEnv,
        ...process.env, // To get $PATH, etc
      },
    });

    if (exitCode !== 0) {
      this.recordEvent(EVENT_INSTALL_NIX_FAILURE, {
        exitCode,
      });
      throw new Error(`Non-zero exit code of \`${exitCode}\` detected`);
    }

    this.recordEvent(EVENT_INSTALL_NIX_SUCCESS);

    return exitCode;
  }

  async install(): Promise<void> {
    const existingInstall = await this.detectExisting();
    if (existingInstall) {
      if (this.reinstall) {
        // We need to uninstall, then reinstall
        actionsCore.info(
          "Nix was already installed, `reinstall` is set, uninstalling for a reinstall",
        );
        await this.executeUninstall();
      } else {
        // We're already installed, and not reinstalling, just set GITHUB_PATH and finish early
        await this.setGithubPath();
        actionsCore.info("Nix was already installed, using existing install");
        return;
      }
    }

    if (this.kvm) {
      actionsCore.startGroup("Configuring KVM");
      if (await this.setupKvm()) {
        actionsCore.endGroup();
        actionsCore.info("\u001b[32m Accelerated KVM is enabled \u001b[33m⚡️");
        actionsCore.exportVariable("DETERMINATE_NIX_KVM", "1");
      } else {
        actionsCore.endGroup();
        actionsCore.info("KVM is not available.");
        actionsCore.exportVariable("DETERMINATE_NIX_KVM", "0");
      }
    }

    actionsCore.startGroup("Installing Nix");
    const binaryPath = await this.fetchBinary();
    await this.executeInstall(binaryPath);
    actionsCore.endGroup();

    if (this.forceDockerShim) {
      await this.spawnDockerShim();
    }

    if (this.determinate) {
      await this.flakehubLogin();
    }

    await this.setGithubPath();
  }

  async spawnDockerShim(): Promise<void> {
    actionsCore.startGroup(
      "Configuring the Docker shim as the Nix Daemon's process supervisor",
    );

    const images: { [key: string]: string } = {
      X64: path.join(__dirname, "/../docker-shim/amd64.tar.gz"),
      ARM64: path.join(__dirname, "/../docker-shim/arm64.tar.gz"),
    };

    const runnerArch = process.env["RUNNER_ARCH"];
    let arch;

    if (runnerArch === "X64") {
      arch = "X64";
    } else if (runnerArch === "ARM64") {
      arch = "ARM64";
    } else {
      throw Error("Architecture not supported in Docker shim mode.");
    }
    actionsCore.debug("Loading image: determinate-nix-shim:latest...");
    {
      const exitCode = await actionsExec.exec(
        "docker",
        ["image", "load", "--input", images[arch]],
        {
          silent: true,
          listeners: {
            stdout: (data: Buffer) => {
              const trimmed = data.toString("utf-8").trimEnd();
              if (trimmed.length >= 0) {
                actionsCore.debug(trimmed);
              }
            },
            stderr: (data: Buffer) => {
              const trimmed = data.toString("utf-8").trimEnd();
              if (trimmed.length >= 0) {
                actionsCore.debug(trimmed);
              }
            },
          },
        },
      );

      if (exitCode !== 0) {
        throw new Error(
          `Failed to build the shim image, exit code: \`${exitCode}\``,
        );
      }
    }

    {
      actionsCore.debug("Starting the Nix daemon through Docker...");

      const candidateDirectories = [
        {
          dir: "/bin",
          readOnly: true,
        },
        {
          dir: "/etc",
          readOnly: true,
        },
        {
          dir: "/home",
          readOnly: true,
        },
        {
          dir: "/lib",
          readOnly: true,
        },
        {
          dir: "/lib64",
          readOnly: true,
        },
        {
          dir: "/tmp",
          readOnly: false,
        },
        {
          dir: "/usr",
          readOnly: true,
        },
        {
          dir: "/nix",
          readOnly: false,
        },
      ];

      const mountArguments = [];

      for (const { dir, readOnly } of candidateDirectories) {
        try {
          await access(dir);
          actionsCore.debug(`Will mount ${dir} in the docker shim.`);
          mountArguments.push("--mount");
          mountArguments.push(
            `type=bind,src=${dir},dst=${dir}${readOnly ? ",readonly" : ""}`,
          );
        } catch {
          actionsCore.debug(
            `Not mounting ${dir} in the docker shim: it doesn't appear to exist.`,
          );
        }
      }

      const plausibleDeterminateOptions = [];
      const plausibleDeterminateArguments = [];
      if (this.determinate) {
        plausibleDeterminateOptions.push("--entrypoint");
        plausibleDeterminateOptions.push("/usr/local/bin/determinate-nixd");
        plausibleDeterminateArguments.push("daemon");
      }

      this.recordEvent(EVENT_START_DOCKER_SHIM);
      const exitCode = await actionsExec.exec(
        "docker",
        [
          "--log-level=debug",
          "run",
          "--detach",
          "--privileged",
          "--network=host",
          "--userns=host",
          "--pid=host",
          "--restart",
          "always",
          "--init",
          "--name",
          `determinate-nix-shim-${this.getUniqueId()}-${randomUUID()}`,
        ]
          .concat(plausibleDeterminateOptions)
          .concat(mountArguments)
          .concat(["determinate-nix-shim:latest"])
          .concat(plausibleDeterminateArguments),
        {
          silent: true,
          listeners: {
            stdline: (data: string) => {
              actionsCore.saveState("docker_shim_container_id", data.trimEnd());
            },
            stdout: (data: Buffer) => {
              const trimmed = data.toString("utf-8").trimEnd();
              if (trimmed.length >= 0) {
                actionsCore.debug(trimmed);
              }
            },
            stderr: (data: Buffer) => {
              const trimmed = data.toString("utf-8").trimEnd();
              if (trimmed.length >= 0) {
                actionsCore.debug(trimmed);
              }
            },
          },
        },
      );

      if (exitCode !== 0) {
        throw new Error(
          `Failed to start the Nix daemon through Docker, exit code: \`${exitCode}\``,
        );
      }
    }

    actionsCore.endGroup();

    return;
  }
  async cleanupDockerShim(): Promise<void> {
    const containerId = actionsCore.getState("docker_shim_container_id");

    if (containerId !== "") {
      actionsCore.startGroup("Cleaning up the Nix daemon's Docker shim");

      let cleaned = false;
      try {
        await actionsExec.exec("docker", ["rm", "--force", containerId]);
        cleaned = true;
      } catch {
        actionsCore.warning("failed to cleanup nix daemon container");
      }

      if (!cleaned) {
        actionsCore.info("trying to pkill the container's shim process");
        try {
          await actionsExec.exec("pkill", [containerId]);
          cleaned = true;
        } catch {
          actionsCore.warning(
            "failed to forcibly kill the container's shim process",
          );
        }
      }

      if (cleaned) {
        this.recordEvent(EVENT_CLEAN_UP_DOCKER_SHIM);
      } else {
        actionsCore.warning(
          "Giving up on cleaning up the nix daemon container",
        );
      }

      actionsCore.endGroup();
    }
  }

  async setGithubPath(): Promise<void> {
    // Interim versions of the `nix-installer` crate may have already manipulated `$GITHUB_PATH`, as root even! Accessing that will be an error.
    try {
      const nixVarNixProfilePath = "/nix/var/nix/profiles/default/bin";
      const homeNixProfilePath = `${process.env["HOME"]}/.nix-profile/bin`;
      actionsCore.addPath(nixVarNixProfilePath);
      actionsCore.addPath(homeNixProfilePath);
      actionsCore.info(
        `Added \`${nixVarNixProfilePath}\` and \`${homeNixProfilePath}\` to \`$GITHUB_PATH\``,
      );
    } catch {
      actionsCore.info(
        "Skipping setting $GITHUB_PATH in action, the `nix-installer` crate seems to have done this already. From `nix-installer` version 0.11.0 and up, this step is done in the action. Prior to 0.11.0, this was only done in the `nix-installer` binary.",
      );
    }
  }

  async flakehubLogin(): Promise<void> {
    if (
      process.env["ACTIONS_ID_TOKEN_REQUEST_URL"] &&
      process.env["ACTIONS_ID_TOKEN_REQUEST_TOKEN"]
    ) {
      actionsCore.startGroup("Logging in to FlakeHub");
      this.recordEvent(EVENT_LOGIN_TO_FLAKEHUB);
      try {
        await actionsExec.exec(`determinate-nixd`, ["login", "github-action"]);
      } catch (e: unknown) {
        this.recordEvent("flakehub-login:failure", {
          exception: stringifyError(e),
        });
      }
      actionsCore.endGroup();
    }
  }

  async executeUninstall(): Promise<number> {
    this.recordEvent(EVENT_UNINSTALL_NIX);
    const exitCode = await actionsExec.exec(
      `/nix/nix-installer`,
      ["uninstall"],
      {
        env: {
          NIX_INSTALLER_NO_CONFIRM: "true",
          ...process.env, // To get $PATH, etc
        },
      },
    );

    if (exitCode !== 0) {
      throw new Error(`Non-zero exit code of \`${exitCode}\` detected`);
    }

    return exitCode;
  }

  async detectExisting(): Promise<boolean> {
    const receiptPath = "/nix/receipt.json";
    try {
      await access(receiptPath);
      // There is a /nix/receipt.json
      return true;
    } catch {
      // No /nix/receipt.json
      return false;
    }
  }

  private async setupKvm(): Promise<boolean> {
    this.recordEvent(EVENT_SETUP_KVM);
    const currentUser = userInfo();
    const isRoot = currentUser.uid === 0;
    const maybeSudo = isRoot ? "" : "sudo";

    const kvmRules = "/etc/udev/rules.d/99-determinate-nix-installer-kvm.rules";
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
                actionsCore.debug(trimmed);
              }
            },
            stderr: (data: Buffer) => {
              const trimmed = data.toString("utf-8").trimEnd();
              if (trimmed.length >= 0) {
                actionsCore.debug(trimmed);
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
                actionsCore.debug(trimmed);
              }
            },
            stderr: (data: Buffer) => {
              const trimmed = data.toString("utf-8").trimEnd();
              if (trimmed.length >= 0) {
                actionsCore.debug(trimmed);
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
  }

  private async fetchBinary(): Promise<string> {
    if (!this.localRoot) {
      return await this.fetchExecutable();
    } else {
      const localPath = join(this.localRoot, `nix-installer-${this.platform}`);
      actionsCore.info(`Using binary ${localPath}`);
      return localPath;
    }
  }

  async reportOverall(): Promise<void> {
    try {
      this.recordEvent(EVENT_CONCLUDE_WORKFLOW, {
        conclusion: await this.getWorkflowConclusion(),
      });
    } catch (e) {
      actionsCore.debug(`Error submitting post-run diagnostics report: ${e}`);
    }
  }

  private async getWorkflowConclusion(): Promise<
    undefined | WorkflowConclusion
  > {
    if (this.githubToken == null) {
      return undefined;
    }

    try {
      const octokit = github.getOctokit(this.githubToken);
      const jobs = await octokit.paginate(
        octokit.rest.actions.listJobsForWorkflowRun,
        {
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          /* eslint-disable camelcase */
          run_id: github.context.runId,
        },
      );

      actionsCore.debug(`awaited jobs: ${jobs}`);
      const job = jobs
        .filter((candidate) => candidate.name === github.context.job)
        .at(0);
      if (job === undefined) {
        return "no-jobs";
      }

      const outcomes = (job.steps ?? []).map((j) => j.conclusion ?? "unknown");

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
    } catch (e) {
      actionsCore.debug(`Error determining final disposition: ${e}`);
      return "unavailable";
    }
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
