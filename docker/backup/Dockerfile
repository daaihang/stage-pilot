FROM postgres:17-bookworm

ARG WAL_G_VERSION=3.0.9
ARG TARGETARCH

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && case "$TARGETARCH" in amd64) wal_arch=amd64; wal_sha=4f03ee4679db7f660bfd1b2b8291ac5df247cd2ec48074b60c112f4897299f24 ;; arm64) wal_arch=aarch64; wal_sha=28ae0281b591f072c20942fb7df3dfd499cd44109ea1c8ba3aba34bd9d695e25 ;; *) echo "unsupported target architecture: $TARGETARCH" >&2; exit 1 ;; esac \
    && curl -fsSL "https://github.com/wal-g/wal-g/releases/download/v${WAL_G_VERSION}/wal-g-pg-22.04-${wal_arch}.tar.gz" -o /tmp/wal-g.tar.gz \
    && echo "${wal_sha}  /tmp/wal-g.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/wal-g.tar.gz -C /tmp \
    && install -m 0755 "/tmp/wal-g-pg-22.04-${wal_arch}" /usr/local/bin/wal-g \
    && rm -f /tmp/wal-g.tar.gz "/tmp/wal-g-pg-22.04-${wal_arch}"

COPY docker/backup/backup-entrypoint.sh /usr/local/bin/backup-entrypoint.sh
COPY docker/backup/restore-drill.sh /usr/local/bin/restore-drill.sh
ENTRYPOINT ["sh", "/usr/local/bin/backup-entrypoint.sh"]
