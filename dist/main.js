import * as actions_core from "@actions/core";
import * as github from "@actions/github";
import * as actions_exec from "@actions/exec";
import { access, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import fs from "node:fs";
import { userInfo } from "node:os";
import stringArgv from "string-argv";
import * as path from "path";
import { IdsToolbox } from "detsys-ts";
import { randomUUID } from "node:crypto";
class NixInstallerAction {
    constructor() {
        this.idslib = new IdsToolbox({
            name: "nix-installer",
            fetchStyle: "nix-style",
            legacySourcePrefix: "nix-installer",
        });
        this.platform = get_nix_platform();
        this.nix_package_url = action_input_string_or_null("nix-package-url");
        this.backtrace = action_input_string_or_null("backtrace");
        this.extra_args = action_input_string_or_null("extra-args");
        this.extra_conf = action_input_multiline_string_or_null("extra-conf");
        this.flakehub = action_input_bool("flakehub");
        this.kvm = action_input_bool("kvm");
        this.force_docker_shim = action_input_bool("force-docker-shim");
        this.github_token = action_input_string_or_null("github-token");
        this.github_server_url = action_input_string_or_null("github-server-url");
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
        this.nix_build_group_name = action_input_string_or_null("nix-build-group-name");
        this.nix_build_user_base = action_input_number_or_null("nix_build-user-base");
        this.nix_build_user_count = action_input_number_or_null("nix-build-user-count");
        this.nix_build_user_prefix = action_input_string_or_null("nix-build-user-prefix");
        this.planner = action_input_string_or_null("planner");
        this.reinstall = action_input_bool("reinstall");
        this.start_daemon = action_input_bool("start-daemon");
        this.trust_runner_user = action_input_bool("trust-runner-user");
    }
    async detectAndForceDockerShim() {
        // Detect if we're in a GHA runner which is Linux, doesn't have Systemd, and does have Docker.
        // This is a common case in self-hosted runners, providers like [Namespace](https://namespace.so/),
        // and especially GitHub Enterprise Server.
        if (process.env.RUNNER_OS !== "Linux") {
            if (this.force_docker_shim) {
                actions_core.warning("Ignoring force-docker-shim which is set to true, as it is only supported on Linux.");
                this.force_docker_shim = false;
            }
            return;
        }
        const systemdCheck = fs.statSync("/run/systemd/system", {
            throwIfNoEntry: false,
        });
        if (systemdCheck?.isDirectory()) {
            if (this.force_docker_shim) {
                actions_core.warning("Systemd is detected, but ignoring it since force-docker-shim is enabled.");
            }
            else {
                this.idslib.addFact("has_systemd", true);
                return;
            }
        }
        this.idslib.addFact("has_systemd", false);
        actions_core.debug("Linux detected without systemd, testing for Docker with `docker info` as an alternative daemon supervisor.");
        this.idslib.addFact("has_docker", false); // Set to false here, and only in the success case do we set it to true
        let exit_code;
        try {
            exit_code = await actions_exec.exec("docker", ["info"], {
                silent: true,
                listeners: {
                    stdout: (data) => {
                        const trimmed = data.toString("utf-8").trimEnd();
                        if (trimmed.length >= 0) {
                            actions_core.debug(trimmed);
                        }
                    },
                    stderr: (data) => {
                        const trimmed = data.toString("utf-8").trimEnd();
                        if (trimmed.length >= 0) {
                            actions_core.debug(trimmed);
                        }
                    },
                },
            });
        }
        catch (e) {
            actions_core.debug("Docker not detected, not enabling docker shim.");
            return;
        }
        if (exit_code !== 0) {
            if (this.force_docker_shim) {
                actions_core.warning("docker info check failed, but trying anyway since force-docker-shim is enabled.");
            }
            else {
                return;
            }
        }
        this.idslib.addFact("has_docker", true);
        if (!this.force_docker_shim &&
            (await this.detectDockerWithMountedDockerSocket())) {
            actions_core.debug("Detected a Docker container with a Docker socket mounted, not enabling docker shim.");
            return;
        }
        actions_core.startGroup("Enabling the Docker shim for running Nix on Linux in CI without Systemd.");
        if (this.init !== "none") {
            actions_core.info(`Changing init from '${this.init}' to 'none'`);
            this.init = "none";
        }
        if (this.planner !== "linux") {
            actions_core.info(`Changing planner from '${this.planner}' to 'linux'`);
            this.planner = "linux";
        }
        this.force_docker_shim = true;
        actions_core.endGroup();
    }
    // Detect if we are running under `act` or some other system which is not using docker-in-docker,
    // and instead using a mounted docker socket.
    // In the case of the socket mount solution, the shim will cause issues since the given mount paths will
    // equate to mount paths on the host, not mount paths to the docker container in question.
    async detectDockerWithMountedDockerSocket() {
        let cgroups_buffer;
        try {
            // If we are inside a docker container, the last line of `/proc/self/cgroup` should be
            // 0::/docker/$SOME_ID
            //
            // If we are not, the line will likely be `0::/`
            cgroups_buffer = await readFile("/proc/self/cgroup", {
                encoding: "utf-8",
            });
        }
        catch (e) {
            actions_core.debug(`Did not detect \`/proc/self/cgroup\` existence, bailing on docker container ID detection:\n${e}`);
            return false;
        }
        const cgroups = cgroups_buffer.trim().split("\n");
        const last_cgroup = cgroups[cgroups.length - 1];
        const last_cgroup_parts = last_cgroup.split(":");
        const last_cgroup_path = last_cgroup_parts[last_cgroup_parts.length - 1];
        if (!last_cgroup_path.includes("/docker/")) {
            actions_core.debug("Did not detect a container ID, bailing on docker.sock detection");
            return false;
        }
        // We are in a docker container, now to determine if this container is visible from
        // the `docker` command, and if so, if there is a `docker.socket` mounted.
        const last_cgroup_path_parts = last_cgroup_path.split("/");
        const container_id = last_cgroup_path_parts[last_cgroup_path_parts.length - 1];
        // If we cannot `docker inspect` this discovered container ID, we'll fall through to the `catch` below.
        let stdout_buffer = "";
        let stderr_buffer = "";
        let exit_code;
        try {
            exit_code = await actions_exec.exec("docker", ["inspect", container_id], {
                silent: true,
                listeners: {
                    stdout: (data) => {
                        stdout_buffer += data.toString("utf-8");
                    },
                    stderr: (data) => {
                        stderr_buffer += data.toString("utf-8");
                    },
                },
            });
        }
        catch (e) {
            actions_core.debug(`Could not execute \`docker inspect ${container_id}\`, bailing on docker container inspection:\n${e}`);
            return false;
        }
        if (exit_code !== 0) {
            actions_core.debug(`Unable to inspect detected docker container with id \`${container_id}\`, bailing on container inspection (exit ${exit_code}):\n${stderr_buffer}`);
            return false;
        }
        const output = JSON.parse(stdout_buffer);
        // `docker inspect $ID` prints an array containing objects.
        // In our use case, we should only see 1 item in the array.
        if (output.length !== 1) {
            actions_core.debug(`Got \`docker inspect ${container_id}\` output which was not one item (was ${output.length}), bailing on docker.sock detection.`);
            return false;
        }
        const item = output[0];
        // On this array item we want the `Mounts` field, which is an array
        // containing `{ Type, Source, Destination, Mode}`.
        // We are looking for a `Destination` ending with `docker.sock`.
        const mounts = item["Mounts"];
        if (typeof mounts !== "object") {
            actions_core.debug(`Got non-object in \`Mounts\` field of \`docker inspect ${container_id}\` output, bailing on docker.sock detection.`);
            return false;
        }
        let found_docker_sock_mount = false;
        for (const mount of mounts) {
            const destination = mount["Destination"];
            if (typeof destination === "string") {
                if (destination.endsWith("docker.sock")) {
                    found_docker_sock_mount = true;
                    break;
                }
            }
        }
        return found_docker_sock_mount;
    }
    async executionEnvironment() {
        const execution_env = {};
        execution_env.NIX_INSTALLER_NO_CONFIRM = "true";
        execution_env.NIX_INSTALLER_DIAGNOSTIC_ATTRIBUTION = JSON.stringify(this.idslib.getCorrelationHashes());
        if (this.backtrace !== null) {
            execution_env.RUST_BACKTRACE = this.backtrace;
        }
        if (this.modify_profile !== null) {
            if (this.modify_profile) {
                execution_env.NIX_INSTALLER_MODIFY_PROFILE = "true";
            }
            else {
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
        execution_env.NIX_INSTALLER_DIAGNOSTIC_ENDPOINT =
            this.idslib.getDiagnosticsUrl()?.toString() || "";
        // TODO: Error if the user uses these on not-MacOS
        if (this.mac_encrypt !== null) {
            if (process.env.RUNNER_OS !== "macOS") {
                throw new Error("`mac-encrypt` while `$RUNNER_OS` was not `macOS`");
            }
            execution_env.NIX_INSTALLER_ENCRYPT = this.mac_encrypt;
        }
        if (this.mac_case_sensitive !== null) {
            if (process.env.RUNNER_OS !== "macOS") {
                throw new Error("`mac-case-sensitive` while `$RUNNER_OS` was not `macOS`");
            }
            execution_env.NIX_INSTALLER_CASE_SENSITIVE = this.mac_case_sensitive;
        }
        if (this.mac_volume_label !== null) {
            if (process.env.RUNNER_OS !== "macOS") {
                throw new Error("`mac-volume-label` while `$RUNNER_OS` was not `macOS`");
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
                throw new Error("`init` is not a valid option when `$RUNNER_OS` is `macOS`");
            }
            execution_env.NIX_INSTALLER_INIT = this.init;
        }
        if (this.start_daemon !== null) {
            if (this.start_daemon) {
                execution_env.NIX_INSTALLER_START_DAEMON = "true";
            }
            else {
                execution_env.NIX_INSTALLER_START_DAEMON = "false";
            }
        }
        let extra_conf = "";
        if (this.github_server_url !== null && this.github_token !== null) {
            const server_url = this.github_server_url.replace("https://", "");
            extra_conf += `access-tokens = ${server_url}=${this.github_token}`;
            extra_conf += "\n";
        }
        if (this.trust_runner_user !== null) {
            const user = userInfo().username;
            if (user) {
                extra_conf += `trusted-users = root ${user}`;
            }
            else {
                extra_conf += `trusted-users = root`;
            }
            extra_conf += "\n";
        }
        if (this.flakehub) {
            extra_conf += `netrc-file = ${await this.flakehub_login()}`;
            extra_conf += "\n";
        }
        if (this.extra_conf !== null && this.extra_conf.length !== 0) {
            extra_conf += this.extra_conf.join("\n");
            extra_conf += "\n";
        }
        execution_env.NIX_INSTALLER_EXTRA_CONF = extra_conf;
        if (process.env.ACT && !process.env.NOT_ACT) {
            this.idslib.addFact("in_act", true);
            actions_core.info("Detected `$ACT` environment, assuming this is a https://github.com/nektos/act created container, set `NOT_ACT=true` to override this. This will change the setting of the `init` to be compatible with `act`");
            execution_env.NIX_INSTALLER_INIT = "none";
        }
        if (process.env.NSC_VM_ID && !process.env.NOT_NAMESPACE) {
            this.idslib.addFact("in_namespace_so", true);
            actions_core.info("Detected Namespace runner, assuming this is a https://namespace.so created container, set `NOT_NAMESPACE=true` to override this. This will change the setting of the `init` to be compatible with Namespace");
            execution_env.NIX_INSTALLER_INIT = "none";
        }
        return execution_env;
    }
    async execute_install(binary_path) {
        const execution_env = await this.executionEnvironment();
        actions_core.debug(`Execution environment: ${JSON.stringify(execution_env, null, 4)}`);
        const args = ["install"];
        if (this.planner) {
            this.idslib.addFact("nix_installer_planner", this.planner);
            args.push(this.planner);
        }
        else {
            this.idslib.addFact("nix_installer_planner", get_default_planner());
            args.push(get_default_planner());
        }
        if (this.extra_args) {
            const extra_args = stringArgv(this.extra_args);
            args.concat(extra_args);
        }
        this.idslib.recordEvent("install_nix_start");
        const exit_code = await actions_exec.exec(binary_path, args, {
            env: {
                ...execution_env,
                ...process.env, // To get $PATH, etc
            },
        });
        if (exit_code !== 0) {
            this.idslib.recordEvent("install_nix_failure", {
                exit_code,
            });
            throw new Error(`Non-zero exit code of \`${exit_code}\` detected`);
        }
        this.idslib.recordEvent("install_nix_success");
        return exit_code;
    }
    async install() {
        const existing_install = await this.detect_existing();
        if (existing_install) {
            if (this.reinstall) {
                // We need to uninstall, then reinstall
                actions_core.info("Nix was already installed, `reinstall` is set, uninstalling for a reinstall");
                await this.execute_uninstall();
            }
            else {
                // We're already installed, and not reinstalling, just set GITHUB_PATH and finish early
                await this.set_github_path();
                actions_core.info("Nix was already installed, using existing install");
                return;
            }
        }
        if (this.kvm) {
            actions_core.startGroup("Configuring KVM");
            if (await this.setup_kvm()) {
                actions_core.endGroup();
                actions_core.info("\u001b[32m Accelerated KVM is enabled \u001b[33m⚡️");
                actions_core.exportVariable("DETERMINATE_NIX_KVM", "1");
            }
            else {
                actions_core.endGroup();
                actions_core.info("KVM is not available.");
                actions_core.exportVariable("DETERMINATE_NIX_KVM", "0");
            }
        }
        // Normal just doing of the install
        actions_core.startGroup("Installing Nix");
        const binary_path = await this.fetch_binary();
        await this.execute_install(binary_path);
        actions_core.endGroup();
        if (this.force_docker_shim) {
            await this.spawnDockerShim();
        }
        await this.set_github_path();
    }
    async spawnDockerShim() {
        actions_core.startGroup("Configuring the Docker shim as the Nix Daemon's process supervisor");
        const images = {
            X64: path.join(__dirname, "/../docker-shim/amd64.tar.gz"),
            ARM64: path.join(__dirname, "/../docker-shim/arm64.tar.gz"),
        };
        let arch;
        if (process.env.RUNNER_ARCH === "X64") {
            arch = "X64";
        }
        else if (process.env.RUNNER_ARCH === "ARM64") {
            arch = "ARM64";
        }
        else {
            throw Error("Architecture not supported in Docker shim mode.");
        }
        actions_core.debug("Loading image: determinate-nix-shim:latest...");
        {
            const exit_code = await actions_exec.exec("docker", ["image", "load", "--input", images[arch]], {
                silent: true,
                listeners: {
                    stdout: (data) => {
                        const trimmed = data.toString("utf-8").trimEnd();
                        if (trimmed.length >= 0) {
                            actions_core.debug(trimmed);
                        }
                    },
                    stderr: (data) => {
                        const trimmed = data.toString("utf-8").trimEnd();
                        if (trimmed.length >= 0) {
                            actions_core.debug(trimmed);
                        }
                    },
                },
            });
            if (exit_code !== 0) {
                throw new Error(`Failed to build the shim image, exit code: \`${exit_code}\``);
            }
        }
        {
            actions_core.debug("Starting the Nix daemon through Docker...");
            this.idslib.recordEvent("start_docker_shim");
            const exit_code = await actions_exec.exec("docker", [
                "--log-level=debug",
                "run",
                "--detach",
                "--privileged",
                "--network=host",
                "--userns=host",
                "--pid=host",
                "--mount",
                "type=bind,src=/bin,dst=/bin,readonly",
                "--mount",
                "type=bind,src=/lib,dst=/lib,readonly",
                "--mount",
                "type=bind,src=/home,dst=/home,readonly",
                "--mount",
                "type=bind,src=/tmp,dst=/tmp",
                "--mount",
                "type=bind,src=/nix,dst=/nix",
                "--mount",
                "type=bind,src=/etc,dst=/etc,readonly",
                "--restart",
                "always",
                "--init",
                "--name",
                `determinate-nix-shim-${this.idslib.getUniqueId()}-${randomUUID()}`,
                "determinate-nix-shim:latest",
            ], {
                silent: true,
                listeners: {
                    stdline: (data) => {
                        actions_core.saveState("docker_shim_container_id", data.trimEnd());
                    },
                    stdout: (data) => {
                        const trimmed = data.toString("utf-8").trimEnd();
                        if (trimmed.length >= 0) {
                            actions_core.debug(trimmed);
                        }
                    },
                    stderr: (data) => {
                        const trimmed = data.toString("utf-8").trimEnd();
                        if (trimmed.length >= 0) {
                            actions_core.debug(trimmed);
                        }
                    },
                },
            });
            if (exit_code !== 0) {
                throw new Error(`Failed to start the Nix daemon through Docker, exit code: \`${exit_code}\``);
            }
        }
        actions_core.endGroup();
        return;
    }
    async cleanupDockerShim() {
        const container_id = actions_core.getState("docker_shim_container_id");
        if (container_id !== "") {
            actions_core.startGroup("Cleaning up the Nix daemon's Docker shim");
            let cleaned = false;
            try {
                await actions_exec.exec("docker", ["rm", "--force", container_id]);
                cleaned = true;
            }
            catch {
                actions_core.warning("failed to cleanup nix daemon container");
            }
            if (!cleaned) {
                actions_core.info("trying to pkill the container's shim process");
                try {
                    await actions_exec.exec("pkill", [container_id]);
                    cleaned = true;
                }
                catch {
                    actions_core.warning("failed to forcibly kill the container's shim process");
                }
            }
            if (cleaned) {
                this.idslib.recordEvent("clean_up_docker_shim");
            }
            else {
                actions_core.warning("Giving up on cleaning up the nix daemon container");
            }
            actions_core.endGroup();
        }
    }
    async set_github_path() {
        // Interim versions of the `nix-installer` crate may have already manipulated `$GITHUB_PATH`, as root even! Accessing that will be an error.
        try {
            const nix_var_nix_profile_path = "/nix/var/nix/profiles/default/bin";
            const home_nix_profile_path = `${process.env.HOME}/.nix-profile/bin`;
            actions_core.addPath(nix_var_nix_profile_path);
            actions_core.addPath(home_nix_profile_path);
            actions_core.info(`Added \`${nix_var_nix_profile_path}\` and \`${home_nix_profile_path}\` to \`$GITHUB_PATH\``);
        }
        catch (error) {
            actions_core.info("Skipping setting $GITHUB_PATH in action, the `nix-installer` crate seems to have done this already. From `nix-installer` version 0.11.0 and up, this step is done in the action. Prior to 0.11.0, this was only done in the `nix-installer` binary.");
        }
    }
    async flakehub_login() {
        this.idslib.recordEvent("login_to_flakehub");
        const netrc_path = `${process.env["RUNNER_TEMP"]}/determinate-nix-installer-netrc`;
        const jwt = await actions_core.getIDToken("api.flakehub.com");
        await writeFile(netrc_path, [
            `machine api.flakehub.com login flakehub password ${jwt}`,
            `machine flakehub.com login flakehub password ${jwt}`,
        ].join("\n"));
        actions_core.info("Logging in to FlakeHub.");
        // the join followed by a match on ^... looks silly, but extra_config
        // could contain multi-line values
        if (this.extra_conf?.join("\n").match(/^netrc-file/m)) {
            actions_core.warning("Logging in to FlakeHub conflicts with the Nix option `netrc-file`.");
        }
        return netrc_path;
    }
    async execute_uninstall() {
        this.idslib.recordEvent("uninstall");
        const exit_code = await actions_exec.exec(`/nix/nix-installer`, ["uninstall"], {
            env: {
                NIX_INSTALLER_NO_CONFIRM: "true",
                ...process.env, // To get $PATH, etc
            },
        });
        if (exit_code !== 0) {
            throw new Error(`Non-zero exit code of \`${exit_code}\` detected`);
        }
        return exit_code;
    }
    async detect_existing() {
        const receipt_path = "/nix/receipt.json";
        try {
            await access(receipt_path);
            // There is a /nix/receipt.json
            return true;
        }
        catch {
            // No /nix/receipt.json
            return false;
        }
    }
    async setup_kvm() {
        this.idslib.recordEvent("setup_kvm");
        const current_user = userInfo();
        const is_root = current_user.uid === 0;
        const maybe_sudo = is_root ? "" : "sudo";
        const kvm_rules = "/etc/udev/rules.d/99-determinate-nix-installer-kvm.rules";
        try {
            const write_file_exit_code = await actions_exec.exec("sh", [
                "-c",
                `echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | ${maybe_sudo} tee ${kvm_rules} > /dev/null`,
            ], {
                silent: true,
                listeners: {
                    stdout: (data) => {
                        const trimmed = data.toString("utf-8").trimEnd();
                        if (trimmed.length >= 0) {
                            actions_core.debug(trimmed);
                        }
                    },
                    stderr: (data) => {
                        const trimmed = data.toString("utf-8").trimEnd();
                        if (trimmed.length >= 0) {
                            actions_core.debug(trimmed);
                        }
                    },
                },
            });
            if (write_file_exit_code !== 0) {
                throw new Error(`Non-zero exit code of \`${write_file_exit_code}\` detected while writing '${kvm_rules}'`);
            }
            const debug_root_run_throw = async (action, command, args) => {
                if (!is_root) {
                    args = [command, ...args];
                    command = "sudo";
                }
                const reload_exit_code = await actions_exec.exec(command, args, {
                    silent: true,
                    listeners: {
                        stdout: (data) => {
                            const trimmed = data.toString("utf-8").trimEnd();
                            if (trimmed.length >= 0) {
                                actions_core.debug(trimmed);
                            }
                        },
                        stderr: (data) => {
                            const trimmed = data.toString("utf-8").trimEnd();
                            if (trimmed.length >= 0) {
                                actions_core.debug(trimmed);
                            }
                        },
                    },
                });
                if (reload_exit_code !== 0) {
                    throw new Error(`Non-zero exit code of \`${reload_exit_code}\` detected while ${action}.`);
                }
            };
            await debug_root_run_throw("reloading udev rules", "udevadm", [
                "control",
                "--reload-rules",
            ]);
            await debug_root_run_throw("triggering udev against kvm", "udevadm", [
                "trigger",
                "--name-match=kvm",
            ]);
            return true;
        }
        catch (error) {
            if (is_root) {
                await actions_exec.exec("rm", ["-f", kvm_rules]);
            }
            else {
                await actions_exec.exec("sudo", ["rm", "-f", kvm_rules]);
            }
            return false;
        }
    }
    async fetch_binary() {
        if (!this.local_root) {
            return await this.idslib.fetchExecutable();
        }
        else {
            const local_path = join(this.local_root, `nix-installer-${this.platform}`);
            actions_core.info(`Using binary ${local_path}`);
            return local_path;
        }
    }
    async report_overall() {
        try {
            this.idslib.recordEvent("conclude_workflow", {
                conclusion: await this.get_workflow_conclusion(),
            });
        }
        catch (error) {
            actions_core.debug(`Error submitting post-run diagnostics report: ${error}`);
        }
    }
    async get_workflow_conclusion() {
        if (this.github_token == null) {
            return undefined;
        }
        try {
            const octokit = github.getOctokit(this.github_token);
            const jobs = await octokit.paginate(octokit.rest.actions.listJobsForWorkflowRun, {
                owner: github.context.repo.owner,
                repo: github.context.repo.repo,
                run_id: github.context.runId,
            });
            actions_core.debug(`awaited jobs: ${jobs}`);
            const job = jobs
                .filter((candidate) => candidate.name === github.context.job)
                .at(0);
            if (job === undefined) {
                return "no-jobs";
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
        }
        catch (error) {
            actions_core.debug(`Error determining final disposition: ${error}`);
            return "unavailable";
        }
    }
}
function get_nix_platform() {
    const env_os = process.env.RUNNER_OS;
    const env_arch = process.env.RUNNER_ARCH;
    if (env_os === "macOS" && env_arch === "X64") {
        return "x86_64-darwin";
    }
    else if (env_os === "macOS" && env_arch === "ARM64") {
        return "aarch64-darwin";
    }
    else if (env_os === "Linux" && env_arch === "X64") {
        return "x86_64-linux";
    }
    else if (env_os === "Linux" && env_arch === "ARM64") {
        return "aarch64-linux";
    }
    else {
        throw new Error(`Unsupported \`RUNNER_OS\` (currently \`${env_os}\`) and \`RUNNER_ARCH\` (currently \`${env_arch}\`)  combination`);
    }
}
function get_default_planner() {
    const env_os = process.env.RUNNER_OS;
    if (env_os === "macOS") {
        return "macos";
    }
    else if (env_os === "Linux") {
        return "linux";
    }
    else {
        throw new Error(`Unsupported \`RUNNER_OS\` (currently \`${env_os}\`)`);
    }
}
function action_input_string_or_null(name) {
    const value = actions_core.getInput(name);
    if (value === "") {
        return null;
    }
    else {
        return value;
    }
}
function action_input_multiline_string_or_null(name) {
    const value = actions_core.getMultilineInput(name);
    if (value.length === 0) {
        return null;
    }
    else {
        return value;
    }
}
function action_input_number_or_null(name) {
    const value = actions_core.getInput(name);
    if (value === "") {
        return null;
    }
    else {
        return Number(value);
    }
}
function action_input_bool(name) {
    return actions_core.getBooleanInput(name);
}
async function main() {
    const installer = new NixInstallerAction();
    try {
        const isPost = actions_core.getState("isPost");
        actions_core.saveState("isPost", "true");
        if (isPost !== "true") {
            await installer.detectAndForceDockerShim();
            await installer.install();
        }
        else {
            await installer.cleanupDockerShim();
            await installer.report_overall();
        }
    }
    catch (error) {
        if (error instanceof Error)
            actions_core.setFailed(error);
    }
    await installer.idslib.complete();
}
// eslint-disable-next-line github/no-then
main().catch((error) => {
    // eslint-disable-next-line no-console
    console.log(error);
    process.exitCode = 1;
});
