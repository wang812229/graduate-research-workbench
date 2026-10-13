# 独立 GSAS-II 引擎与指定 skill

本模块的默认流程调用 [gsas-ii-rietveld-refinement](https://github.com/R3ze959/gsas-ii-rietveld-refinement-skill/blob/main/gsas-ii-rietveld-refinement/SKILL.md) 的真实分类器、分支驱动、候选选择、报告校验和归档程序。skill 固定在 `62b7ab5eac2c8c0e49584ab1ab37b61a25493e97`，GSAS-II 源码固定在 `2b4aba1bc44de63a3da9d4495944c3b99e389399`。没有把第三方 skill 代码重新许可或复制进本平台的 MIT 源码；准备脚本将它与原许可证下载到个人计算环境。

该仓库采用 PolyForm Noncommercial，个人非商业研究适用其原许可；它不捆绑 GSAS-II 引擎。运行时始终使用真实 GSASIIscriptable。

## 免费、本机计算、无需已有 GSAS-II 安装

下载本平台 `xrd-refinement` 目录，使用 Windows 64 位 Python 3.12 或 3.13，在该目录的上一级运行：

```powershell
powershell -ExecutionPolicy Bypass -File xrd-refinement/setup-xrd-runtime.ps1
powershell -ExecutionPolicy Bypass -File xrd-refinement/start-skill-bridge.ps1
```

第一次下载科学计算依赖、官方源码与已发布的二进制组件，并校验计算组件 SHA-256；以后只需第二条命令。环境默认放在 `xrd-refinement/.runtime`。可为两条命令指定相同的 `-RuntimeDir` 路径。程序不读取 `D:\GSAS`，不安装 GUI，不需要管理员权限、OpenAI API 或云资源。数据通过本机回环服务交给计算引擎，结果留在个人 `Documents/Yanxi-XRD`，不发送到 GitHub 或 Firebase。

这仍需本机 Python 和独立下载的数值引擎；GitHub Pages 本身不能执行 GSAS-II 的原生计算组件。

## 数值流程与结果

1. 分类器必须返回 `single_pattern_refinement` 和 `ready`。
2. 校验实测数据、原子坐标 CIF 与用户提供的校准参数，保留原文件 SHA-256。
3. 比较六条真实分支：尺度/背景、晶胞、零点、同时释放晶胞和零点、先晶胞后零点、先零点后晶胞。默认锁定 U/V/W 与其他仪器峰形项。
4. skill 检查收敛、奇异矩阵、参数相关性、shift/esd、正残差峰和晶胞/零点路径依赖。失败的分支不能通过平台保存为选定结果。
5. 下载候选审查包，检查差谱、相模型和化学证据。在页面记录具体审查意见并选定一个通过数值门槛的候选。
6. skill 导出选定 GPX/CIF，生成并校验报告，按 SHA-256 验证归档。平台另从真实计算数组导出 Origin CSV 与 SVG。所有比较分支暂缓清理，保留复查证据。

`skill_entry.py` 只在实测图导入后写入用户确认的 Bragg–Brentano 几何和测角仪半径，并核对波长与所选靶材是否明显冲突；GSAS-II 数值计算和上游 skill 门槛没有被替换。当前专用路线适用于单相常波长粉末图；多相、薄膜和未知相识别需要另行建立正确模型。

## Ultima IV 参数的实际含义

[设备档案](rigaku-ultima-iv-185.json)记录 3 kW、20–60 kV、185 mm 等已给出的规格，并引用 [Rigaku 产品手册](https://www.irtech.in/wp-content/uploads/2022/04/Ultima-IV-brochure-A4_brochure_EN_Ver1.00_compressed-1.pdf)。手册列有不同靶材、聚焦/平行光束以及探测器配置，不能用型号猜本次扫描光路。±0.005% 稳定性来自用户提供的信息，并未由本台设备校准记录独立证实。

功率、管电压与半径不能确定仪器 U/V/W、低角不对称、零点、Kα2 比或实际波长。请使用本次同一光路、狭缝和探测器配置的 LaB6/Si 标准样谱和已有 `.instprm/.prm`；必要时按 [GSAS-II 官方校准教程](https://advancedphotonsource.github.io/GSAS-II-tutorials/CWInstDemo/FindProfParamCW.html)确定并保存参数。此设备 JSON 不会被当成校准文件参与精修。
