"""Local, auditable GSAS-II Rietveld runner. No substitute fitting algorithm.

Run with the Python interpreter used to install GSAS-II::
    python runner.py --input job.json --output results-directory
The JSON contains paths for pattern, CIF structure and calibrated .instprm.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import sys


MAX_FILE = 30 * 1024 * 1024


class InputError(ValueError):
    pass


def checked_file(value: str, extensions: set[str]) -> Path:
    path = Path(value).expanduser().resolve(strict=True)
    if not path.is_file() or path.suffix.lower() not in extensions:
        raise InputError(f"不支持的文件类型：{path.name}")
    if path.stat().st_size > MAX_FILE or path.stat().st_size == 0:
        raise InputError(f"文件必须为非空且不超过 30 MB：{path.name}")
    return path


def parse_pattern(path: Path) -> tuple[list[tuple[float, float, float]], list[str]]:
    """Two/three-column CW data; third column is standard deviation, not weight."""
    points = []
    warnings = []
    for number, raw in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith(("#", "!", ";")):
            continue
        cells = [v.strip() for v in (line.split(",") if "," in line else line.split())]
        if not points and cells[0].lower() in {"2theta", "two_theta", "theta", "angle", "2theta_deg"}:
            continue
        if len(cells) not in (2, 3):
            raise InputError(f"XRD 数据第 {number} 行必须为 2θ、强度、可选 σ 三列")
        try:
            x, y = float(cells[0]), float(cells[1])
            sigma = float(cells[2]) if len(cells) == 3 else math.sqrt(max(y, 1.0))
        except ValueError as exc:
            raise InputError(f"XRD 数据第 {number} 行不是数值") from exc
        if not all(map(math.isfinite, (x, y, sigma))) or sigma <= 0 or y < 0:
            raise InputError(f"XRD 数据第 {number} 行包含无效数值")
        if not 0 < x < 180 or (points and x <= points[-1][0]):
            raise InputError(f"第 {number} 行 2θ 不在 (0,180) 或未严格递增")
        points.append((x, y, sigma))
    if len(points) < 100:
        raise InputError("至少需要 100 个有效测量点；不接受卡片峰表冒充实测衍射图")
    if len({round(p[0]-points[i-1][0], 6) for i, p in enumerate(points) if i}) > 10:
        warnings.append("2θ 步长不均匀，请核对仪器导出格式及 GSAS-II 插值行为。")
    if len(path.read_text(encoding="utf-8-sig").splitlines()) > 0 and path.suffix.lower() != ".xye":
        warnings.append("已将输入转换为 GSAS-II XYE 格式；保留了原始文件。")
    if all(len(line.split(",") if "," in line else line.split()) == 2 for line in path.read_text(encoding="utf-8-sig").splitlines() if line.strip() and not line.lstrip().startswith(("#", "!", ";")) and not line.lower().startswith(("2theta", "two_theta", "theta", "angle"))):
        warnings.append("未提供逐点 σ；暂用 sqrt(max(I,1)) 估计。若计数已归一化/扣背景，此权重不可靠，需人工复核。")
    return points, warnings


def validate_job(job: dict) -> tuple[dict[str, Path], list[tuple[float, float, float]], list[str]]:
    if not isinstance(job, dict):
        raise InputError("任务必须是 JSON 对象")
    paths = {
        "pattern": checked_file(job.get("pattern", ""), {".xy", ".xye", ".csv", ".txt"}),
        "structure": checked_file(job.get("structure", ""), {".cif"}),
        "instrument": checked_file(job.get("instrument", ""), {".instprm", ".prm"}),
    }
    if job.get("card"):
        paths["card"] = checked_file(job["card"], {".csv", ".txt", ".xy", ".xye"})
        if not job.get("confirm_card_same_wavelength"):
            raise InputError("上传标准卡片时必须确认卡片峰位与实测图使用相同波长及 2θ 单位")
    if not job.get("confirm_structure_match") or not job.get("confirm_instrument_calibrated"):
        raise InputError("必须确认 CIF 是候选真实结构、仪器参数对应此次测量；标准卡片不足以作 Rietveld 精修")
    if job.get("refine_cell") not in (None, True, False) or job.get("refine_profile") not in (None, True, False):
        raise InputError("精修选项格式不正确")
    if not 2 <= int(job.get("background_terms", 4)) <= 8:
        raise InputError("背景项数只允许 2–8")
    cif = paths["structure"].read_text(encoding="utf-8-sig", errors="replace").lower()
    if not any(k in cif for k in ("_atom_site_fract_x", "_atom_site_cartn_x")):
        raise InputError("CIF 缺少原子坐标；标准卡片/峰表不是可精修的结构模型")
    instrument = paths["instrument"].read_text(encoding="utf-8-sig", errors="replace").replace(" ", "")
    if "correctioncode" in instrument.lower():
        raise InputError("仪器参数文件含可执行 CorrectionCode；为保护本机安全，请在 GSAS-II 中审查并另存无脚本版本")
    if paths["instrument"].suffix.lower() == ".instprm":
        if "Type:PXC" not in instrument:
            raise InputError("此模块仅支持常波长粉末 XRD（GSAS-II Type:PXC）；不接受 TOF、中子或能散射参数冒充 XRD")
    points, warnings = parse_pattern(paths["pattern"])
    return paths, points, warnings


def parse_card(path: Path) -> list[tuple[float, float]]:
    """Reference ticks only; never contributes residuals or model parameters."""
    peaks = []
    for number, raw in enumerate(path.read_text(encoding="utf-8-sig").splitlines(), 1):
        line = raw.strip()
        if not line or line.startswith(("#", "!", ";")):
            continue
        cells = [s.strip() for s in (line.split(",") if "," in line else line.split())]
        if not peaks and cells[0].lower() in {"2theta", "2theta_deg", "two_theta"}:
            continue
        if len(cells) < 2:
            raise InputError(f"标准卡片第 {number} 行必须包含 2θ 与相对强度")
        try:
            x, y = float(cells[0]), float(cells[1])
        except ValueError as exc:
            raise InputError(f"标准卡片第 {number} 行不是数值") from exc
        if not (0 < x < 180 and math.isfinite(y) and 0 <= y <= 100):
            raise InputError(f"标准卡片第 {number} 行应为 2θ 度数及 0–100 相对强度")
        peaks.append((x, y))
    if not 1 <= len(peaks) <= 400:
        raise InputError("标准卡片应为 1–400 条 2θ/相对强度峰表；不能直接上传 PDF 卡片")
    return peaks


def svg_plot(rows: list[tuple[float, float, float, float, float]], path: Path, card: list[tuple[float, float]] | None = None) -> None:
    """Original vector plot from calculated numeric values; no publisher graphics."""
    width, height = 1100, 650
    margin = 74
    xmin, xmax = rows[0][0], rows[-1][0]
    ymax = max(max(r[1], r[2]) for r in rows) * 1.05 or 1
    dmax = max(abs(r[4]) for r in rows) or 1
    def curve(col, baseline, span, scale):
        coords = []
        for x, *rest in rows:
            value = (x, *rest)[col]
            px = margin + (x-xmin)/(xmax-xmin)*(width-2*margin)
            py = baseline - value/scale*span
            coords.append(f"{px:.1f},{py:.1f}")
        return " ".join(coords)
    xml = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}">',
           '<rect width="100%" height="100%" fill="white"/>',
           f'<path d="M{margin} 35V{height-50}H{width-margin}" fill="none" stroke="#333"/>',
           '<text x="80" y="28" font-family="sans-serif" font-size="20">GSAS-II Rietveld refinement · observed / calculated / difference</text>',
           f'<text x="{width//2}" y="{height-12}" font-family="sans-serif">2θ (degrees)</text>',
           '<text x="10" y="58" font-family="sans-serif">Intensity</text>',
           f'<polyline fill="none" stroke="#1e293b" stroke-width="1" points="{curve(1, 405, 345, ymax)}"/>',
           f'<polyline fill="none" stroke="#d03b33" stroke-width="1.4" points="{curve(2, 405, 345, ymax)}"/>',
           f'<polyline fill="none" stroke="#2563eb" stroke-width="1" points="{curve(4, 565, 90, dmax)}"/>',
           '<text x="790" y="64" font-family="sans-serif" fill="#1e293b">Observed</text>',
           '<text x="885" y="64" font-family="sans-serif" fill="#d03b33">Calculated</text>',
           '<text x="790" y="84" font-family="sans-serif" fill="#2563eb">Difference (separate scale)</text>',
           f'<text x="{margin}" y="{height-32}" font-family="sans-serif">{xmin:.2f}°</text>',
           f'<text x="{width-margin-50}" y="{height-32}" font-family="sans-serif">{xmax:.2f}°</text>',
           '<text x="790" y="104" font-family="sans-serif" fill="#23845d">Card ticks: reference only</text>']
    for x, intensity in (card or []):
        if xmin <= x <= xmax:
            px = margin + (x-xmin)/(xmax-xmin)*(width-2*margin)
            xml.append(f'<path d="M{px:.1f} 598v{-6-intensity*.12:.1f}" stroke="#23845d" stroke-width="1"/>')
    xml.append('</svg>')
    path.write_text("\n".join(xml), encoding="utf-8")


def run(job: dict, out: Path, gsas=None) -> dict:
    paths, points, warnings = validate_job(job)
    card_peaks = parse_card(paths["card"]) if "card" in paths else []
    if gsas is None:
        try:
            from GSASII import GSASIIscriptable as gsas
        except ImportError:
            try:
                import G2script as gsas  # official shortcut installed by GSAS-II
            except ImportError as exc:
                raise RuntimeError("未安装 GSAS-II 脚本环境；未运行也未生成虚构精修结果") from exc
    out = out.resolve()
    if out.exists() and any(out.iterdir()):
        raise InputError("输出目录非空；为保证可追溯性，请使用新目录")
    out.mkdir(parents=True, exist_ok=True)
    manifest = {key: {"name": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for key, path in paths.items()}
    for key, path in paths.items():
        shutil.copy2(path, out / f"raw-{key}{path.suffix.lower()}")
    xye = out / "measured.xye"
    xye.write_text("# 2theta intensity sigma\n" + "".join(f"{x:.8f} {y:.8f} {s:.8f}\n" for x,y,s in points), encoding="utf-8")
    project = gsas.G2Project(newgpx=str(out / "refinement.gpx"))
    hist = project.add_powder_histogram(str(xye), str(paths["instrument"]))
    raw_type = hist.data["Instrument Parameters"][0]["Type"]
    instrument_type = raw_type[0] if isinstance(raw_type, (list, tuple)) else raw_type
    if instrument_type != "PXC":
        raise InputError(f"GSAS-II 识别的仪器类型为 {instrument_type}，不是常波长粉末 XRD PXC；已停止精修")
    phase = project.add_phase(str(paths["structure"]), phasename="Sample phase", histograms=[hist], fmthint="CIF", useNet=False)
    initial_cell = phase.get_cell()
    snapshots = []
    stages = [
        ("background + scale", {"set": {"Background": {"type": "chebyschev-1", "no. coeffs": int(job.get("background_terms", 4)), "refine": True}, "Sample Parameters": ["Scale"]}}),
    ]
    if job.get("refine_cell", True):
        stages.append(("unit cell", {"set": {"Cell": True}}))
    if job.get("refine_profile", False):
        stages.append(("profile (instrument standard required)", {"set": {"Instrument Parameters": ["U", "V", "W", "X", "Y"]}}))
    # Never silently refine site occupancy, ADPs, atomic positions, zero,
    # displacement or preferred orientation; these are highly correlated.
    for index, (name, step) in enumerate(stages, 1):
        project.do_refinements([step])
        project.save(str(out / f"stage-{index}.gpx"))
        residuals = {str(k): float(v) for k, v in hist.residuals.items() if isinstance(v, (int, float)) and math.isfinite(v)}
        wr = hist.get_wR()
        if wr is None or not math.isfinite(float(wr)):
            raise RuntimeError(f"阶段 {name} 未得到有限的 wR；请用 GSAS-II 检查原始数据与模型")
        cell, cell_esd = phase.get_cell_and_esd()
        snapshots.append({"stage": name, "wR_percent": float(wr), "residuals": residuals, "cell": cell, "cell_esd": cell_esd})
        if index > 1 and float(wr) > snapshots[-2]["wR_percent"] * 1.15:
            warnings.append(f"阶段 {name} 的 wR 显著恶化；需检查结构、背景及参数相关性。")
    project.save(str(out / "refinement.gpx"))
    phase.export_CIF(str(out / "refined-structure.cif"))
    arrays = [hist.getdata(k) for k in ("X", "Yobs", "Ycalc", "Background", "Residual")]
    rows = []
    for i in range(len(arrays[0])):
        if any(bool(a.mask[i]) if hasattr(a.mask, "__getitem__") else bool(a.mask) for a in arrays):
            continue
        rows.append(tuple(float(a[i]) for a in arrays))
    if len(rows) < 100 or any(not all(map(math.isfinite, r)) for r in rows):
        raise RuntimeError("GSAS-II 输出曲线无效；未导出图形")
    with (out / "origin-curves.csv").open("w", encoding="utf-8-sig", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(["2theta_deg", "Yobs", "Ycalc", "Background", "Yobs_minus_Ycalc"])
        writer.writerows(rows)
    svg_plot(rows, out / "refinement-plot.svg", card_peaks)
    if card_peaks:
        with (out / "card-reference.csv").open("w", encoding="utf-8-sig", newline="") as file:
            writer = csv.writer(file)
            writer.writerow(["2theta_deg", "relative_intensity_percent"])
            writer.writerows(card_peaks)
        warnings.append("标准卡片仅以绿色刻线叠加作参照，不参与 GSAS-II 最小二乘精修。")
    result = {"engine": "GSAS-II GSASIIscriptable", "status": "completed_with_review_required", "input": manifest,
              "points": len(points), "initial_cell": initial_cell, "final_cell": phase.get_cell(),
              "final_cell_esd": phase.get_cell_and_esd()[1],
              "stages": snapshots, "warnings": warnings,
              "interpretation": "wR 低不独自证明结构正确；需核对差谱、杂相、系统误差、参数相关性、结构化学合理性及仪器校准。",
              "exports": ["refinement.gpx", "refinement.lst", "refined-structure.cif", "origin-curves.csv", "refinement-plot.svg"]
              + [f"stage-{i}.gpx" for i in range(1, len(stages)+1)]
              + [f"stage-{i}.lst" for i in range(1, len(stages)+1)]
              + (["card-reference.csv"] if card_peaks else [])}
    (out / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        result = run(json.loads(args.input.read_text(encoding="utf-8")), args.output)
        print(json.dumps(result, ensure_ascii=False, default=str))
        return 0
    except (InputError, RuntimeError, OSError, ValueError) as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
