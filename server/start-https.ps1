# ClassIntra HTTPS 服务启动脚本

# 检查证书是否存在
$certsDir = "certs"
if (-not (Test-Path $certsDir)) {
    Write-Host "错误: 证书目录不存在" -ForegroundColor Red
    Write-Host "请先运行 scripts/generate-certs.ps1 生成证书" -ForegroundColor Yellow
    exit 1
}

$certFiles = Get-ChildItem $certsDir -Filter "*.pem"
if ($certFiles.Count -lt 2) {
    Write-Host "错误: 未找到证书文件" -ForegroundColor Red
    Write-Host "请先运行 scripts/generate-certs.ps1 生成证书" -ForegroundColor Yellow
    exit 1
}

Write-Host "ClassIntra HTTPS 服务启动" -ForegroundColor Green
Write-Host "证书目录: $certsDir" -ForegroundColor Cyan
Write-Host ""

# 设置环境变量
$env:HTTPS_ENABLED = "true"
$env:HTTPS_PORT = "9001"

# 启动服务
Set-Location src
node app-https.js

Set-Location ..