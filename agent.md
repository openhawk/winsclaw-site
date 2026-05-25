# Agent Notes

## 项目结构

当前工作区中的 `site` 目录是需要修改和发布的 MeshCentral 工程。

## 发布环境

发布环境服务器名称为 `aliyun`。

服务器上的发布工程目录为：

```text
/opt/meshcentral/MeshCentral
```

发布后的网站域名为：

```text
https://www.winsclaw.com/
```

## 发布方式

每次修改 `site` 目录下的文件后，都必须发布到 `aliyun` 服务器。

使用工作区根目录的一键发布脚本：

```powershell
.\deploy-site.ps1
```

也可以指定提交信息：

```powershell
.\deploy-site.ps1 -Message "update site"
```

脚本会自动完成以下操作：

1. 在本地 `site` 仓库执行 `git fetch origin`。
2. 执行 `git pull --rebase origin master` 同步远端提交。
3. 如果有未提交改动，自动 `git add -A` 并提交。
4. 推送到 `origin/master`。
5. SSH 登录 `aliyun`。
6. 在 `/opt/meshcentral/MeshCentral` 执行 `git pull`。
7. 重启并检查 `meshcentral` 服务。

## 注意事项

- 服务器名是 `aliyun`，不是泛称“阿里云服务器”。
- 远端发布方式是 `git pull`，所以本地必须先 push；一键发布脚本会自动处理。
- 发布完成后，通过 `https://www.winsclaw.com/` 验证网站。
