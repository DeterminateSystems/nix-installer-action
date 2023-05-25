# Determinate Nix Installer Action

`nix-installer` is an opinionated alternative to the [official Nix install scripts](https://nixos.org/download.html).

The goal of this action is to support teams adopting Nix by provide the best Nix experience possible on GitHub Actions.
This action supports Linux and macOS runners, including persistent self-hosted runners.
Typical install times take less than 14 seconds.

By default, this action will provide a summary of out of date or unstable Flake inputs, through our [flake checker](https://github.com/DeterminateSystems/flake-checker/).

You can use [`nix-installer`](https://github.com/DeterminateSystems/nix-installer) as a Github action like so:

```yaml
on:
  pull_request:
  push:
    branches: [main]

jobs:
  lints:
    name: Build
    runs-on: ubuntu-22.04
    steps:
      - uses: actions/checkout@v3
      - name: Install Nix
        uses: DeterminateSystems/nix-installer-action@v3
      - name: Run `nix build`
        run: nix build .
```

See [`.github/workflows/ci.yml`](.github/workflows/ci.yml) for a full example.

## Configuration

| Parameter                      | Description                                                                                                                                                                                                                                              | Type                                       | Default                                              |
| :----------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------------------------------- | :--------------------------------------------------- |
| `backtrace`                    | The setting for [`RUST_BACKTRACE`][backtrace]                                                                                                                                                                                                            | string                                     |                                                      |
| `check-flake`                  | Automatically check the flake.lock for problems.                                                                                                                                                                                                         | bool                                       | `true`                                               |
| `extra-args`                   | Extra arguments to pass to the planner (prefer using structured `with:` arguments unless using a custom [planner]!)                                                                                                                                      | string                                     |                                                      |
| `extra-conf`                   | Extra configuration lines for `/etc/nix/nix.conf` (includes `access-tokens` with `secrets.GITHUB_TOKEN` automatically if `github-token` is set)                                                                                                          | string                                     |                                                      |
| `flake-checker-send-telemetry` | Anonymously report the number of detected issues for measure the effectiveness of the flake checker. To disable set, to `false`. Forced to off by changing the `diagnostic-endpoint` option.                                                             | bool                                       | `true`                                               |
| `github-token`                 | A [GitHub token] for making authenticated requests (which have a higher rate-limit quota than unauthenticated requests)                                                                                                                                  | string                                     | `${{ github.token }}`                                |
| `init`                         | The init system to configure (requires `planner: linux-multi`)                                                                                                                                                                                           | enum (`none` or `systemd`)                 |                                                      |
| `local-root`                   | A local `nix-installer` binary root. Overrides the `nix-installer-url` setting (a `nix-installer.sh` should exist, binaries should be named `nix-installer-$ARCH`, eg. `nix-installer-x86_64-linux`).                                                    | Boolean                                    | `false`                                              |
| `log-directives`               | A list of [tracing directives], comma separated with `-`s replaced with `_` (eg. `nix_installer=trace`)                                                                                                                                                  | string                                     |                                                      |
| `logger`                       | The logger to use during installation                                                                                                                                                                                                                    | enum (`pretty`, `json`, `full`, `compact`) |                                                      |
| `mac-case-sensitive`           | Use a case-sensitive volume (`planner: macos` only)                                                                                                                                                                                                      | Boolean                                    | `false`                                              |
| `mac-encrypt`                  | Force encryption on the volume (`planner: macos` only)                                                                                                                                                                                                   | Boolean                                    | `false`                                              |
| `mac-root-disk`                | The root disk of the target (`planner: macos` only)                                                                                                                                                                                                      | string                                     |                                                      |
| `mac-volume-label`             | The label for the created [APFS] volume (`planner: macos` only)                                                                                                                                                                                          | string                                     |                                                      |
| `modify-profile`               | Modify the user [profile] to automatically load Nix                                                                                                                                                                                                      | Boolean                                    | `false`                                              |
| `nix-build-group-id`           | The Nix build group GID                                                                                                                                                                                                                                  | integer                                    |                                                      |
| `nix-build-group-name`         | The Nix build group name                                                                                                                                                                                                                                 | string                                     |                                                      |
| `nix-build-user-base`          | The Nix build user base UID (ascending)                                                                                                                                                                                                                  | integer                                    |                                                      |
| `nix-build-user-count`         | The number of build users to create                                                                                                                                                                                                                      | integer                                    | 32                                                   |
| `nix-build-user-prefix`        | The Nix build user prefix (user numbers will be postfixed)                                                                                                                                                                                               | string                                     |                                                      |
| `nix-installer-branch`         | The branch of `nix-installer` to use (conflicts with the `nix-installer-tag`, `nix-installer-revision`, and `nix-installer-branch`)                                                                                                                      | string                                     |                                                      |
| `nix-installer-pr`             | The pull request of `nix-installer` to use (conflicts with `nix-installer-tag`, `nix-installer-revision`, and `nix-installer-branch`)                                                                                                                    | integer                                    |                                                      |
| `nix-installer-revision`       | The revision of `nix-installer` to use (conflicts with `nix-installer-tag`, `nix-installer-branch`, and `nix-installer-pr`)                                                                                                                              | string                                     |                                                      |
| `nix-installer-tag`            | The tag of `nix-installer` to use (conflicts with `nix-installer-revision`, `nix-installer-branch`, `nix-installer-pr`)                                                                                                                                  | string                                     |                                                      |
| `nix-installer-url`            | A URL pointing to a `nix-installer.sh` script                                                                                                                                                                                                            | URL                                        | `https://install.determinate.systems/nix`            |
| `nix-package-url`              | The Nix package URL                                                                                                                                                                                                                                      | URL                                        |                                                      |
| `planner`                      | The installation [planner] to use                                                                                                                                                                                                                        | enum (`linux` or `macos`)                  |                                                      |
| `reinstall`                    | Force a reinstall if an existing installation is detected (consider backing up `/nix/store`)                                                                                                                                                             | Boolean                                    | `false`                                              |
| `start-daemon`                 | If the daemon should be started, requires `planner: linux-multi`                                                                                                                                                                                         | Boolean                                    | `false`                                              |
| `trust-runner-user`            | Whether to make the runner user trusted by the Nix daemon                                                                                                                                                                                                | Boolean                                    | `true`                                               |
| `diagnostic-endpoint`          | Diagnostic endpoint url where the installer sends install [diagnostic reports](https://github.com/DeterminateSystems/nix-installer#diagnostics) to, to disable set this to an empty string. Changing this value also disables flake-checker's telemetry. | string                                     | `https://install.determinate.systems/nix/diagnostic` |
| `proxy`                        | The proxy to use (if any), valid proxy bases are `https://$URL`, `http://$URL` and `socks5://$URL`                                                                                                                                                       | string                                     |                                                      |
| `ssl-cert-file`                | An SSL cert to use (if any), used for fetching Nix and sets `NIX_SSL_CERT_FILE` for Nix                                                                                                                                                                  | string                                     |                                                      |

[apfs]: https://en.wikipedia.org/wiki/Apple_File_System
[backtrace]: https://doc.rust-lang.org/std/backtrace/index.html#environment-variables
[github token]: https://docs.github.com/en/actions/security-guides/automatic-token-authentication
[planner]: https://github.com/determinateSystems/nix-installer#usage
[profile]: https://nixos.org/manual/nix/stable/package-management/profiles
[tracing directives]: https://docs.rs/tracing-subscriber/latest/tracing_subscriber/filter/struct.EnvFilter.html#directives
