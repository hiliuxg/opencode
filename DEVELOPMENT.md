
# 上一个版本 opencode-v125-03152153 
# 上一个版本 opencode-v125-03252302
# 上一个版本 opencode-v125-03262334 
# 上一个版本 opencode-v125-03282001 45f94d09e8a3
# 上一个版本 45f94d09e8a3   opencode-v125-03282001 
# 上一个版本 opencode-v1313-04101052
# opencode-v1313-04142202
# opencode-v1313-04171259
# opencode-v1313-04202355
# 84da2a3a23bd   opencode-v1313-04242355

# 前端构建 # 后端构建

export OPENCODE_BASE_PATH=/kgbi/starbot

bun run --cwd packages/app build

export OPENCODE_BASE_PATH=/kgbi/starbot
export OPENCODE_SKILL_MARKET_TOKEN=4LXfT11bcFQaU5T27Zgw40G7jYB

OPENCODE_CHANNEL=latest OPENCODE_VERSION=1.3.13 ./packages/opencode/script/build.ts

docker buildx build --platform linux/amd64 \
      -t opencode-v1313-05036355 \
      --load \
      . 

docker save -o opencode-v1313-05036355.tar opencode-v1313-05036355

sudo docker load -i opencode-v1313-05036355.tar
  
# 同容器启动 OpenCode server 和 cc-connect。
sudo docker run -d \
  -p 4096:4096 \
  -e OPENCODE_WEBFETCH_PROXY=http://10.5.135.172:2443 \
  -e OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX=20480 \
  -e OPENCODE_ACCESS_GRANTS=/root/.config/opencode/grants.json \
  -e OPENCODE_BASE_PATH=/kgbi/starbot \
  -e OPENCODE_LOG_LEVEL=INFO \
  -e OPENCODE_CORS='*' \
  -e OPENCODE_SKILL_MARKET_TOKEN=4LXfT11bcFQaU5T27Zgw40G7jYB \
  -e OPENCODE_DISABLE_MODELS_FETCH=true \
  -e OPENCODE_DISABLE_DEFAULT_PLUGINS=true \
  -e OPENCODE_DISABLE_LSP_DOWNLOAD=true \
  -e OPENCODE_GLOBAL_PLUGIN_INSTALL_ONLY=true \
  -v /data1/opencode:/home \
  -v /data1/opencode/base-1333/cc-connect:/root/.config/cc-connect \
  -v /data1/opencode/base-1333/config:/root/.config/opencode \
  -v /data1/opencode/base-1333/local:/root/.local \
  -v /data1/opencode/base-1333/mcporter:/root/.mcporter \
  opencode-v1313-05036355 \
  opencode --print-logs --log-level INFO serve --hostname 0.0.0.0 --port 4096 --cors '*'


---

# cc-connect Docker Deployment

This document describes how to package a prebuilt `cc-connect` Linux binary and
configuration into the opencode Docker build context.

## Paths

```bash
CC_CONNECT_DIR=/Users/leoliu/xiaogenliu/cc-connect
OPENCODE_DIR=/Users/leoliu/mycode/opencode
OPENCODE_CC_DIR="$OPENCODE_DIR/docker/cc-connect"
```

## Build cc-connect Binary

Run the build from the `cc-connect` repository:

```bash
cd "$CC_CONNECT_DIR"
make clean
make release TARGET=linux/amd64 NO_WEB=1
```

## Copy Into opencode Docker Context

Copy the binary and config into `opencode/docker/cc-connect`:

```bash
mkdir -p "$OPENCODE_CC_DIR"

install -m 0755 \
  "$CC_CONNECT_DIR"/dist/cc-connect-v1.3.2-dirty-linux-amd64 \
  "$OPENCODE_CC_DIR/cc-connect-v1.3.2-dirty-linux-amd64"

```

Verify the packaged files:

```bash
file "$OPENCODE_CC_DIR/cc-connect"
ls -lh "$OPENCODE_CC_DIR/cc-connect" "$OPENCODE_CC_DIR/config.toml"
```
