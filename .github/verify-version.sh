#!/usr/bin/env

EXPECTED_VERSION="${1}"

NIX_VERSION_OUTPUT=$(nix --version)
NIX_VERSION=$(echo "${NIX_VERSION_OUTPUT}" | awk '{print $NF}')
EXPECTED_OUTPUT="nix (Nix) ${EXPECTED_VERSION}"
if [ "${NIX_VERSION_OUTPUT}" != "${EXPECTED_OUTPUT}" ]; then
  echo "Nix version ${NIX_VERSION} didn't match expected version ${EXPECTED_VERSION}"
  exit 1
else
  echo "Success! Nix version ${NIX_VERSION} installed as expected"
fi
