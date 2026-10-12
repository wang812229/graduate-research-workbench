# 真实 GSAS-II 验收记录

2026-10-12 在此电脑的官方 GSAS-II 安装 `D:\GSAS` 中运行 `GSASIIscriptable`。这不是 mock、合成测试谱或只生成网页图：输入是 [GSAS-II 官方 PythonScript 教程公开文件](https://advancedphotonsource.github.io/GSAS-II-tutorials/PythonScript/data/) `PBSO4.XRA`、`INST_XRY.PRM` 和 `PbSO4-Wyckoff.cif`。先用 GSAS-II 官方读取器把 `.XRA` 的 6000 个实测点导出为两列 `.xy`，再用本仓库 `runner.py` 按 `background + scale → unit cell` 两阶段运行。没有逐点 σ，模块明确采用 `sqrt(max(I,1))` 的近似权重并给出警告。

| 检查项 | 实际结果 |
| --- | --- |
| GSAS-II 引擎 | `D:\GSAS\GSAS-II\GSASII\GSASIIscriptable.py`，调用 `G2Project.add_powder_histogram`、`add_phase`、`do_refinements` |
| 实测点 | 6000 |
| 第一阶段 wR | 40.4908% |
| 第二阶段 wR | 30.5746% |
| 初始晶胞 | a=8.480 Å，b=5.398 Å，c=6.958 Å |
| 最终晶胞 | a=8.48451 Å，b=5.40094 Å，c=6.96295 Å |
| 实际产物 | `refinement.gpx`、两阶段 GPX、`refinement.lst`、`refined-structure.cif`、`origin-curves.csv`、`refinement-plot.svg`、`result.json` |

运行时输出由 GSAS-II 自身报告两次 Hessian Levenberg-Marquardt refinement，第一阶段 5 个变量、第二阶段 8 个变量。`result.json` 记录输入 SHA-256、阶段残差、晶胞及警告。验收产物保存在本机临时目录，不纳入网站/GitHub，也不含用户样品数据。

又通过 `validate_official_e2e.py` 从本机回环 HTTP 桥接接口提交同一套官方实测文件：返回的 ZIP 实际包含最终 GPX/LST、两个阶段的 GPX/LST、结构 CIF、Origin CSV、SVG 和结果 JSON；Origin CSV 有 6000 行数值点。这个检查同时覆盖浏览器所调用的桥接 API、GSAS-II 子进程和打包下载链路，仍不使用模拟引擎。复现命令：在激活 GSAS-II 自带 Python/DLL 环境后运行 `python xrd-refinement/validate_official_e2e.py --data-dir 官方样例本地目录`。样例 `.xy` 应由 GSAS-II 从 `PBSO4.XRA` 导出。

单独测试了可选的 U/V/W/X/Y 峰形阶段：第三阶段 wR 为 20.8139%。这只说明这组参数在教程样例上进一步降低残差；与晶胞、样品展宽及仪器函数的相关性仍需检验，峰形阶段保持**默认关闭**。

**科学边界：** wR 30.57% 仍然很高，说明这一保守的自动参数集并未把教程样品充分拟合到可发表水平；但它验证了真实引擎和完整导出链路。不可把“程序跑通”当成“结构已证实”。后续真实样品应看全谱差谱、独立杂相、波长/几何、参数相关性与化学合理性；必要时在 GPX 中人工加入相和逐步释放物理上可识别的参数。此验收没有测试多相、薄膜、织构、零点、尺寸/应变或占位参数。

**Windows 启动注意：** 只用 `D:\GSAS\python.exe` 而未把 `D:\GSAS\Library\bin` 放入 `PATH` 时，CIF 相导入触发系统异常 `0xC06D007F`。`start-gsas-bridge.ps1` 已在启动前设置官方 Conda 环境 DLL 路径并做引擎导入检查；服务仍只在本机运行。
