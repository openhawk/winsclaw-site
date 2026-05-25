param(
    [string]$Message
)

$ErrorActionPreference = "Stop"

$SitePath = "D:\winsclaw-work\site"
$Branch = "master"
$Remote = "origin"
$Server = "aliyun"
$RemotePath = "/opt/meshcentral/MeshCentral"

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [scriptblock]$Command
    )

    Write-Host ""
    Write-Host "==> $Name"

    try {
        & $Command
        if ($LASTEXITCODE -ne 0) {
            throw "Command exited with code $LASTEXITCODE"
        }
    }
    catch {
        Write-Error "Step failed: $Name. $($_.Exception.Message)"
        exit 1
    }
}

function Get-GitStatusShort {
    git -C $SitePath status --short
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to read git status."
    }
}

if (-not (Test-Path -LiteralPath $SitePath)) {
    Write-Error "Site path not found: $SitePath"
    exit 1
}

if ([string]::IsNullOrWhiteSpace($Message)) {
    $Message = "deploy site $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
}

Write-Host "Deploying site to $Server"
Write-Host "Local path: $SitePath"
Write-Host "Remote path: ${Server}:$RemotePath"
Write-Host "Branch: $Branch"
Write-Host "Commit message: $Message"

$Status = @(Get-GitStatusShort)
if ($Status.Count -gt 0) {
    Write-Host ""
    Write-Host "Detected local changes:"
    $Status | ForEach-Object { Write-Host $_ }

    Invoke-Step "Stage local changes" {
        git -C $SitePath add -A
    }

    Invoke-Step "Commit local changes" {
        git -C $SitePath commit -m $Message
    }
}
else {
    Write-Host ""
    Write-Host "No local changes to commit."
}

Invoke-Step "Fetch latest refs" {
    git -C $SitePath fetch $Remote
}

Invoke-Step "Rebase local $Branch onto $Remote/$Branch" {
    git -C $SitePath pull --rebase $Remote $Branch
}

Invoke-Step "Push $Branch to $Remote" {
    git -C $SitePath push $Remote $Branch
}

$RemoteCommand = "cd $RemotePath && git pull && systemctl restart meshcentral && systemctl status meshcentral --no-pager"
Invoke-Step "Deploy on $Server" {
    ssh $Server $RemoteCommand
}

Write-Host ""
Write-Host "Deploy completed successfully."
