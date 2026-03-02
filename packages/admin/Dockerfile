FROM alpine AS base

# Disable the runtime transpiler cache by default inside Docker containers.
# On ephemeral containers, the cache is not useful
ARG BUN_RUNTIME_TRANSPILER_CACHE_PATH=0
ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=${BUN_RUNTIME_TRANSPILER_CACHE_PATH}
RUN apk add --no-cache libgcc libstdc++ 

FROM base AS build-amd64
COPY --chmod=755 bin/opencode-admin-linux-x64 /usr/local/bin/opencode-admin

FROM base AS build-arm64
COPY --chmod=755 bin/opencode-admin-linux-arm64 /usr/local/bin/opencode-admin

ARG TARGETARCH
FROM build-${TARGETARCH}
COPY ui/dist /usr/local/bin/ui/dist
ENTRYPOINT ["opencode-admin"]
