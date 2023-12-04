# Determinate Nix Installer Action: Docker Shim

The image in this repository is a product of the contained Dockerfile.
It is an otherwise empty image with a configuration layer.

This image is to be used in GitHub Actions runners which don't have systemd available, like self-hosted ARC runners.

The image would have no layers / content at all, however Docker has a bug and refuses to export those images.
This isn't a technical limitation preventing us from creating and distributing that image, but an ease-of-use limitation.
Since some of Docker's inspection tools break on an empty image, the image contains a single layer containing a README.

To build:

```shell
docker build . --tag determinate-nix-shim:latest
docker image save determinate-nix-shim:latest | gzip --best > amd64.tar
```

Then, extract the tarball:

```
mkdir extract
cd extract
tar -xf ../amd64.tar
```

It'll look like this, though the hashes will be different.

```
.
├── 771204abb853cdde06bbbc680001a02642050a1db1a7b0a48cf5f20efa8bdc5d.json
├── c4088111818e553e834adfc81bda8fe6da281afa9a40012eaa82796fb5476e98
│   ├── VERSION
│   ├── json
│   └── layer.tar
├── manifest.json
└── repositories
```

Ignore `manifest.json`, and edit the other two JSON documents to replace `amd64` with `arm64`, both in a key named "architecture:

```
"architecture":"amd64"
```

Then re-create the tar, from within the `extract` directory:

```
tar --options gzip:compression-level=9 -zcf ../arm64.tar.gz .
```

Then `git add` the two .tar.gz's and you're done.
