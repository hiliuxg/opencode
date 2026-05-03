FROM python:3.13-slim AS base

# Disable the runtime transpiler cache by default inside Docker containers.
# On ephemeral containers, the cache is not useful
ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}
ENV OPENCODE_DISABLE_MODELS_FETCH=true
ENV OPENCODE_DISABLE_DEFAULT_PLUGINS=true
ENV OPENCODE_DISABLE_LSP_DOWNLOAD=true

# RUN pip install PyYAML pandas requests openpyxl openai

ENV PIP_INDEX_URL=http://mirror.kgidc.cn/root/pypi/+simple/
ENV PIP_TRUSTED_HOST=mirror.kgidc.cn

RUN apt-get update && apt-get install -y libgcc-s1 libstdc++6 ripgrep curl git nodejs npm && rm -rf /var/lib/apt/lists/*

RUN npm config set registry http://di-mirrors.tmeoa.com/repository/npm-public/

COPY packages/opencode/node_modules /root/.config/opencode/node_modules

FROM base AS build-amd64
COPY packages/opencode/dist/opencode-linux-x64-baseline/bin/opencode /usr/local/bin/opencode

#FROM base AS build-arm64
#COPY packages/opencode/dist/opencode-linux-arm64/bin/opencode /usr/local/bin/opencode

ARG TARGETARCH
FROM build-${TARGETARCH}

COPY packages/app/dist /usr/local/bin/ui
RUN mkdir -p /root/.config/cc-connect
COPY docker/cc-connect/cc-connect-v1.3.2-dirty-linux-amd64 /usr/local/bin/cc-connect
COPY docker/cc-connect/config.toml /root/.config/cc-connect/config.toml
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN opencode --version
RUN chmod +x /usr/local/bin/cc-connect /usr/local/bin/entrypoint.sh
RUN cc-connect --version

ENTRYPOINT ["entrypoint.sh"]
CMD ["both"]
