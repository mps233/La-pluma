#!/bin/sh
set -e

echo "=== La Pluma Go 启动脚本 ==="
if ! maa version 2>/dev/null | grep -q "MaaCore"; then
    echo "MaaCore 未安装或损坏，开始安装..."
    if maa install --force; then
        echo "MaaCore 安装成功"
    else
        echo "MaaCore 安装失败，服务仍会启动，可稍后在 WebUI 中更新"
    fi
else
    maa version
fi

echo "=== 启动 Go 服务器 ==="
exec "$@"
