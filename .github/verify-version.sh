#!/usr/bin/env bash

# This script verifies that the version of Nix installed on the runner
# matches the version supplied in the first argument.

EXPECTED_VERSION="${1}"

INSTALLED_NIX_VERSION_OUTPUT=$(nix --version)
INSTALLED_NIX_VERSION=$(echo "${INSTALLED_NIX_VERSION_OUTPUT}" | awk '{print $NF}')
EXPECTED_OUTPUT="nix (Nix) ${EXPECTED_VERSION}"

if [ "${INSTALLED_NIX_VERSION_OUTPUT}" != "${EXPECTED_OUTPUT}" ]; then
  echo "Nix version ${INSTALLED_NIX_VERSION} didn't match expected version ${EXPECTED_VERSION}"
  exit 1
else
  echo "Success! Nix version ${INSTALLED_NIX_VERSION} installed as expected"
  exit 0
fi
