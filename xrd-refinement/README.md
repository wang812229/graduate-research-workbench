# XRD 结构精修（GSAS-II 本机伴随程序）

本模块在公开工作平台提供输入和结果界面，但计算由**用户电脑上安装的 GSAS-II** 执行。页面不上传原始样品到 GitHub、Firebase 或其他云端。仓库未包含 GSAS-II 或其二进制依赖。请按 [GSAS-II 官方安装指南](https://advancedphotonsource.github.io/GSAS-II-tutorials/install.html) 安装，并使用**该安装环境的 Python** 启动 `bridge.py`：

```powershell
powershell -ExecutionPolicy Bypass -File xrd-refinement/start-gsas-bridge.ps1
```

终端会显示 `127.0.0.1:8765` 和随机令牌。打开工作平台的“XRD 结构精修”页，将令牌填入表单后提交。桥接服务仅绑定本机回环地址，浏览器请求受来源白名单和令牌双重限制。实验原始文件和结果默认保存在 `~/Documents/Yanxi-XRD/<随机任务编号>/`。关闭终端可停止桥接服务；重启后令牌会变化。不要把令牌或私人 XRD 文件放入公开仓库。

## 必需输入

1. 常波长粉末 XRD 数值图：严格递增的 2θ（度）、非负强度，可选每点标准差 σ；接受 `.xy/.xye/.csv/.txt`，至少 100 点。没有 σ 时按 `sqrt(max(I,1))` 估计并给出警告；归一化或背景扣除后的数据不宜用此权重。
2. 对应候选相的结构 `.cif`：必须含原子坐标。PDF/ICDD 等卡片只有峰位和相对强度，不是结构 CIF，也不构成完整 Rietveld 模型。用户应核对空间群、化学计量、占位、杂相和结构版本。
3. 与本次扫描波长和几何匹配、用标准样校准的 GSAS-II `.instprm`，或可由 GSAS-II 导入的旧 `.prm`。新格式只接受 `Type:PXC`；不支持 TOF、能散射和中子衍射数据。
4. 可选的标准卡片峰表：第一列 2θ（度），第二列 0–100 的相对强度。必须确认波长一致。只在图中以绿色刻线标参考峰，不参与计算或决定结构。

每个文件不超过 30 MB。桥接服务限制单次请求 90 MB，单次计算上限 15 分钟。

## 精修范围与导出

精修实际调用 [GSASIIscriptable](https://gsas-ii.readthedocs.io/en/latest/GSASIIscriptable.html)：导入实测图、仪器参数和 CIF，建立 GSAS-II GPX；先精修 Chebyshev 背景与尺度，再可选晶胞，最后可选 U/V/W/X/Y 峰形参数。每一步保存 GPX 和 wR 诊断。完整结果包含原输入 SHA-256、阶段记录、最终 `refinement.gpx`、结构坐标用的 `refined-structure.cif`、含 `2theta_deg,Yobs,Ycalc,Background,Yobs_minus_Ycalc` 的 `origin-curves.csv`、`refinement-plot.svg` 和 `result.json`。CIF 为 GSAS-II **quick phase CIF**，不能替代用于出版的完整 pdCIF；需要在 GSAS-II 中补充样品、仪器和误差记录后导出。

Origin 可用 File → Import → Single ASCII/CSV 打开 `origin-curves.csv`，将第一列设 X，其余列设 Y。SVG 是按计算数值原创绘制，不是 GSAS-II GUI 截图。

## 必须人工审查

自动流程不会释放原子位置、占位率、热参数、零点、样品位移、择优取向、尺寸/微应变或第二相；这些自由度与仪器峰形、晶胞、背景常相关。遇到明显未拟合峰、系统性差谱、参数发散、化学不合理或 wR 恶化时，不能仅凭数值宣布结构正确。请在保存的 GPX 中加入必要相并逐步精修，结合 SEM/EDS、Raman、Laue、单晶 XRD 或独立表征核对。若样品是薄膜、强织构、磁结构或多相，当前单相随机粉末默认模型通常不够。

## 验证状态

已测试输入完整性、数值合理性、错误拒绝和静态页面构建；此电脑已在 `D:\GSAS` 找到官方 GSAS-II 安装，并用官方 PbSO₄ 实测数据完成真实两阶段端到端精修与 GPX、CIF、Origin CSV、SVG 导出。详细数值与限制见 [验收记录](validation-record.md)。该次 wR 仍约 30.57%，属**需人工复核**而非结构确认。页面在缺少引擎或失败时仍不会伪造输出。
