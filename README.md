# Nix Installer Action

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
      uses: DeterminateSystems/nix-installer-action@main
      with:
        # Allow the installed Nix to make authenticated Github requests.
        # If you skip this, you will likely get rate limited.
        github-token: ${{ secrets.GITHUB_TOKEN }}
    - name: Run `nix build`
      run: nix build .
```

See [`.github/workflows/ci.yml`](.github/workflows/ci.yml) for a full example.
