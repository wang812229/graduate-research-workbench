param(
  [string]$RuntimeDir = (Join-Path $PSScriptRoot '.runtime'),
  [int]$Port = 8765,
  [string]$WorkDir = (Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Yanxi-XRD')
)
$ErrorActionPreference = 'Stop'
$manifestFile = Join-Path ([IO.Path]::GetFullPath($RuntimeDir)) 'runtime.json'
if (!(Test-Path -LiteralPath $manifestFile)) { throw '请先运行 setup-xrd-runtime.ps1 准备独立计算环境' }
$runtimeInfo = Get-Content -LiteralPath $manifestFile -Raw | ConvertFrom-Json
if (!(Test-Path -LiteralPath $runtimeInfo.python) -or !(Test-Path -LiteralPath (Join-Path $runtimeInfo.source_root 'GSASII\GSASIIscriptable.py'))) { throw '独立计算环境不完整' }
$env:PYTHONIOENCODING = 'utf-8'
$env:PYTHONPATH = $runtimeInfo.source_root
$env:GSASII_DIR = $runtimeInfo.source_root
$env:YANXI_GSAS_SKILL = $runtimeInfo.skill_root
$env:PATH = "$(Join-Path $runtimeInfo.source_root 'GSASII\bin');$env:PATH"
& $runtimeInfo.python -c 'from GSASII import GSASIIscriptable as G2; print(G2.__file__)'
if ($LASTEXITCODE -ne 0) { throw '独立 GSAS-II 引擎导入失败' }
& $runtimeInfo.python (Join-Path $PSScriptRoot 'bridge.py') --port $Port --work-dir $WorkDir
if ($LASTEXITCODE -ne 0) { throw "精修服务异常退出: $LASTEXITCODE" }
