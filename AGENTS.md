# Agent Notes

## Project Scope

This directory is the MeshCentral website/server project that is modified and deployed.

## Deployment Environment

The deployment server name is `aliyun`.

The deployment directory on the server is:

```text
/opt/meshcentral/MeshCentral
```

The production website is:

```text
https://www.winsclaw.com/
```

## Deployment Method

After modifying files under the `site` directory, deploy to the `aliyun` server.

Use the one-click deployment script from the workspace root:

```powershell
Set-Location D:\winsclaw-work
.\deploy-site.ps1
```

You can specify a commit message:

```powershell
Set-Location D:\winsclaw-work
.\deploy-site.ps1 -Message "update site"
```

The script performs these steps:

1. Runs `git fetch origin` in the local `site` repository.
2. Runs `git pull --rebase origin master`.
3. If there are uncommitted changes, runs `git add -A` and commits them.
4. Pushes to `origin/master`.
5. SSHes to `aliyun`.
6. Runs `git pull` in `/opt/meshcentral/MeshCentral`.
7. Restarts and checks the `meshcentral` service.

## Important Notes

- The server name is exactly `aliyun`, not a generic "Aliyun server" label.
- The remote deployment uses `git pull`, so local changes must be pushed first. The deployment script handles this.
- After deployment, verify the website at `https://www.winsclaw.com/`.

## MeshCentral Node Commands

When executing a command on a Windows node, SSH to `aliyun` first, then run `meshctrl.js runcommand` from the MeshCentral project directory.

For Windows nodes, prefer `--powershell --reply` so the command runs through the Agent PowerShell channel and returns output.

Use base64 wrapping for remote shell scripts when commands contain nested PowerShell, bash, and MeshCentral quoting:

```powershell
$remote=@'
cd /opt/meshcentral/MeshCentral || exit 1
NODEID='node//替换为目标节点ID'
CMD='Write-Host "hello from $env:COMPUTERNAME"; whoami'
node meshctrl.js runcommand `
  --url wss://www.winsclaw.com `
  --loginuser <MeshCentral用户名> `
  --loginpass '<MeshCentral密码>' `
  --id "$NODEID" `
  --powershell `
  --reply `
  --run "$CMD"
'@
$b64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($remote))
ssh aliyun "echo $b64 | base64 -d > /tmp/mesh-run.ps1.sh && timeout 120 bash /tmp/mesh-run.ps1.sh"
```

Common checks:

```powershell
# List nodes and confirm nodeid/online status.
ssh aliyun "cd /opt/meshcentral/MeshCentral && node meshctrl.js listdevices --url wss://www.winsclaw.com --loginuser <MeshCentral用户名> --loginpass '<MeshCentral密码>'"

# Confirm PowerShell channel identity on a node.
$CMD='Write-Host "USER=$(whoami)"; Write-Host "COMPUTER=$env:COMPUTERNAME"; $PSVersionTable.PSVersion'
```

Notes:

- Node IDs need the full prefix, for example `node//...`.
- Node IDs may contain `$`; single quotes are safest.
- Put complex Windows-node commands in `$CMD` and use `--powershell --reply`.
- To sync a single file to a node, prefer `meshctrl.js upload` over embedding large base64 blobs in a command.
