param(
  [string]$RuntimeDir = (Join-Path $PSScriptRoot '.runtime'),
  [string]$BasePython = 'python'
)
$ErrorActionPreference = 'Stop'
$runtimePath = [IO.Path]::GetFullPath($RuntimeDir)
if ($runtimePath -eq [IO.Path]::GetPathRoot($runtimePath)) { throw '独立环境不能设在磁盘根目录' }
$gsasCommit = '2b4aba1bc44de63a3da9d4495944c3b99e389399'
$skillCommit = '62b7ab5eac2c8c0e49584ab1ab37b61a25493e97'
$version = & $BasePython -c 'import sys; print(str(sys.version_info.major)+chr(46)+str(sys.version_info.minor))'
if ($LASTEXITCODE -ne 0 -or $version -notin @('3.12','3.13')) { throw '请使用 Windows 64 位 Python 3.12 或 3.13；无需已有 GSAS-II 安装' }
$downloads = Join-Path $runtimePath 'downloads'
New-Item -ItemType Directory -Force -Path $downloads | Out-Null
function Get-PinnedArchive([string]$Url,[string]$Destination) {
  if (Test-Path -LiteralPath $Destination) { return }
  & curl.exe -fL --retry 2 --connect-timeout 15 --max-time 120 $Url -o $Destination
  if ($LASTEXITCODE -ne 0) { throw "下载失败: $Url" }
}
$sourceZip = Join-Path $downloads 'gsas-source.zip'
$skillZip = Join-Path $downloads 'skill-source.zip'
$binaryTgz = Join-Path $downloads "win_64_p$($version)_n2.2.tgz"
Get-PinnedArchive "https://codeload.github.com/AdvancedPhotonSource/GSAS-II/zip/$gsasCommit" $sourceZip
Get-PinnedArchive "https://codeload.github.com/R3ze959/gsas-ii-rietveld-refinement-skill/zip/$skillCommit" $skillZip
$asset = if ($version -eq '3.12') { '326556413' } else { '326556152' }
$binaryDigest = if ($version -eq '3.12') { 'd12dc06ede64aa17513742ada16f74971d8e0233a82f5d2ae401bd3e09131b61' } else { 'b0e4a1a5d8e4d461a27393f5a46e78665b47dcd3e5ef9b96ce7133ac15e82685' }
if (!(Test-Path -LiteralPath $binaryTgz)) {
  & curl.exe -fL --retry 2 --connect-timeout 15 --max-time 120 -H 'Accept: application/octet-stream' "https://api.github.com/repos/AdvancedPhotonSource/GSAS-II-buildtools/releases/assets/$asset" -o $binaryTgz
  if ($LASTEXITCODE -ne 0) { throw '官方 GSAS-II 二进制组件下载失败' }
}
if ((Get-FileHash -LiteralPath $binaryTgz -Algorithm SHA256).Hash.ToLower() -ne $binaryDigest) { throw '官方 GSAS-II 计算组件 SHA-256 不一致，停止安装' }
$sourceParent = Join-Path $runtimePath 'source'
$skillParent = Join-Path $runtimePath 'skill'
$sourceRoot = Join-Path $sourceParent "GSAS-II-$gsasCommit"
$skillRoot = Join-Path $skillParent "gsas-ii-rietveld-refinement-skill-$skillCommit\gsas-ii-rietveld-refinement"
if (!(Test-Path -LiteralPath $sourceRoot)) { Expand-Archive -LiteralPath $sourceZip -DestinationPath $sourceParent }
if (!(Test-Path -LiteralPath $skillRoot)) { Expand-Archive -LiteralPath $skillZip -DestinationPath $skillParent }
$binaryRoot = Join-Path $sourceRoot 'GSASII\bin'
New-Item -ItemType Directory -Force -Path $binaryRoot | Out-Null
$entries = & tar -tzf $binaryTgz
$invalidEntries = @($entries | Where-Object { $_ -match '(^/|(^|/)\.\.(/|$)|^[A-Za-z]:)' })
if ($LASTEXITCODE -ne 0 -or $invalidEntries.Count) { throw '计算组件压缩包目录无效' }
& tar -xzf $binaryTgz -C $binaryRoot
if ($LASTEXITCODE -ne 0) { throw '计算组件解压失败' }
$pythonRoot = Join-Path $runtimePath 'python'
$python = Join-Path $pythonRoot 'Scripts\python.exe'
if (!(Test-Path -LiteralPath $python)) { & $BasePython -m venv $pythonRoot; if ($LASTEXITCODE -ne 0) { throw '独立 Python 环境创建失败' } }
$installedVersion = & $python -c 'import sys; print(str(sys.version_info.major)+chr(46)+str(sys.version_info.minor))'
if ($installedVersion -ne $version) { throw '现有独立环境的 Python 版本不匹配，请选择新的 RuntimeDir' }
& $python -m pip install 'numpy==2.2.6' 'scipy==1.15.3' 'PyCifRW==5.0.1'
if ($LASTEXITCODE -ne 0) { throw '科学计算依赖安装失败' }
$env:PYTHONPATH = $sourceRoot
$env:GSASII_DIR = $sourceRoot
$env:PATH = "$binaryRoot;$env:PATH"
& $python -c 'from GSASII import GSASIIscriptable as G2; import sys; print(sys.executable); print(G2.__file__)'
if ($LASTEXITCODE -ne 0) { throw '真实 GSAS-II 独立环境导入失败' }
$manifest = @{gsas_commit=$gsasCommit;skill_commit=$skillCommit;python_version=$version;binary_sha256=$binaryDigest;source_root=$sourceRoot;skill_root=$skillRoot;python=$python;source_archive_sha256=(Get-FileHash -LiteralPath $sourceZip -Algorithm SHA256).Hash.ToLower();skill_archive_sha256=(Get-FileHash -LiteralPath $skillZip -Algorithm SHA256).Hash.ToLower()}
$manifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimePath 'runtime.json') -Encoding utf8
Write-Output "独立环境准备完成: $runtimePath"
Write-Output '计算保留在本机，不需要云资源、OpenAI API 或已有 GSAS-II 安装。'
