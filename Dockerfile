# harness-updater: triages harness issues and runs the harness loop for the accepted ones.
# Build and start with `docker compose up -d --build` (README.md → Running it).
FROM node:22-bookworm-slim

# The host user's ids, so the read-only mount of your projects is readable.
ARG UID=1001
ARG GID=1001
ARG CLAUDE_CODE_VERSION=2.1.310

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git gnupg \
  && install -d -m 0755 /etc/apt/keyrings \
  && curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    -o /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
  && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
    > /etc/apt/sources.list.d/github-cli.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends gh \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g "@anthropic-ai/claude-code@${CLAUDE_CODE_VERSION}" && corepack enable

# Replace the image's `node` user (uid 1000) with one that matches the host user.
RUN userdel -r node \
  && groupadd -g "${GID}" updater \
  && useradd -m -u "${UID}" -g "${GID}" -s /bin/bash updater \
  && install -d -o updater -g updater /data /app

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 UPDATER_DATA=/data
WORKDIR /app
USER updater
COPY --chown=updater:updater package.json pnpm-lock.yaml ./
RUN corepack install && pnpm install --frozen-lockfile --ignore-scripts
COPY --chown=updater:updater . .

USER root
RUN install -m 0755 docker/updater /usr/local/bin/updater
USER updater

VOLUME ["/data"]
ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["run"]
