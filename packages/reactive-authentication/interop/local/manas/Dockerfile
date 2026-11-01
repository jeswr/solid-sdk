# Manas (manomayam/manas) single_fs_wac recipe v0.1.2 — the project's released static (musl) Linux binaries,
# checksum-verified; there is no official image. Manas has no identity provider: the pod owner's WebID lives on
# the local Community Solid Server, whose network namespace this container shares (see compose.yml).
FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251
ARG TARGETARCH
ADD https://github.com/manomayam/manas/releases/download/v0.1.2/manas_server_single_fs_wac-aarch64-unknown-linux-musl.tar.gz /tmp/manas-arm64.tgz
ADD https://github.com/manomayam/manas/releases/download/v0.1.2/manas_server_single_fs_wac-x86_64-unknown-linux-musl.tar.gz /tmp/manas-amd64.tgz
RUN printf '%s  %s\n' \
        5f89acf80cccf5b9501d7031e4b2204c63c552cb1e4de23665624164450de7c7 /tmp/manas-arm64.tgz \
        af888e19f14ee2dadbaeae5df48633d4ffbe4c9ee017fbffaa4ac185a95d900d /tmp/manas-amd64.tgz \
    | sha256sum -c - \
    && tar -xzf "/tmp/manas-${TARGETARCH}.tgz" -C /usr/local/bin manas_server_single_fs_wac \
    && rm /tmp/manas-*.tgz \
    && mkdir -p /data
ENTRYPOINT ["/usr/local/bin/manas_server_single_fs_wac", "-c", "/etc/manas/config.toml"]
