<#
.SYNOPSIS
  非公開ナレッジ（hobnova-private-knowledge）をローカルキャッシュへ読み取り専用で同期する。

.DESCRIPTION
  キャッシュは %LOCALAPPDATA%\hobnova-knowledge（Git管理外・OneDrive同期外）。

  同期ツール（非公開リポジトリの scripts/ の3ファイルとスキーマ）は、下の $ToolPin に書いた
  コミットから取り出し、SHA-256 が一致したときだけ `python -I -B` で実行する。同期したデータの中の
  スクリプトは実行しない。ツールを更新するときは -ShowPin で新しい値を確認し、このファイルを
  更新するPRを作る（公開リポジトリのPRとしてレビューされる）。

  詳細: docs/private-knowledge.md

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/knowledge-sync.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/knowledge-sync.ps1 -AcceptRewrite 0123456789ab
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/knowledge-sync.ps1 -ShowPin <コミットSHA>
#>
param(
  [string]$Cache = $(if ($env:HOBNOVA_KNOWLEDGE_CACHE) { $env:HOBNOVA_KNOWLEDGE_CACHE } else { Join-Path $env:LOCALAPPDATA 'hobnova-knowledge' }),
  [string]$AcceptRewrite,
  [switch]$NoLeakCheck,
  [string]$ShowPin
)

# ネイティブコマンドの標準エラー出力で止まらないよう Continue にし、終了コードで判定する
$ErrorActionPreference = 'Continue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# 非公開リポジトリのツールのピン。更新は -ShowPin の出力を貼り付けるPRで行う。
$ToolPin = @{
  Commit = '3e2e320de53e7400037782e4d025d56e033c1b97'
  Files  = [ordered]@{
    'scripts/kb_common.py'          = 'a51996d7e454da64eb091527ba5b7cddaece2c0a951aa03fc44bde50e4277a75'
    'scripts/sync-knowledge.py'     = 'f1e705175386baee6541b9b61c66c7088b8f96d5e2abf06d1ec0c162469d8711'
    'scripts/export-context.py'     = '4d0f3ede1ab5a58f83269808597035ceeca373d43df2e26517adc40223b70d46'
    'schemas/knowledge.schema.json' = '1de4ed5cab2013033bfbe05533f269077cd8f7f997587f0e6872e7251a980f84'
  }
}

$Remote = if ($env:HOBNOVA_KNOWLEDGE_REMOTE) { $env:HOBNOVA_KNOWLEDGE_REMOTE } else { 'https://github.com/hitoshi260828-dev/hobnova-private-knowledge.git' }
$HobnovaRoot = Split-Path -Parent $PSScriptRoot
$GitAuth = @('-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential', '-c', 'core.autocrlf=false')
$env:GIT_TERMINAL_PROMPT = '0'

function Fail([string]$Message, [int]$Code) {
  [Console]::Error.WriteLine("同期できませんでした: $Message")
  exit $Code
}

function Find-Python {
  $candidates = @()
  if (Get-Command py -ErrorAction SilentlyContinue) { $candidates += , @('py', '-3') }
  $p = Get-Command python -ErrorAction SilentlyContinue
  if ($p -and $p.Source -notmatch 'WindowsApps') { $candidates += , @($p.Source) }
  foreach ($c in $candidates) {
    $exe = $c[0]; $pre = @($c | Select-Object -Skip 1)
    $out = & $exe @pre -c "import sys; print(int(sys.version_info >= (3, 10)))" 2>$null
    if ($LASTEXITCODE -eq 0 -and "$out".Trim() -eq '1') { return , $c }
  }
  return $null
}

