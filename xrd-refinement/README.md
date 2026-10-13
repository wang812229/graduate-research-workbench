# XRD 结构精修：独立 GSAS-II + GitHub skill

默认流程另行建立隔离 Python 环境、下载官方 GSAS-II 和 [指定 skill](https://github.com/R3ze959/gsas-ii-rietveld-refinement-skill)，不使用电脑原有 D:\GSAS。计算仍在本机，**不使用收费云服务或 OpenAI API**；公开静态网站本身不能执行 Python 精修。skill 不是数值引擎，实际拟合由 GSAS-II 执行。skill 当前为 PolyForm Noncommercial 许可；仅下载到本地，未作为 MIT 项目重新分发。

## 开始

下载仓库源码，在仓库目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File xrd-refinement/setup-xrd-runtime.ps1
powershell -ExecutionPolicy Bypass -File xrd-refinement/start-skill-bridge.ps1
```

默认隔离目录 xrd-refinement/.runtime；两条命令支持 -RuntimeDir 指定新的隔离目录。Python 3.12 / 3.13 Windows 64 位受安装脚本支持；3.12 已实测。源代码固定 commit、原生二进制校验 SHA-256，配置记入 runtime.json。首次需联网下载，之后本机执行。终端显示本次随机令牌，填入工作平台 XRD 页面。服务只绑定 127.0.0.1:8765，通过来源白名单和令牌保护；关闭终端停止服务，重启令牌变化。

结果默认留在 ~/Documents/Yanxi-XRD/<随机任务编号>/，不上传 GitHub/Firebase。单文件30 MB、单请求90 MB、结果包150 MB；精修最长30分钟、选定/归档最长15分钟，超时终止任务进程。旧 start-gsas-bridge.ps1 兼容原安装，但不是默认依赖。

## 输入与仪器边界

1. 一维常波长粉末图：严格递增2θ（度）、非负强度、可选逐点σ；xy/xye/csv/txt，至少100点。缺σ时使用 sqrt(max(I,1)) 近似并警告；不要把已归一化或扣背景谱当原始计数。
2. 含原子坐标的候选相 CIF。仅峰位和相对强度的标准卡片不能构成 Rietveld 结构模型。用户确认化学计量、空间群、结构版本和杂相。
3. 同波长、同光学与扫描配置，用标准样校准的 GSAS-II instprm 或旧 prm。仅支持实验室 PXC 与 Bragg–Brentano 粉末几何，不是 TOF、中子、能散射或薄膜完整模型。
4. 可选同波长标准卡片峰表：仅参考，不替代CIF、不参与拟合。

Rigaku Ultima IV 预设记录3 kW、20–60 kV、185 mm及用户提供的稳定性。实际靶材、滤片/单色器、狭缝与检测器应逐次确认。型号和功率不能生成校准 U/V/W、X/Y、零点或波长。185 mm写入 GSAS-II 样品几何，实际靶材与校准文件波长冲突会拒绝。详见 [仪器说明与来源](skill-integration.md)。

## 真实流程与审查

先执行上游请求分类器和计划检查，再建立真实GPX。比较背景/尺度、仅晶胞、仅零点、晶胞零点同时、先晶胞后零点、先零点后晶胞六分支；校准峰形锁定，原子位置、占位和热参数不自动释放。保留每个候选实际 Rwp/GOF、晶胞、相关性、全谱正残差和收敛诊断。上游门槛包括无SVD、max shift/esd≤0.01、最大相关性<95%等；不合格候选不能保存为选定模型。

门槛通过仍不证明结构。用户比较差谱、未拟合峰、成分、晶胞/零点路径依赖，填写理由后选择；系统调用上游选定、规范报告验证和哈希归档，不自动挑最低Rwp。多相、薄膜、强织构、占位和尺寸/应变等仍需专项模型与独立证据，当前模块不声称覆盖 GSAS-II 所有功能。

## 保存和Origin

保留GPX、LST、quick phase CIF、输入SHA-256、报告、诊断JSON、哈希档案。

- origin-curves.csv：2theta_deg、Yobs、Ycalc、Background、Yobs_minus_Ycalc，全量点。
- origin-reflections.csv：相名、h/k/l、d、模型实际2θ刻线，不是标准卡片替代数据。
- refinement-plot.svg：根据实际数组独立绘制观测/计算/背景、偏移差谱和模型反射，不是GUI截图或skill图。

Origin用CSV/ASCII导入，2theta_deg设X、强度设Y，差谱可另层，反射CSV可作刻线。quick phase CIF不能替代出版用完整pdCIF。Windows上游归档兼容修复保留哈希核验，并记录.windows-durability.json，不伪称POSIX目录fsync。

## 验收

[真实验收记录](validation-record.md)：2026-10-13新隔离引擎运行官方PbSO₄ 6000点实测谱，六分支、不合格候选拒绝、选择、报告验证和归档实际完成。工程验收分支Rwp≈25.04%，残差仍明显，不能当作结构确认或Rigaku校准。单元测试中的mock只验证编排与拒绝逻辑，和实际引擎验收分开。
