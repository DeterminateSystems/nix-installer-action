# Determinate Nix Installer: Docker Shim
#
# This empty image exists to lean on Docker as a process supervisor when
# systemd isn't available. Specifically intended for self-hosted GitHub
# Actions runners using Docker-in-Docker.
#
# See: https://github.com/DeterminateSystems/nix-installer-action 

FROM scratch

ENTRYPOINT [ "/nix/var/nix/profiles/default/bin/nix-daemon"]
CMD []

HEALTHCHECK \
    --interval=5m \
    --timeout=3s \
    CMD ["/nix/var/nix/profiles/default/bin/nix", "store", "ping", "--store", "daemon"]

COPY ./Dockerfile /README.md
