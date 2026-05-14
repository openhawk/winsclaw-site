# MeshCentral Let's Encrypt 证书配置手册

本文档记录了为 winsclaw.com 和 www.winsclaw.com 配置 Let's Encrypt 免费证书的修复步骤。

## 1. 核心要求
*   **80 端口必须开放**：Let's Encrypt 的 HTTP-01 验证必须通过 80 端口。
*   **域名解析**：域名必须正确指向服务器 IP。

## 2. 关键配置步骤

### A. 修正 config.json 结构
letsencrypt 配置块必须位于 JSON 的**根层级**，而不是在 settings 内部。

正确结构示例：
\\\json
{
  " settings\: {
 \cert\: \www.winsclaw.com,winsclaw.com\,
 \port\: 443,
 \redirPort\: 80
 },
 \letsencrypt\: {
 \email\: \ultralyndon@gmail.com\,
 \names\: \www.winsclaw.com,winsclaw.com\,
 \production\: true
 }
}
\\\

### B. 安装必要模块
MeshCentral 申请证书依赖 \cme-client\。如果缺失，需手动安装：
\\\ash
cd /opt/meshcentral/MeshCentral
npm install acme-client@4.2.5
\\\

### C. 证书强制更新
如果需要更换域名或强制重发证书，可以删除旧证书缓存并重启服务：
\\\ash
rm -rf /opt/meshcentral/MeshCentral/letsencrypt-certs/
systemctl restart meshcentral
\\\

## 3. 常见问题排查
* **证书不安全（域名不匹配）**：检查 \config.json\ 中的 \
ames\ 是否包含了你访问的所有域名（根域名和 www 子域名）。
* **登录后加载失败**：通常是浏览器缓存了旧证书的 WebSocket 连接。尝试清理浏览器缓存或使用无痕模式。
* **80 端口占用**：确保没有其他 Web 服务器（如 Nginx/Apache）占用 80 端口，MeshCentral 需要直接监听 80 端口进行验证。

---
*最后更新日期: 2026年5月14日*

## 4. 技术实现原理 (How it works)

MeshCentral 采用集成式证书管理，而非依赖系统级 \certbot\ 工具。

### A. 软件架构
*   **核心引擎**：\cme-client\ (Node.js 模块)。负责与 Let's Encrypt 服务器进行 ACME 协议通信。
*   **集成逻辑**：位于 \letsencrypt.js\。MeshCentral 启动时若检测到配置，会调用此脚本。
*   **验证方式**：**HTTP-01 挑战**。MeshCentral 会在 80 端口自动响应验证请求，无需外部 Web 服务器（如 Nginx）配合。

### B. 文件存储
证书不存储在系统标准路径，而是托管在应用目录下：
*   **私钥**：\/opt/meshcentral/MeshCentral/letsencrypt-certs/production.key\
*   **证书链**：\/opt/meshcentral/MeshCentral/letsencrypt-certs/production.crt\

### C. 自动化续期
*   **无需手动续期**：只要 MeshCentral 服务保持运行且 80 端口对公网开放，程序会在证书到期前（通常是剩余 30 天时）自动完成续期流程。
*   **无需定时任务**：不需要配置 \crontab\，所有逻辑由 MeshCentral 内部定时器触发。
