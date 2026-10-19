<#
.SYNOPSIS
  非公開ナレッジ（hobnova-private-knowledge）をローカルキャッシュへ読み取り専用で同期する。

.DESCRIPTION
  キャッシュは %LOCALAPPDATA%\hobnova-knowledge（Git管理外・OneDrive同期外）。

  同期ツール（非公開リポジトリの scripts/ の3ファイルとスキーマ）は、下の $ToolPin に書いた
  コミットから毎回取り出し、SHA-256 が一致したときだけ `python -I -B` で実行する。同期したデータの中の
  スクリプトは実行しない。ツールを更新するときは -ShowPin で新しい値を確認し、このファイルを
  更新するPRを作る（公開リポジトリのPRとしてレビューされる）。このファイルに未コミットの変更が
  あるときは実行しない。

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
  Commit = 'b275af01a6f779544533a405dab8f2d1f20c9667'
  Files  = [ordered]@{
    'scripts/kb_common.py'          = '699f2c53cb6f1d7da024bb7a557a52c3c3b34b56bf159d6f363971d2d35896b0'
    'scripts/sync-knowledge.py'     = '9bb71150462d646f3a261a2b3b62514c98e3e8252f70bffd3e21fff726b05a5d'
    'scripts/export-context.py'     = 'e8ef132150c139790d7b8d8c335a22349ee87de11a68630237958f432f0cba6c'
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
  if (Get-Command py -CommandType Application -ErrorAction SilentlyContinue) { $candidates += , @('py', '-3') }
  $p = Get-Command python -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
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

function Test-Under([string]$Path, [string]$Base) {
  if (-not $Base) { return $false }
  $b = [System.IO.Path]::GetFullPath($Base).TrimEnd('\') + '\'
  $p = [System.IO.Path]::GetFullPath($Path).TrimEnd('\') + '\'
  return $p.StartsWith($b, [System.StringComparison]::OrdinalIgnoreCase)
}

function Save-GitBlob([string]$Repo, [string]$Spec, [string]$Target) {
  # git の標準出力をバイト列のままファイルへ書く（cmd を経由せず、git はフルパスで起動する）
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $GitExe
  $psi.Arguments = "--git-dir=`"$Repo`" cat-file blob $Spec"
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $proc = [System.Diagnostics.Process]::Start($psi)
  $fs = [System.IO.File]::Create($Target)
  try { $proc.StandardOutput.BaseStream.CopyTo($fs) } finally { $fs.Close() }
  [void]$proc.StandardError.ReadToEnd()
  $proc.WaitForExit()
  return ($proc.ExitCode -eq 0)
}

function Export-Tool([string]$Repo, [string]$Commit, [string]$Dest) {
  foreach ($f in $ToolPin.Files.Keys) {
    $target = Join-Path $Dest ($f -replace '/', '\')
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
    if (-not (Save-GitBlob $Repo "$($Commit):$f" $target)) { return $false }
  }
  return $true
}

# 0. 前提の確認
$gitCmd = Get-Command git -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $gitCmd) { Fail 'git が見つかりません' 1 }
$GitExe = $gitCmd.Source
$py = Find-Python
if (-not $py) { Fail 'Python 3.10以上が見つかりません（Microsoft Store のスタブではなく本体が必要）' 1 }
if (-not (Get-Command gh -CommandType Application -ErrorAction SilentlyContinue)) { Fail 'GitHub CLI (gh) が見つかりません' 1 }

# このファイル（ピン）がコミット済みの内容と同じときだけ実行する（ローカルでピンを書き換えて実行させない）
& $GitExe -C $HobnovaRoot rev-parse --is-inside-work-tree *> $null
if ($LASTEXITCODE -ne 0) { Fail 'このスクリプトはHOBNOVAリポジトリの中から実行してください' 3 }
& $GitExe -C $HobnovaRoot diff --quiet HEAD -- scripts/knowledge-sync.ps1 *> $null
if ($LASTEXITCODE -ne 0) { Fail 'scripts/knowledge-sync.ps1 に未コミットの変更があります。ピンの変更はPRで行ってください' 3 }

# キャッシュ先の確認（何かを書き込む前に行う）
$CacheFull = [System.IO.Path]::GetFullPath($Cache)
foreach ($v in @('OneDrive', 'OneDriveConsumer', 'OneDriveCommercial')) {
  if (Test-Under $CacheFull ([Environment]::GetEnvironmentVariable($v))) { Fail "キャッシュ先 $CacheFull がOneDriveの同期対象です" 3 }
}
$probe = $CacheFull
while ($probe -and -not (Test-Path -LiteralPath $probe)) { $probe = Split-Path -Parent $probe }
if ($probe) {
  $inside = & $GitExe -C $probe rev-parse --is-inside-work-tree 2>$null
  if ($LASTEXITCODE -eq 0 -and "$inside".Trim() -eq 'true') { Fail "キャッシュ先 $CacheFull がGit作業ツリーの中にあります" 3 }
}
if ($Remote -match '://[^/\s]*@') { Fail 'リモートURLに認証情報を含めないでください（認証はGitHub CLIに任せる）' 3 }

& gh auth status *> $null
if ($LASTEXITCODE -ne 0) { Fail 'GitHub CLI が未認証です。gh auth login を実行してください' 2 }

New-Item -ItemType Directory -Force -Path $CacheFull | Out-Null
$repo = Join-Path $CacheFull 'repo.git'

# 1. ツールを取り出すためのbareクローン（同期スクリプト自身も同じものを使う）
if (-not (Test-Path (Join-Path $repo 'HEAD'))) {
  & $GitExe @GitAuth clone --bare --quiet $Remote $repo 2>$null
  if ($LASTEXITCODE -ne 0) {
    if (Test-Path $repo) { Remove-Item -Recurse -Force -LiteralPath $repo }
    Fail '非公開リポジトリのクローンに失敗しました（アクセス権とネットワークを確認）。既存のキャッシュは変更していません' 2
  }
}
& $GitExe @GitAuth --git-dir=$repo fetch --quiet origin '+refs/heads/main:refs/heads/main' 2>$null
$fetched = ($LASTEXITCODE -eq 0)

# -ShowPin: 指定コミットのツールのSHA-256を表示する（ピン更新PR用）
if ($ShowPin) {
  if (-not $fetched) { Fail '非公開リポジトリから取得できませんでした' 2 }
  & $GitExe --git-dir=$repo cat-file -e "$($ShowPin)^{commit}" 2>$null
  if ($LASTEXITCODE -ne 0) { Fail "コミット $ShowPin が見つかりません" 1 }
  $full = (& $GitExe --git-dir=$repo rev-parse "$($ShowPin)^{commit}").Trim()
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

# 2. ピン留めしたツールを毎回取り出し直し、ファイル一式とSHA-256を照合
& $GitExe --git-dir=$repo cat-file -e "$($ToolPin.Commit)^{commit}" 2>$null
if ($LASTEXITCODE -ne 0) {
  if (-not $fetched) { Fail '非公開リポジトリから取得できず、ピン留めしたツールも手元にありません。既存のキャッシュは変更していません' 2 }
  Fail "ピン留めしたコミット $($ToolPin.Commit) が非公開リポジトリにありません。履歴が書き換えられた可能性があるため中止しました" 3
}
$toolRoot = Join-Path $CacheFull 'tool'
if (Test-Path $toolRoot) { Remove-Item -Recurse -Force -LiteralPath $toolRoot }
$toolDir = Join-Path $toolRoot $ToolPin.Commit
if (-not (Export-Tool $repo $ToolPin.Commit $toolDir)) { Fail 'ツールの取り出しに失敗しました' 1 }
foreach ($f in $ToolPin.Files.Keys) {
  if ((Get-Sha256 (Join-Path $toolDir ($f -replace '/', '\'))) -ne $ToolPin.Files[$f]) {
    Remove-Item -Recurse -Force -LiteralPath $toolRoot
    Fail "ツール $f のSHA-256がピンと一致しません。改ざんの可能性があるため実行しません" 3
  }
}
if (@(Get-ChildItem -Recurse -Force -File -LiteralPath $toolDir).Count -ne $ToolPin.Files.Count) {
  Remove-Item -Recurse -Force -LiteralPath $toolRoot
  Fail 'ツールのディレクトリに想定外のファイルがあります' 3
}

# 3. 実行（-I: 環境変数やユーザーのsite-packagesを読まない / -B: バイトコードを書かない）
$pyExe = $py[0]; $pyPre = @($py | Select-Object -Skip 1)
$argsList = @('-I', '-B', (Join-Path $toolDir 'scripts\sync-knowledge.py'), '--cache', $CacheFull,
              '--remote', $Remote, '--schema', (Join-Path $toolDir 'schemas\knowledge.schema.json'))
if (-not $NoLeakCheck) { $argsList += @('--leak-check', $HobnovaRoot) }
if ($AcceptRewrite) { $argsList += @('--accept-rewrite', $AcceptRewrite) }

& $pyExe @pyPre @argsList
exit $LASTEXITCODE
