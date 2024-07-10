# The Determinate Nix Installer Action

Based on the [Determinate Nix Installer](https://github.com/DeterminateSystems/nix-installer), responsible for over tens of thousands of Nix installs daily.
The fast, friendly, and reliable GitHub Action to install Nix with Flakes.

## Supports

- ✅ **Accelerated KVM** on open source projects and larger runners. See [GitHub's announcement](https://github.blog/changelog/2023-02-23-hardware-accelerated-android-virtualization-on-actions-windows-and-linux-larger-hosted-runners/) for more info.
- ✅ Linux, x86_64, aarch64, and i686
- ✅ macOS, x86_64 and aarch64
- ✅ WSL2, x86_64 and aarch64
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

### With FlakeHub

To fetch private flakes from FlakeHub, update the `permissions` block and pass `flakehub: true`:

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
      - uses: DeterminateSystems/nix-installer-action@main
        with:
          flakehub: true
      - run: nix build .
```

See [`.github/workflows/ci.yml`](.github/workflows/ci.yml) for a full example.

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
  * `extra-nix-path` is set to `nixpkgs=flake:nixpkgs`
  * `max-jobs` is set to `auto`
- KVM is enabled by default.
- an installation receipt (for uninstalling) is stored at `/nix/receipt.json` as well as a copy of the install binary at `/nix/nix-installer`
- `nix-channel --update` is not run, `~/.nix-channels` is not provisioned
- `ssl-cert-file` is set in `/etc/nix/nix.conf` if the `ssl-cert-file` argument is used.

## Configuration

| Parameter               | Description                                                                                                                                                                                                                                                                    | Type                                       | Default                                                        |
| :---------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------- | :------------------------------------------------------------- |
| `backtrace`             | The setting for [`RUST_BACKTRACE`][backtrace]                                                                                                                                                                                                                                  | string                                     |                                                                |
| `extra-args`            | Extra arguments to pass to the planner (prefer using structured `with:` arguments unless using a custom [planner]!)                                                                                                                                                            | string                                     |                                                                |
| `extra-conf`            | Extra configuration lines for `/etc/nix/nix.conf` (includes `access-tokens` with `secrets.GITHUB_TOKEN` automatically if `github-token` is set)                                                                                                                                | string                                     |                                                                |
| `flakehub`              | Log in to FlakeHub to pull private flakes using the GitHub Actions [JSON Web Token](https://jwt.io) (JWT), which is bound to the `api.flakehub.com` audience.                                                                                                                  | Boolean                                    | `false`                                                        |
| `force-docker-shim`     | Force the use of Docker as a process supervisor. This setting is automatically enabled when necessary.                                                                                                                                                                         | Boolean                                    | `false`                                                        |
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

[apfs]: https://en.wikipedia.org/wiki/Apple_File_System
[backtrace]: https://doc.rust-lang.org/std/backtrace/index.html#environment-variables
[github token]: https://docs.github.com/en/actions/security-guides/automatic-token-authentication
[planner]: https://github.com/determinateSystems/nix-installer#usage
[profile]: https://nixos.org/manual/nix/stable/package-management/profiles
[tracing directives]: https://docs.rs/tracing-subscriber/latest/tracing_subscriber/filter/struct.EnvFilter.html#directives
