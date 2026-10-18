<#
.SYNOPSIS
  非公開ナレッジ（hobnova-private-knowledge）をローカルキャッシュへ読み取り専用で同期する。

.DESCRIPTION
  キャッシュは %LOCALAPPDATA%\hobnova-knowledge（Git管理外・OneDrive同期外）。
  同期処理の本体は非公開リポジトリ側の scripts/sync-knowledge.py で、
  2回目以降は「前回検証を通ったキャッシュ内のスクリプト」を実行する（リモートで書き換えられた
  スクリプトをそのまま実行しないため）。初回だけ一時クローンのスクリプトを使う。

  詳細: docs/private-knowledge.md

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/knowledge-sync.ps1
  powershell -ExecutionPolicy Bypass -File scripts/knowledge-sync.ps1 -AllowScriptUpdate
#>
param(
  [string]$Cache = $(if ($env:HOBNOVA_KNOWLEDGE_CACHE) { $env:HOBNOVA_KNOWLEDGE_CACHE } else { Join-Path $env:LOCALAPPDATA 'hobnova-knowledge' }),
  [switch]$AllowScriptUpdate,
  [switch]$AcceptRewrite,
  [switch]$NoLeakCheck
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$env:PYTHONIOENCODING = 'utf-8'
# キャッシュ内のスクリプト実行時に __pycache__ を作らない（手元の改変と誤検知されるため）
$env:PYTHONDONTWRITEBYTECODE = '1'

$Repo = 'hitoshi260828-dev/hobnova-private-knowledge'
$HobnovaRoot = Split-Path -Parent $PSScriptRoot

function Fail([string]$Message, [int]$Code) {
  Write-Host "同期できませんでした: $Message"
  exit $Code
}

$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) { $python = Get-Command py -ErrorAction SilentlyContinue }
if (-not $python) { Fail 'Python が見つかりません（3.10以上が必要）' 1 }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail 'GitHub CLI (gh) が見つかりません' 1 }

& gh auth status *> $null
if ($LASTEXITCODE -ne 0) { Fail 'GitHub CLI が未認証です。gh auth login を実行してください' 2 }

$trusted = Join-Path $Cache 'current\scripts\sync-knowledge.py'
$bootstrap = $null
if (Test-Path $trusted) {
  $script = $trusted
} else {
  # 初回: 一時ディレクトリへ浅くクローンし、そのスクリプトでキャッシュを作る
  $bootstrap = Join-Path ([System.IO.Path]::GetTempPath()) ("hobnova-knowledge-bootstrap-" + [guid]::NewGuid().ToString('N'))
  & gh repo clone $Repo $bootstrap -- --depth 1 --quiet *> $null
  if ($LASTEXITCODE -ne 0) {
    if (Test-Path $bootstrap) { Remove-Item -Recurse -Force $bootstrap }
    Fail "初回のクローンに失敗しました（$Repo へのアクセス権とネットワークを確認）" 2
  }
  $script = Join-Path $bootstrap 'scripts\sync-knowledge.py'
}

$argsList = @($script, '--cache', $Cache)
if (-not $NoLeakCheck) { $argsList += @('--leak-check', $HobnovaRoot) }
if ($AllowScriptUpdate) { $argsList += '--allow-script-update' }
if ($AcceptRewrite) { $argsList += '--accept-rewrite' }

try {
  & $python.Source @argsList
  $code = $LASTEXITCODE
} finally {
  if ($bootstrap -and (Test-Path $bootstrap)) { Remove-Item -Recurse -Force $bootstrap }
}
exit $code
