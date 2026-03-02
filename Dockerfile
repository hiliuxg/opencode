FROM python:3.13-alpine AS base

# Disable the runtime transpiler cache by default inside Docker containers.
# On ephemeral containers, the cache is not useful
ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}
ENV OPENCODE_DISABLE_MODELS_FETCH=true
ENV OPENCODE_DISABLE_DEFAULT_PLUGINS=true
ENV OPENCODE_DISABLE_LSP_DOWNLOAD=true
ENV PIP_INDEX_URL=http://mirror.kgidc.cn/root/pypi/+simple/
ENV PIP_TRUSTED_HOST=mirror.kgidc.cn

RUN apk add libgcc libstdc++ ripgrep curl git
COPY packages/opencode/node_modules /root/.config/opencode/node_modules

FROM base AS build-amd64
COPY packages/opencode/dist/opencode-linux-x64-baseline-musl/bin/opencode /usr/local/bin/opencode

FROM base AS build-arm64
COPY packages/opencode/dist/opencode-linux-arm64-musl/bin/opencode /usr/local/bin/opencode

ARG TARGETARCH
FROM build-${TARGETARCH}

COPY packages/app/dist /usr/local/bin/ui

RUN opencode --version
ENTRYPOINT ["opencode"]