function Get-Sha256([string]$Path) {
  return (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Export-Tool([string]$Repo, [string]$Commit, [string]$Dest) {
  # 指定コミットのファイルを、改行コード等を変換せずに書き出す（cmd のリダイレクトはバイト列のまま）
  foreach ($f in $ToolPin.Files.Keys) {
    $target = Join-Path $Dest ($f -replace '/', '\')
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    cmd /c "git --git-dir=`"$Repo`" cat-file blob $($Commit):$f > `"$target`" 2>nul"
    if ($LASTEXITCODE -ne 0) { return $false }
  }
  return $true
}

$py = Find-Python
if (-not $py) { Fail 'Python 3.10以上が見つかりません（Microsoft Store のスタブではなく本体が必要）' 1 }
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) { Fail 'GitHub CLI (gh) が見つかりません' 1 }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Fail 'git が見つかりません' 1 }
& gh auth status *> $null
if ($LASTEXITCODE -ne 0) { Fail 'GitHub CLI が未認証です。gh auth login を実行してください' 2 }

New-Item -ItemType Directory -Force -Path $Cache | Out-Null
$repo = Join-Path $Cache 'repo.git'

# 1. ツールを取り出すためのbareクローン（同期スクリプト自身も同じものを使う）
if (-not (Test-Path (Join-Path $repo 'HEAD'))) {
  & git @GitAuth clone --bare --quiet $Remote $repo 2>$null
  if ($LASTEXITCODE -ne 0) {
    if (Test-Path $repo) { Remove-Item -Recurse -Force -LiteralPath $repo }
    Fail '非公開リポジトリのクローンに失敗しました（アクセス権とネットワークを確認）。既存のキャッシュは変更していません' 2
  }
}
& git @GitAuth --git-dir=$repo fetch --quiet origin '+refs/heads/main:refs/heads/main' 2>$null
$fetched = ($LASTEXITCODE -eq 0)

# -ShowPin: 指定コミットのツールのSHA-256を表示する（ピン更新PR用）
if ($ShowPin) {
  if (-not $fetched) { Fail '非公開リポジトリから取得できませんでした' 2 }
  & git --git-dir=$repo cat-file -e "$($ShowPin)^{commit}" 2>$null
  if ($LASTEXITCODE -ne 0) { Fail "コミット $ShowPin が見つかりません" 1 }
  $full = (& git --git-dir=$repo rev-parse "$($ShowPin)^{commit}").Trim()
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('hobnova-pin-' + [guid]::NewGuid().ToString('N'))
  try {
    if (-not (Export-Tool $repo $full $tmp)) { Fail 'ツールの取り出しに失敗しました' 1 }
    Write-Host "  Commit = '$full'"
    foreach ($f in $ToolPin.Files.Keys) {
      Write-Host ("    '{0}' = '{1}'" -f $f, (Get-Sha256 (Join-Path $tmp ($f -replace '/', '\'))))
    }
    Write-Host 'この値で $ToolPin を更新するPRを作り、差分（非公開リポジトリ側の変更内容）を確認してからmergeしてください。'
  } finally {
    if (Test-Path $tmp) { Remove-Item -Recurse -Force -LiteralPath $tmp }
  }
  exit 0
}

# 2. ピン留めしたツールを取り出して照合
$toolDir = Join-Path $Cache ('tool\' + $ToolPin.Commit)
$verified = $true
foreach ($f in $ToolPin.Files.Keys) {
  $p = Join-Path $toolDir ($f -replace '/', '\')
  if (-not (Test-Path -LiteralPath $p) -or (Get-Sha256 $p) -ne $ToolPin.Files[$f]) { $verified = $false; break }
}
if (-not $verified) {
  & git --git-dir=$repo cat-file -e "$($ToolPin.Commit)^{commit}" 2>$null
  if ($LASTEXITCODE -ne 0) {
    if (-not $fetched) { Fail '非公開リポジトリから取得できず、ピン留めしたツールも手元にありません。既存のキャッシュは変更していません' 2 }
    Fail "ピン留めしたコミット $($ToolPin.Commit) が非公開リポジトリにありません。履歴が書き換えられた可能性があるため中止しました" 3
  }
  if (Test-Path $toolDir) { Remove-Item -Recurse -Force -LiteralPath $toolDir }
  if (-not (Export-Tool $repo $ToolPin.Commit $toolDir)) { Fail 'ツールの取り出しに失敗しました' 1 }
  foreach ($f in $ToolPin.Files.Keys) {
    $actual = Get-Sha256 (Join-Path $toolDir ($f -replace '/', '\'))
    if ($actual -ne $ToolPin.Files[$f]) {
      Remove-Item -Recurse -Force -LiteralPath $toolDir
      Fail "ツール $f のSHA-256がピンと一致しません。改ざんの可能性があるため実行しません" 3
    }
  }
}
# 古いピンのツールを片付ける
Get-ChildItem -Directory -Path (Join-Path $Cache 'tool') -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -ne $ToolPin.Commit } |
  ForEach-Object { Remove-Item -Recurse -Force -LiteralPath $_.FullName }

# 3. 実行（-I: 環境変数やユーザーのsite-packagesを読まない / -B: バイトコードを書かない）
$pyExe = $py[0]; $pyPre = @($py | Select-Object -Skip 1)
$argsList = @('-I', '-B', (Join-Path $toolDir 'scripts\sync-knowledge.py'), '--cache', $Cache,
              '--remote', $Remote, '--schema', (Join-Path $toolDir 'schemas\knowledge.schema.json'))
if (-not $NoLeakCheck) { $argsList += @('--leak-check', $HobnovaRoot) }
if ($AcceptRewrite) { $argsList += @('--accept-rewrite', $AcceptRewrite) }

& $pyExe @pyPre @argsList
exit $LASTEXITCODE
