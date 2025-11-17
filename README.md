# The Determinate Nix Installer Action

The fast, friendly, and reliable GitHub Action to install [Determinate Nix][det-nix] with [flakes].
The Determinate Nix Installer Action is based on [Determinate Nix Installer][installer], which is responsible for tens of thousands of installs daily.

## Supports

- ✅ **Accelerated KVM** on open source projects and larger runners. See [GitHub's announcement](https://github.blog/changelog/2023-02-23-hardware-accelerated-android-virtualization-on-actions-windows-and-linux-larger-hosted-runners/) for more info.
- ✅ Linux (x86_64 and aarch64)
- ✅ macOS (aarch64)
- ✅ Windows Subsystem for Linux (WSL) (x86_64 and aarch64)
- ✅ Containers
- ✅ Valve's SteamOS
- ✅ GitHub Enterprise Server
- ✅ GitHub Hosted, self-hosted, and long running Actions Runners

## Usage

```yaml
on:
  pull_request:
  push:
    branches: [main]

jobs:
  lints:
    name: Build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: DeterminateSystems/nix-installer-action@main
      - run: nix build .
```

> [!NOTE]
> This Action installs [Determinate Nix][det-nix] by default.
> You can, however, use it to install [upstream Nix](#installing-upstream-nix) until **January 1, 2026**.

### With FlakeHub

To fetch private flakes from FlakeHub and Nix builds from FlakeHub Cache, update the `permissions` block and use [`determinate-nix-action`][determinate-nix-action] instead of this Action:

```yaml
on:
  pull_request:
  push:
    branches: [main]

jobs:
  lints:
    name: Build
    runs-on: ubuntu-latest
    permissions:
      id-token: "write"
      contents: "read"
    steps:
      - uses: actions/checkout@v4
      - uses: DeterminateSystems/determinate-nix-action@v3
      - run: nix build .
```

See [`.github/workflows/ci.yml`](.github/workflows/ci.yml) for a full example.

### Pinning the version

This GitHub Action uses the most recent version of Determinate Nix Installer, even when the Action itself is pinned.
If you wish to pin your CI workflows to a specific Determinate Nix version, use the [`determinate-nix-action`][determinate-nix-action].
That Action is updated and tagged for every Determinate release.

The `DeterminateSystems/determinate-nix-action@v3.5.2` reference, for example, always installs Determinate Nix v3.5.2.

Additionally, an extra tag on the major version is kept up to date with the current release.
The `DeterminateSystems/determinate-nix-action@v3` reference, for example, installs the most recent release in the `v3.x.y` series.

If you do tag to a specific version, please [use Dependabot to update your actions][dependabot-actions].

### Advanced Usage

- If KVM is available, the installer sets up KVM so that Nix can use it ,and exports the `DETERMINATE_NIX_KVM` environment variable set to 1.
  If KVM is not available, `DETERMINATE_NIX_KVM` is set to 0.
  This can be used in combination with GitHub Actions' `if` syntax for turning on and off steps.

## Installation Differences

Differing from the upstream [Nix](https://github.com/NixOS/nix) installer scripts:

- In `nix.conf`:
  - the `nix-command` and `flakes` features are enabled
  - `bash-prompt-prefix` is set
  - `auto-optimise-store` is set to `true` (On Linux only)
  - `extra-nix-path` is set to `nixpkgs=flake:nixpkgs`
  - `max-jobs` is set to `auto`
- KVM is enabled by default.
- an installation receipt (for uninstalling) is stored at `/nix/receipt.json` as well as a copy of the install binary at `/nix/nix-installer`
- `nix-channel --update` is not run, `~/.nix-channels` is not provisioned
- `ssl-cert-file` is set in `/etc/nix/nix.conf` if the `ssl-cert-file` argument is used.

## Configuration

| Parameter               | Description                                                                                                                                                                                                                                                                    | Type                                       | Default                                                        |
| :---------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------- | :------------------------------------------------------------- |
| `backtrace`             | The setting for [`RUST_BACKTRACE`][backtrace]                                                                                                                                                                                                                                  | string                                     |                                                                |
| `determinate`           | Whether to install [Determinate Nix](https://determinate.systems/enterprise) and log in to FlakeHub for private Flakes and binary caches.                                                                                                                                      | Boolean                                    | `true`                                                         |
| `extra-args`            | Extra arguments to pass to the planner (prefer using structured `with:` arguments unless using a custom [planner]!)                                                                                                                                                            | string                                     |                                                                |
| `extra-conf`            | Extra configuration lines for `/etc/nix/nix.conf` (includes `access-tokens` with `secrets.GITHUB_TOKEN` automatically if `github-token` is set)                                                                                                                                | string                                     |                                                                |
| `flakehub`              | Deprecated. Implies `determinate`.                                                                                                                                                                                                                                             | Boolean                                    | `false`                                                        |
| `force-no-systemd`      | Force using other methods than systemd to launch the daemon. This setting is automatically enabled when necessary.                                                                                                                                                             | Boolean                                    | `false`                                                        |
| `github-token`          | A [GitHub token] for making authenticated requests (which have a higher rate-limit quota than unauthenticated requests)                                                                                                                                                        | string                                     | `${{ github.token }}`                                          |
| `github-server-url`     | The URL for the GitHub server, to use with the `github-token` token. Defaults to the current GitHub server, supporting GitHub Enterprise Server automatically. Only change this value if the provided `github-token` is for a different GitHub server than the current server. | string                                     | `${{ github.server }}`                                         |
| `init`                  | The init system to configure (requires `planner: linux-multi`)                                                                                                                                                                                                                 | enum (`none` or `systemd`)                 |                                                                |
| `kvm`                   | Automatically configure the GitHub Actions Runner for NixOS test support, if the host supports it.                                                                                                                                                                             | Boolean                                    | `true`                                                         |
| `local-root`            | A local `nix-installer` binary root. Overrides the `nix-installer-url` setting (a `nix-installer.sh` should exist, binaries should be named `nix-installer-$ARCH`, eg. `nix-installer-x86_64-linux`).                                                                          | Boolean                                    | `false`                                                        |
| `log-directives`        | A list of [tracing directives], comma separated with `-`s replaced with `_` (eg. `nix_installer=trace`)                                                                                                                                                                        | string                                     |                                                                |
| `logger`                | The logger to use during installation                                                                                                                                                                                                                                          | enum (`pretty`, `json`, `full`, `compact`) |                                                                |
| `mac-case-sensitive`    | Use a case-sensitive volume (`planner: macos` only)                                                                                                                                                                                                                            | Boolean                                    | `false`                                                        |
| `mac-encrypt`           | Force encryption on the volume (`planner: macos` only)                                                                                                                                                                                                                         | Boolean                                    | `false`                                                        |
| `mac-root-disk`         | The root disk of the target (`planner: macos` only)                                                                                                                                                                                                                            | string                                     |                                                                |
| `mac-volume-label`      | The label for the created [APFS] volume (`planner: macos` only)                                                                                                                                                                                                                | string                                     |                                                                |
| `modify-profile`        | Modify the user [profile] to automatically load Nix                                                                                                                                                                                                                            | Boolean                                    | `false`                                                        |
| `nix-build-group-id`    | The Nix build group GID                                                                                                                                                                                                                                                        | integer                                    |                                                                |
| `nix-build-group-name`  | The Nix build group name                                                                                                                                                                                                                                                       | string                                     |                                                                |
| `nix-build-user-base`   | The Nix build user base UID (ascending)                                                                                                                                                                                                                                        | integer                                    |                                                                |
| `nix-build-user-count`  | The number of build users to create                                                                                                                                                                                                                                            | integer                                    | 32                                                             |
| `nix-build-user-prefix` | The Nix build user prefix (user numbers will be postfixed)                                                                                                                                                                                                                     | string                                     |                                                                |
| `source-branch`         | The branch of `nix-installer` to use (conflicts with the `source-tag`, `source-revision`, and `source-branch`)                                                                                                                                                                 | string                                     |                                                                |
| `source-pr`             | The pull request of `nix-installer` to use (conflicts with `source-tag`, `source-revision`, and `source-branch`)                                                                                                                                                               | integer                                    |                                                                |
| `source-revision`       | The revision of `nix-installer` to use (conflicts with `source-tag`, `source-branch`, and `source-pr`)                                                                                                                                                                         | string                                     |                                                                |
| `source-tag`            | The tag of `nix-installer` to use (conflicts with `source-revision`, `source-branch`, `source-pr`)                                                                                                                                                                             | string                                     |                                                                |
| `source-url`            | A URL pointing to the `nix-installer` binary                                                                                                                                                                                                                                   | URL                                        | n/a (calculated)                                               |
| `nix-package-url`       | The Nix package URL                                                                                                                                                                                                                                                            | URL                                        |                                                                |
| `planner`               | The installation [planner] to use                                                                                                                                                                                                                                              | enum (`linux` or `macos`)                  |                                                                |
| `reinstall`             | Force a reinstall if an existing installation is detected (consider backing up `/nix/store`)                                                                                                                                                                                   | Boolean                                    | `false`                                                        |
| `start-daemon`          | If the daemon should be started, requires `planner: linux-multi`                                                                                                                                                                                                               | Boolean                                    | `false`                                                        |
| `trust-runner-user`     | Whether to make the runner user trusted by the Nix daemon                                                                                                                                                                                                                      | Boolean                                    | `true`                                                         |
| `diagnostic-endpoint`   | Diagnostic endpoint url where the installer sends install [diagnostic reports](https://github.com/DeterminateSystems/nix-installer#diagnostics) to, to disable set this to an empty string                                                                                     | string                                     | `https://install.determinate.systems/nix-installer/diagnostic` |
| `proxy`                 | The proxy to use (if any), valid proxy bases are `https://$URL`, `http://$URL` and `socks5://$URL`                                                                                                                                                                             | string                                     |                                                                |
| `ssl-cert-file`         | An SSL cert to use (if any), used for fetching Nix and sets `NIX_SSL_CERT_FILE` for Nix                                                                                                                                                                                        | string                                     |                                                                |

## Installing upstream Nix

Although Determinate Nix is the default, you can also use this Action to install [upstream Nix][upstream].
Make sure to set `determinate: false` in the Action's configuration:

```yaml
- uses: DeterminateSystems/nix-installer-action@main
  with:
    determinate: false
```

This option will be available until **January 1, 2026**, at which point installing upstream Nix using this Action will no longer be possible.

[apfs]: https://en.wikipedia.org/wiki/Apple_File_System
[backtrace]: https://doc.rust-lang.org/std/backtrace/index.html#environment-variables
[dependabot-actions]: https://github.com/DeterminateSystems/determinate-nix-action?tab=readme-ov-file#-automate-updates-with-dependabot
[det-nix]: https://docs.determinate.systems/determinate-nix
[determinate-nix-action]: https://github.com/DeterminateSystems/determinate-nix-action
[github token]: https://docs.github.com/en/actions/security-guides/automatic-token-authentication
[installer]: https://github.com/DeterminateSystems/nix-installer
[planner]: https://github.com/determinateSystems/nix-installer#usage
[profile]: https://nixos.org/manual/nix/stable/package-management/profiles
[tracing directives]: https://docs.rs/tracing-subscriber/latest/tracing_subscriber/filter/struct.EnvFilter.html#directives
[upstream]: https://github.com/NixOS/nix
