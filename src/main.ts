import * as actions_core from '@actions/core'
import {mkdtemp, open} from 'node:fs/promises'
import {spawn} from 'node:child_process'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {Readable} from 'node:stream'

class NixInstallerAction {
  platform: string
  backtrace: string | null
  extra_args: string | null
  extra_conf: string[] | null
  github_token: string | null
  // TODO: linux_init
  init: string | null
  local_root: string | null
  log_directives: string | null
  logger: string | null
  ssl_cert_file: string | null
  proxy: string | null
  mac_case_sensitive: string | null
  mac_encrypt: string | null
  mac_root_disk: string | null
  mac_volume_label: string | null
  modify_profile: boolean | null
  nix_build_group_id: number | null
  nix_build_group_name: string | null
  nix_build_user_base: number | null
  nix_build_user_count: number | null
  nix_build_user_prefix: string | null
  planner: string | null
  reinstall: boolean | null
  start_daemon: boolean | null
  diagnostic_endpoint: string | null
  trust_runner_user: boolean | null
  nix_installer_url: URL

  constructor() {
    this.platform = get_nix_platform()
    this.backtrace = action_input_string_or_null('backtrace')
    this.extra_args = action_input_string_or_null('extra-args')
    this.extra_conf = action_input_multiline_string_or_null('extra-conf')
    this.github_token = action_input_string_or_null('github-token')
    this.init = action_input_string_or_null('init')
    this.local_root = action_input_string_or_null('local-root')
    this.log_directives = action_input_string_or_null('log-directives')
    this.logger = action_input_string_or_null('logger')
    this.ssl_cert_file = action_input_string_or_null('ssl-cert-file')
    this.proxy = action_input_string_or_null('proxy')
    this.mac_case_sensitive = action_input_string_or_null('mac-case-sensitive')
    this.mac_encrypt = action_input_string_or_null('mac-encrypt')
    this.mac_root_disk = action_input_string_or_null('mac-root-disk')
    this.mac_volume_label = action_input_string_or_null('mac-volume-label')
    this.modify_profile = action_input_bool_or_null('modify-profile')
    this.nix_build_group_id = action_input_number_or_null('nix-build-group-id')
    this.nix_build_group_name = action_input_string_or_null(
      'nix-build-group-name'
    )
    this.nix_build_user_base = action_input_number_or_null(
      'nix_build-user-base'
    )
    this.nix_build_user_count = action_input_number_or_null(
      'nix-build-user-count'
    )
    this.nix_build_user_prefix = action_input_string_or_null(
      'nix-build-user-prefix'
    )
    this.planner = action_input_string_or_null('planner')
    this.reinstall = action_input_bool_or_null('reinstall')
    this.start_daemon = action_input_bool_or_null('start-daemon')
    this.diagnostic_endpoint = action_input_string_or_null(
      'diagnostic-endpoint'
    )
    this.trust_runner_user = action_input_bool_or_null('trust-runner-user')
    this.nix_installer_url = resolve_nix_installer_url(this.platform)
  }

