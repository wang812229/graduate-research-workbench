param(
  [string]$GsasHome = 'D:\GSAS'
)

$python = Join-Path $GsasHome 'python.exe'
$sources = Join-Path $GsasHome 'GSAS-II'
$module = Join-Path $sources 'GSASII\GSASIIscriptable.py'
if (-not (Test-Path -LiteralPath $python) -or -not (Test-Path -LiteralPath $module)) {
  throw "在 $GsasHome 未找到完整的 GSAS-II 安装。请将 -GsasHome 指向官方安装根目录。"
}

# Conda-installed GSAS-II needs its own DLL directories, even when invoking
# python.exe by absolute path. Omitting Library\bin can terminate Python with
# Windows exception 0xC06D007F while importing the CIF phase.
$env:PYTHONPATH = $sources
$env:PATH = @($GsasHome,(Join-Path $GsasHome 'Library\bin'),(Join-Path $GsasHome 'Scripts'),(Join-Path $GsasHome 'DLLs'),$env:PATH) -join ';'
$env:PYTHONUTF8 = '1'
& $python -c 'from GSASII import GSASIIscriptable as G2; print("GSAS-II engine:", G2.__file__)'
if ($LASTEXITCODE -ne 0) { throw 'GSAS-II 引擎导入失败；桥接服务未启动。' }
& $python (Join-Path $PSScriptRoot 'bridge.py')
if ($LASTEXITCODE -ne 0) { throw "GSAS-II 桥接服务异常退出，代码 $LASTEXITCODE。" }
