#!/bin/bash
# MeshCentral 重启脚本
# 通过 systemd 管理 MeshCentral 服务的重启

echo "=== MeshCentral 重启 ==="

# 检查服务状态
echo "[1/3] 检查当前状态..."
STATUS=$(systemctl is-active meshcentral)
echo "当前状态: $STATUS"

# 重启服务
echo "[2/3] 正在重启 meshcentral 服务..."
systemctl restart meshcentral

# 验证重启成功
sleep 2
NEW_STATUS=$(systemctl is-active meshcentral)
echo "[3/3] 重启后状态: $NEW_STATUS"

if [ "$NEW_STATUS" = "active" ]; then
    echo "✓ MeshCentral 重启成功"
else
    echo "✗ MeshCentral 重启失败，请检查: journalctl -u meshcentral -n 50"
    exit 1
fi