  private executionEnvironment(): ExecuteEnvironment {
    const env: ExecuteEnvironment = {}

    if (this.backtrace !== null) {
      env.RUST_BACKTRACE = this.backtrace
    }
    if (this.modify_profile !== null) {
      if (this.modify_profile) {
        env.NIX_INSTALLER_MODIFY_PROFILE = '1'
      } else {
        env.NIX_INSTALLER_MODIFY_PROFILE = '0'
      }
    }

    if (this.nix_build_group_id !== null) {
      env.NIX_INSTALLER_NIX_BUILD_GROUP_ID = `${this.nix_build_group_id}`
    }

    if (this.nix_build_group_name !== null) {
      env.NIX_INSTALLER_NIX_BUILD_GROUP_NAME = this.nix_build_group_name
    }

    if (this.nix_build_user_prefix !== null) {
      env.NIX_INSTALLER_NIX_BUILD_USER_PREFIX = this.nix_build_user_prefix
    }

    if (this.nix_build_user_count !== null) {
      env.NIX_INSTALLER_NIX_BUILD_USER_COUNT = `${this.nix_build_user_count}`
    }

    if (this.nix_build_user_base !== null) {
      env.NIX_INSTALLER_NIX_BUILD_USER_ID_BASE = `${this.nix_build_user_count}`
    }

    if (this.nix_installer_url !== null) {
      env.NIX_INSTALLER_NIX_PACKAGE_URL = `${this.nix_installer_url}`
    }

    if (this.proxy !== null) {
      env.NIX_INSTALLER_PROXY = this.proxy
    }

    if (this.ssl_cert_file !== null) {
      env.NIX_INSTALLER_SSL_CERT_FILE = this.ssl_cert_file
    }

    if (this.diagnostic_endpoint !== null) {
      env.NIX_INSTALLER_DIAGNOSTIC_ENDPOINT = this.diagnostic_endpoint
    }

    // TODO: Error if the user uses these on not-MacOS
    if (this.mac_encrypt !== null) {
      env.NIX_INSTALLER_ENCRYPT = this.mac_encrypt
    }

    if (this.mac_case_sensitive !== null) {
      env.NIX_INSTALLER_CASE_SENSITIVE = this.mac_case_sensitive
    }

    if (this.mac_volume_label !== null) {
      env.NIX_INSTALLER_VOLUME_LABEL = this.mac_volume_label
    }

    if (this.mac_root_disk !== null) {
      env.NIX_INSTALLER_ROOT_DISK = this.mac_root_disk
    }

    // TODO: Error if the user uses these on MacOS
    if (this.init !== null) {
      env.NIX_INSTALLER_INIT = this.init
    }

    if (this.start_daemon !== null) {
      if (this.start_daemon) {
        env.NIX_INSTALLER_START_DAEMON = '1'
      } else {
        env.NIX_INSTALLER_START_DAEMON = '0'
      }
    }

    return env
  }

  private async execute(binary_path: string): Promise<number> {
    const env = this.executionEnvironment()

    const spawned = spawn(`${binary_path} ${this.extra_args}`, {env})

    spawned.stdout.on('data', data => {
      actions_core.debug(`stdout: ${data}`)
    })

    spawned.stderr.on('data', data => {
      actions_core.debug(`stderr: ${data}`)
    })

    const exit_code: number = await new Promise((resolve, _reject) => {
      spawned.on('close', resolve)
    })

    if (exit_code !== 0) {
      throw new Error(`Non-zero exit code of \`${exit_code}\` detected`)
    }

    return exit_code
  }

  async install(): Promise<void> {
    const binary_path = await this.fetch_binary()
    await this.execute(binary_path)
  }

  private async fetch_binary(): Promise<string> {
    if (!this.local_root) {
      const request = new Request(this.nix_installer_url, {
        redirect: 'follow'
      })

      const response = await fetch(request)
      if (!response.ok) {
        throw new Error(
          `Got a status of ${response.status} from \`${this.nix_installer_url}\`, expected a 200`
        )
      }

      const tempdir = await mkdtemp(join(tmpdir(), 'nix-installer-'))
      const tempfile = join(tempdir, `nix-installer-${this.platform}`)

      const handle = await open(tempfile)
      const writer = handle.createWriteStream()

      const blob = await response.blob()
      const stream = blob.stream() as unknown as Readable
      stream.pipe(writer)
      writer.close()

      return tempfile
    } else {
      return join(this.local_root, `nix-installer-${this.platform}`)
    }
  }
}

type ExecuteEnvironment = {
  // All env vars are strings, no fanciness here.
  RUST_BACKTRACE?: string
  NIX_INSTALLER_MODIFY_PROFILE?: string
  NIX_INSTALLER_NIX_BUILD_GROUP_NAME?: string
  NIX_INSTALLER_NIX_BUILD_GROUP_ID?: string
  NIX_INSTALLER_NIX_BUILD_USER_PREFIX?: string
  NIX_INSTALLER_NIX_BUILD_USER_COUNT?: string
  NIX_INSTALLER_NIX_BUILD_USER_ID_BASE?: string
  NIX_INSTALLER_NIX_PACKAGE_URL?: string
  NIX_INSTALLER_PROXY?: string
  NIX_INSTALLER_SSL_CERT_FILE?: string
  NIX_INSTALLER_DIAGNOSTIC_ENDPOINT?: string
  NIX_INSTALLER_ENCRYPT?: string
  NIX_INSTALLER_CASE_SENSITIVE?: string
  NIX_INSTALLER_VOLUME_LABEL?: string
  NIX_INSTALLER_ROOT_DISK?: string
  NIX_INSTALLER_INIT?: string
  NIX_INSTALLER_START_DAEMON?: string
}

