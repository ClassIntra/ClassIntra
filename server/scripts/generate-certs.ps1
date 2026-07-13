# ClassIntra SSL 证书生成脚本
# 使用 mkcert 生成本地信任的 HTTPS 证书

param(
    [string]$LAN_IP = ""
)

# 检查 mkcert 是否安装
if (-not (Get-Command mkcert -ErrorAction SilentlyContinue)) {
    Write-Host "错误: mkcert 未安装" -ForegroundColor Red
    Write-Host ""
    Write-Host "请先安装 mkcert:" -ForegroundColor Yellow
    Write-Host "1. 下载: https://github.com/FiloSottile/mkcert/releases" -ForegroundColor Yellow
    Write-Host "2. 下载 mkcert-v1.4.4-windows-amd64.exe" -ForegroundColor Yellow
    Write-Host "3. 重命名为 mkcert.exe 并移动到 C:\Windows\" -ForegroundColor Yellow
    Write-Host "4. 运行: mkcert -install" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

# 创建证书目录
$certsDir = "..\certs"
if (-not (Test-Path $certsDir)) {
    New-Item -ItemType Directory -Path $certsDir | Out-Null
    Write-Host "创建证书目录: $certsDir" -ForegroundColor Green
}

# 获取局域网 IP
if ($LAN_IP -eq "") {
    Write-Host "正在检测局域网 IP..." -ForegroundColor Cyan
    $ips = Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
        $_.IPAddress -like "192.168.*" -or
        $_.IPAddress -like "10.*" -or
        $_.IPAddress -like "172.16.*" -or
        $_.IPAddress -like "172.17.*" -or
        $_.IPAddress -like "172.18.*" -or
        $_.IPAddress -like "172.19.*" -or
        $_.IPAddress -like "172.20.*" -or
        $_.IPAddress -like "172.21.*" -or
        $_.IPAddress -like "172.22.*" -or
        $_.IPAddress -like "172.23.*" -or
        $_.IPAddress -like "172.24.*" -or
        $_.IPAddress -like "172.25.*" -or
        $_.IPAddress -like "172.26.*" -or
        $_.IPAddress -like "172.27.*" -or
        $_.IPAddress -like "172.28.*" -or
        $_.IPAddress -like "172.29.*" -or
        $_.IPAddress -like "172.30.*" -or
        $_.IPAddress -like "172.31.*"
    }

    if ($ips) {
        Write-Host "检测到局域网 IP:" -ForegroundColor Green
        $ips | ForEach-Object { Write-Host "  $_.IPAddress" }

        # 选择第一个局域网 IP
        $LAN_IP = $ips[0].IPAddress
        Write-Host "使用 IP: $LAN_IP" -ForegroundColor Cyan
    } else {
        Write-Host "警告: 未检测到局域网 IP，仅生成 localhost 证书" -ForegroundColor Yellow
        $LAN_IP = ""
    }
}

# 生成证书参数
$certArgs = @("localhost", "127.0.0.1", "::1")
if ($LAN_IP -ne "") {
    $certArgs += $LAN_IP
}

Write-Host ""
Write-Host "生成证书参数: $($certArgs -join ', ')" -ForegroundColor Cyan
Write-Host ""

# 生成证书
Set-Location $certsDir
mkcert $certArgs

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "证书生成成功!" -ForegroundColor Green
    Write-Host "证书文件位置: $certsDir" -ForegroundColor Green
    Write-Host ""
    Write-Host "生成的文件:" -ForegroundColor Cyan
    Get-ChildItem $certsDir -Filter "*.pem" | ForEach-Object {
        Write-Host "  $_.Name" -ForegroundColor White
    }
    Write-Host ""
    Write-Host "下一步:" -ForegroundColor Yellow
    Write-Host "1. 运行 cd .." -ForegroundColor Yellow
    Write-Host "2. 运行 ./start-https.ps1 启动 HTTPS 服务" -ForegroundColor Yellow
    Write-Host "3. 访问 https://localhost:9443" -ForegroundColor Yellow
} else {
    Write-Host "证书生成失败!" -ForegroundColor Red
    exit 1
}

Set-Location ..