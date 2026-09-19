# ClassIntra 插件双仓同步脚本
# 背景：主仓（ClassIntra）.gitignore 忽略 plugins/，插件文件只进 market 仓。
# 本脚本把主仓 plugins/ 单向同步到 market 仓，并提供提交辅助。
#
# 用法：
#   .\scripts\sync-market.ps1                      # 同步 + 显示 market 变更
#   .\scripts\sync-market.ps1 -Commit "feat: xxx"  # 同步 + 自动提交 market
#   .\scripts\sync-market.ps1 -Health              # 附带主仓 git health（b→o 检查）
#
# 插件版本号约定：插件 manifest.json 的 version 独立语义化递增
#   （功能新增 MINOR +1，Bug 修复 PATCH +1，与主仓 server/version.json 无关）。

param(
  [string]$Commit = '',
  [switch]$Health
)

$ErrorActionPreference = 'Stop'

# 不同步的顶层条目：node_modules 体积大且 market 侧独立 npm install
$Exclude = @('node_modules')

$src = Join-Path $PSScriptRoot '..\plugins'
$marketRepo = 'D:\NetWork\Integration\market'
$dst = Join-Path $marketRepo 'plugins'

if (-not (Test-Path $marketRepo)) { Write-Host "[错误] market 仓不存在：$marketRepo"; exit 1 }
if (-not (Test-Path $src)) { Write-Host "[错误] 主仓 plugins 目录不存在：$src"; exit 1 }

# 逐个顶层条目同步
# 注意：复制「已存在目录」时必须用 -Path src\* 而不是 -Path src，
# 否则 Copy-Item 会把 src 嵌套成 dst\src（历史踩坑）。
Get-ChildItem $src | Where-Object { $Exclude -notcontains $_.Name } | ForEach-Object {
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

Write-Host ''
Write-Host '== market 仓变更 =='
git -C $marketRepo status --short

if ($Commit) {
  git -C $marketRepo add plugins/
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
