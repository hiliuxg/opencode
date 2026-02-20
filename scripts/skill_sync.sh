#!/bin/bash
set -e

MODE="$1"

# ── Upload ────────────────────────────────────────────
# Usage: skill_sync.sh upload <admin_url> <skill_dir> <user_id> <catalog>
#
# skill_dir: 整个 skill 目录路径 (如 /path/.opencode/skills/my-skill)
# 自动从 SKILL.md 解析 name/description, 自动生成 version
upload() {
    local ADMIN_URL="$1"
    local SKILL_DIR="$2"
    local USER_ID="$3"
    local CATALOG="${4:-AIK}"

    if [ -z "$ADMIN_URL" ] || [ -z "$SKILL_DIR" ] || [ -z "$USER_ID" ]; then
        echo "ERROR: usage: skill_sync.sh upload <admin_url> <skill_dir> <user_id> [catalog]"
        exit 1
    fi

    # 查找 SKILL.md
    local SKILL_MD="$SKILL_DIR/SKILL.md"
    if [ ! -f "$SKILL_MD" ]; then
        echo "ERROR: SKILL.md not found at $SKILL_MD"
        exit 1
    fi

    # 解析 YAML frontmatter 中的 name 和 description
    # 支持 description: | 多行块标量语法
    local NAME=""
    local DESC=""
    local IN_FRONTMATTER=0
    local IN_MULTILINE=""  # 当前正在收集多行的字段名

    while IFS= read -r line; do
        if [ "$line" = "---" ]; then
            if [ "$IN_FRONTMATTER" -eq 0 ]; then
                IN_FRONTMATTER=1
                continue
            else
                break
            fi
        fi
        if [ "$IN_FRONTMATTER" -eq 1 ]; then
            # 如果正在收集多行值，检查是否为缩进的续行
            if [ -n "$IN_MULTILINE" ]; then
                # 空行 = 段落分隔，继续收集
                if [ -z "$line" ] || [ -z "$(echo "$line" | tr -d '[:space:]')" ]; then
                    continue
                fi
                # 以空格/tab开头 = 续行
                if echo "$line" | grep -q '^[[:space:]]'; then
                    local trimmed
                    trimmed=$(echo "$line" | sed 's/^[[:space:]]*//')
                    if [ -n "$trimmed" ]; then
                        if [ -n "$DESC" ]; then
                            DESC="$DESC $trimmed"
                        else
                            DESC="$trimmed"
                        fi
                    fi
                    continue
                else
                    # 非缩进行 = 多行结束
                    IN_MULTILINE=""
                fi
            fi

            local key
            local value
            key=$(echo "$line" | sed -n 's/^\([a-zA-Z_]*\):.*/\1/p')
            value=$(echo "$line" | sed -n 's/^[a-zA-Z_]*:[[:space:]]*//p' | sed 's/^["'"'"']\(.*\)["'"'"']$/\1/')

            case "$key" in
                name) NAME="$value" ;;
                description)
                    if [ "$value" = "|" ] || [ "$value" = ">" ]; then
                        # 多行块标量，开始收集后续缩进行
                        DESC=""
                        IN_MULTILINE="description"
                    else
                        DESC="$value"
                    fi
                    ;;
            esac
        fi
    done < "$SKILL_MD"

    if [ -z "$NAME" ]; then
        # fallback: 使用目录名
        NAME=$(basename "$SKILL_DIR")
    fi

    # 自动生成 version (YYYYMMDDHHmmss)
    local VERSION
    VERSION=$(date +%Y%m%d%H%M%S)

    # 打包
    local TMP_FILE="/tmp/skill_upload_$$.tar.gz"
    local PARENT_DIR
    PARENT_DIR=$(dirname "$SKILL_DIR")
    local DIR_NAME
    DIR_NAME=$(basename "$SKILL_DIR")

    echo "Packing $SKILL_DIR ..."
    tar -czf "$TMP_FILE" -C "$PARENT_DIR" "$DIR_NAME"

    # 上传
    echo "Uploading $NAME (v$VERSION) to $ADMIN_URL ..."
    local RESP_FILE="/tmp/skill_upload_resp_$$.json"
    local HTTP_CODE
    HTTP_CODE=$(curl -s -o "$RESP_FILE" -w "%{http_code}" \
        -X POST "$ADMIN_URL/api/skills" \
        -F "file=@$TMP_FILE" \
        -F "name=$NAME" \
        -F "catalog=$CATALOG" \
        -F "version=$VERSION" \
        -F "userId=$USER_ID" \
        -F "description=$DESC")

    # 清理临时文件
    rm -f "$TMP_FILE"

    echo "Response: $(cat "$RESP_FILE" 2>/dev/null)"
    rm -f "$RESP_FILE"

    if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
        echo "Upload success!"
    else
        echo "ERROR: Upload failed with HTTP $HTTP_CODE"
        exit 1
    fi
}

# ── Download ──────────────────────────────────────────
# Usage: skill_sync.sh download <download_url> <target_dir>
#
# download_url: 完整 URL，如 http://admin:8787/api/skills/123/download
# target_dir:   解压目标目录
download() {
    local DOWNLOAD_URL="$1"
    local TARGET_DIR="$2"

    if [ -z "$DOWNLOAD_URL" ] || [ -z "$TARGET_DIR" ]; then
        echo "ERROR: usage: skill_sync.sh download <download_url> <target_dir>"
        exit 1
    fi

    local TMP_FILE="/tmp/skill_download_$$.tar.gz"

    echo "Downloading from $DOWNLOAD_URL ..."
    curl -s -f -o "$TMP_FILE" "$DOWNLOAD_URL"

    echo "Extracting to $TARGET_DIR ..."
    mkdir -p "$TARGET_DIR"
    tar -xzf "$TMP_FILE" -C "$TARGET_DIR"

    # 清理
    rm -f "$TMP_FILE"

    echo "Download & install success!"
}

# ── Main ──────────────────────────────────────────────
case "$MODE" in
    upload)
        shift
        upload "$@"
        ;;
    download)
        shift
        download "$@"
        ;;
    *)
        echo "Usage: skill_sync.sh <upload|download> [args...]"
        exit 1
        ;;
esac
