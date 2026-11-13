#!/usr/bin/env bash
#
# 灵感仓 INSIGHT VAULT · 一键安装
#
# 用法（在有 Docker 的机器上）：
#   curl -fsSL https://raw.githubusercontent.com/<owner>/insight-vault/main/scripts/install.sh | bash
#
# 或者本地跑：
#   bash scripts/install.sh
#
# 它做四件事：检查 Docker → 建目录 → 写 compose 与 .env → 起容器。
# 不需要我们提供服务器：所有东西都跑在你这台机器上。

set -euo pipefail

APP_NAME="灵感仓 INSIGHT VAULT"
INSTALL_DIR="${IV_DIR:-$HOME/insight-vault}"
IMAGE="${IV_IMAGE:-ghcr.io/your-name/insight-vault:latest}"
PORT="${IV_PORT:-3000}"
REPO_RAW="${IV_REPO_RAW:-https://raw.githubusercontent.com/your-name/insight-vault/main}"

info() { printf "\033[36m[灵感仓]\033[0m %s\n" "$1"; }
warn() { printf "\033[33m[提醒]\033[0m %s\n" "$1"; }
die()  { printf "\033[31m[失败]\033[0m %s\n" "$1" >&2; exit 1; }

# ---------- 1. 检查 Docker ----------
info "检查 Docker…"
command -v docker >/dev/null 2>&1 || die "没有找到 docker，请先安装 Docker：https://docs.docker.com/get-docker/"
docker info >/dev/null 2>&1 || die "Docker 已安装但守护进程没在跑（试试启动 Docker Desktop / systemctl start docker）"

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  die "没有找到 docker compose 插件，请升级 Docker"
fi
info "Docker 就绪（$COMPOSE）"

# ---------- 2. 准备目录 ----------
mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"
info "安装目录：$INSTALL_DIR"

# ---------- 3. 写 .env（只在不存在时生成） ----------
if [ -f .env ]; then
  info ".env 已存在，保留"
else
  SECRET="$(head -c 48 /dev/urandom | base64 | tr -d '\n')"
  cat > .env <<EOF
# 由 install.sh 生成于 $(date -u +"%Y-%m-%dT%H:%M:%SZ")
IV_IMAGE=$IMAGE
IV_PORT=$PORT
NEXTAUTH_SECRET=$SECRET
NEXTAUTH_URL=http://localhost:$PORT
EOF
  info "已生成 .env（含随机 NEXTAUTH_SECRET）"
fi

# ---------- 4. 写 compose ----------
if [ -f docker-compose.yml ]; then
  info "docker-compose.yml 已存在，保留"
else
  # 优先从仓库拉，拉不到就用内置的等价内容
  if ! curl -fsSL "$REPO_RAW/docker/docker-compose.yml" -o docker-compose.yml 2>/dev/null; then
    warn "拉取 compose 失败，使用内置版本"
    cat > docker-compose.yml <<'YAML'
services:
  web:
    image: ${IV_IMAGE}
    restart: unless-stopped
    ports:
      - "${IV_PORT:-3000}:3000"
    volumes:
      - data:/data
    environment:
      DATA_DIR: /data
    env_file:
      - .env

volumes:
  data:
YAML
  fi
  info "已就绪 docker-compose.yml"
fi

# ---------- 5. 起服务 ----------
info "拉取镜像并启动（首次会下载几百 MB）…"
$COMPOSE pull
$COMPOSE up -d

# ---------- 6. 等就绪 ----------
info "等待服务就绪…"
for i in $(seq 1 60); do
  if curl -fsS "http://localhost:$PORT/api/health" >/dev/null 2>&1; then
    echo
    info "启动成功"
    echo "  地址    http://localhost:$PORT"
    echo "  数据    $INSTALL_DIR（docker volume: data）"
    echo "  停止    cd $INSTALL_DIR && $COMPOSE down"
    echo
    echo "  第一步：打开页面注册账号（首个账号自动是管理员）"
    echo "  第二步：去「设置 → AI」填你自己的模型（Base URL / API Key / 模型名）"
    exit 0
  fi
  sleep 2
done

die "服务在 120 秒内没有就绪，执行 cd $INSTALL_DIR && $COMPOSE logs web 查看原因"