function get_nix_platform(): string {
  const env_os = process.env.RUNNER_OS
  const env_arch = process.env.RUNNER_ARCH

  if (env_os === 'macOS' && env_arch === 'X64') {
    return 'x86_64-darwin'
  } else if (env_os === 'macOS' && env_arch === 'ARM64') {
    return 'aarch64-darwin'
  } else if (env_os === 'Linux' && env_arch === 'X64') {
    return 'x86_64-linux'
  } else if (env_os === 'Linux' && env_arch === 'ARM64') {
    return 'aarch64-linux'
  } else {
    throw new Error(
      `Unsupported \`RUNNER_OS\` (currently \`${env_os}\`) and \`RUNNER_ARCH\` (currently \`${env_arch}\`)  combination`
    )
  }
}

function resolve_nix_installer_url(platform: string): URL {
  // Only one of these are allowed.
  const nix_installer_branch = action_input_string_or_null(
    'nix-installer-branch'
  )
  const nix_installer_pr = action_input_number_or_null('nix-installer-pr')
  const nix_installer_revision = action_input_string_or_null(
    'nix-installer-revision'
  )
  const nix_installer_tag = action_input_string_or_null('nix-installer-tag')
  const nix_installer_url = action_input_string_or_null('nix-installer-url')

  let num_set = 0
  if (nix_installer_branch !== null) {
    num_set += 1
  }
  if (nix_installer_pr !== null) {
    num_set += 1
  }
  if (nix_installer_revision !== null) {
    num_set += 1
  }
  if (nix_installer_tag !== null) {
    num_set += 1
  }
  if (nix_installer_url !== null) {
    num_set += 1
  }
  if (num_set > 1) {
    throw new Error(
      `The following options are mututally exclusive, but ${num_set} were set: \`nix_installer_branch\`, \`nix_installer_pr\`, \`nix_installer_revision\`, \`nix_installer_tag\`, and \`nix_installer_url\``
    )
  }

  if (nix_installer_branch !== null) {
    return new URL(
      `https://install.determinate.systems/nix/branch/${nix_installer_branch}/nix-installer-${platform}?ci=github`
    )
  } else if (nix_installer_pr !== null) {
    return new URL(
      `https://install.determinate.systems/nix/pr/${nix_installer_pr}/nix-installer-${platform}?ci=github`
    )
  } else if (nix_installer_revision !== null) {
    return new URL(
      `https://install.determinate.systems/nix/rev/${nix_installer_revision}/nix-installer-${platform}?ci=github`
    )
  } else if (nix_installer_tag !== null) {
    return new URL(
      `https://install.determinate.systems/nix/tag/${nix_installer_tag}/nix-installer-${platform}?ci=github`
    )
  } else if (nix_installer_url !== null) {
    return new URL(nix_installer_url)
  } else {
    return new URL(
      `https://install.determinate.systems/nix/nix-installer-${platform}?ci=github`
    )
  }
}

function action_input_string_or_null(name: string): string | null {
  const value = actions_core.getInput(name)
  if (value === '') {
    return null
  } else {
    return value
  }
}

function action_input_multiline_string_or_null(name: string): string[] | null {
  const value = actions_core.getMultilineInput(name)
  if (value.length === 0) {
    return null
  } else {
    return value
  }
}

function action_input_number_or_null(name: string): number | null {
  const value = actions_core.getInput(name)
  if (value === '') {
    return null
  } else {
    return Number(value)
  }
}

function action_input_bool_or_null(name: string): boolean {
  return actions_core.getBooleanInput(name)
}

async function main(): Promise<void> {
  try {
    const installer = new NixInstallerAction()
    await installer.install()
  } catch (error) {
    if (error instanceof Error) actions_core.setFailed(error.message)
  }
}

main()
