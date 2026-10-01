# ClassIntra 插件双仓同步脚本
# 背景：主仓（ClassIntra）.gitignore 忽略 plugins/ 与 market-apps/，插件与市场应用文件只进 market 仓。
# 本脚本把主仓 plugins/ 单向同步到 market 仓，并可附带同步 market-apps/ 指定应用到 market 仓 apps/。
#
# 用法：
#   .\scripts\sync-market.ps1                      # 同步插件 + 显示 market 变更
#   .\scripts\sync-market.ps1 -Commit "feat: xxx"  # 同步 + 自动提交 market
#   .\scripts\sync-market.ps1 -Health              # 附带主仓 git health（b→o 检查）
#   .\scripts\sync-market.ps1 -App gomoku          # 额外同步 market-apps/gomoku → market/apps/gomoku
#
# 插件版本号约定：插件 manifest.json 的 version 独立语义化递增
#   （功能新增 MINOR +1，Bug 修复 PATCH +1，与主仓 server/version.json 无关）。

param(
  [string]$Commit = '',
  [switch]$Health,
  [string]$App = ''
)

$ErrorActionPreference = 'Stop'

# 不同步的顶层条目：node_modules 体积大且 market 侧独立 npm install
$Exclude = @('node_modules')

# 不同步的顶层「文件」：下划线前缀的一次性探针/临时脚本（如 _relay_info_probe.js、
# _relay_manage_probe.out.json）。这些文件放 plugins/ 下只为借用其 node_modules，
# 属本地调试产物，不应进 market 仓。
# 注意：只排除文件、不排除目录——plugins/_sdk 是正式包，必须继续同步。
$ExcludeFilePrefix = '_'

$src = Join-Path $PSScriptRoot '..\plugins'
$marketRepo = 'D:\NetWork\Integration\market'
$dst = Join-Path $marketRepo 'plugins'

if (-not (Test-Path $marketRepo)) { Write-Host "[错误] market 仓不存在：$marketRepo"; exit 1 }
if (-not (Test-Path $src)) { Write-Host "[错误] 主仓 plugins 目录不存在：$src"; exit 1 }

# 逐个顶层条目同步
# 注意：复制「已存在目录」时必须用 -Path src\* 而不是 -Path src，
# 否则 Copy-Item 会把 src 嵌套成 dst\src（历史踩坑）。
Get-ChildItem $src | Where-Object {
  $Exclude -notcontains $_.Name -and
  ($_.PSIsContainer -or -not $_.Name.StartsWith($ExcludeFilePrefix))
} | ForEach-Object {
  $name = $_.Name
  $target = Join-Path $dst $name
  if ($_.PSIsContainer) {
    if (Test-Path $target) {
      Copy-Item -Path (Join-Path $_.FullName '*') -Destination $target -Recurse -Force
    } else {
      Copy-Item -Path $_.FullName -Destination $dst -Recurse -Force
    }
  } else {
    Copy-Item -Path $_.FullName -Destination $dst -Force
  }
  Write-Host "[同步] $name"
}

# 可选：同步市场应用 market-apps/<App> → market 仓 apps/<App>
# 用 robocopy /MIR 镜像（含删除多余文件，防双仓漂移），排除 node_modules/.git。
# /XF 排除引擎二进制（*.exe / *.nnue，约 57MB 的第三方 GPL 产物）：它们既不进公开仓、
# 也不该被 /MIR 的 purge 删掉——robocopy 的 /XF /XD 排除项同样受保护，不会被清理。
# robocopy 退出码 0-7 均为成功（1=有复制，0=无差异），>=8 才是失败。
if ($App) {
  $appSrc = Join-Path $PSScriptRoot ("..\market-apps\" + $App)
  $appDst = Join-Path $marketRepo ("apps\" + $App)
  if (-not (Test-Path $appSrc)) { Write-Host "[错误] 市场应用不存在：$appSrc"; exit 1 }
  Write-Host ''
  Write-Host "== 同步市场应用 $App =="
  robocopy $appSrc $appDst /MIR /XD node_modules .git /XF *.exe *.nnue /NJH /NJS /NDL | Out-Host
  if ($LASTEXITCODE -ge 8) { Write-Host "[错误] robocopy 同步失败（退出码 $LASTEXITCODE）"; exit 1 }
  $global:LASTEXITCODE = 0
  Write-Host "[同步] apps/$App"
}

Write-Host ''
Write-Host '== market 仓变更 =='
git -C $marketRepo status --short

if ($Commit) {
  git -C $marketRepo add plugins/
  if (Test-Path (Join-Path $marketRepo 'apps')) { git -C $marketRepo add apps/ }
  # index.json 的 version 字段是「三处版本一致」红线的一处，漏 add 会让提交缺版本号
  # （1.10.1 实测：只 add apps/ 时 index.json 留在工作区，提交不完整）
  if (Test-Path (Join-Path $marketRepo 'index.json')) { git -C $marketRepo add index.json }
  git -C $marketRepo commit -m $Commit
  Write-Host ''
  Write-Host '== 已提交 =='
  git -C $marketRepo log --oneline -1
} else {
  Write-Host ''
  Write-Host '（未提交。可用 -Commit "提交信息" 自动提交）'
}

if ($Health) {
  Write-Host ''
  Write-Host '== 主仓 git health（b→o 检查）=='
  git health
}
