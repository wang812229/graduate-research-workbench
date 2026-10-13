"""Run the separately licensed GSAS-II skill with a real, isolated engine.

The upstream numerical driver and its safety gates are called unchanged.
Curve export below is a separate downstream operation, not a skill figure.
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
import subprocess
import sys
from runner import InputError, validate_job, svg_plot

SKILL_COMMIT = "62b7ab5eac2c8c0e49584ab1ab37b61a25493e97"


def skill_scripts() -> Path:
    directory = Path(os.environ.get("YANXI_GSAS_SKILL", str(Path.home() / ".codex/skills/gsas-ii-rietveld-refinement"))).resolve()
    scripts = directory / "scripts"
    required = ("classify_refinement_request.py", "run_staged_refinement.py", "select_refinement_candidate.py", "build_validate_refinement_report.py", "archive_refinement_results.py")
    if not all((scripts / name).is_file() for name in required):
        raise RuntimeError("指定的 GSAS-II skill 尚未安装完整；请先运行 setup-xrd-runtime.ps1")
    return scripts


def invoke(scripts: Path, name: str, args: list[str], log: Path | None = None, metadata_file: Path | None = None) -> str:
    command = [sys.executable, str(scripts / name), *args]
    env = os.environ.copy()
    if metadata_file is not None:
        env["YANXI_INSTRUMENT_METADATA"] = str(metadata_file)
        command = [sys.executable, str(Path(__file__).with_name("skill_entry.py")), str(scripts / name), *args]
    elif name == "archive_refinement_results.py" and os.name == "nt":
        command = [sys.executable, str(Path(__file__).with_name("skill_archive_entry.py")), str(scripts / name), *args]
    process = subprocess.run(command, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=900, check=False, env=env, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    if log is not None:
        log.write_text(process.stdout + "\n" + process.stderr, encoding="utf-8")
    if process.returncode:
        raise RuntimeError(f"skill {name} 停止（{process.returncode}）：{process.stderr[-1800:] or process.stdout[-1800:]}")
    return process.stdout


def export_curves(gpx: Path, directory: Path) -> int:
    from GSASII import GSASIIscriptable as G2
    project = G2.G2Project(str(gpx))
    hist = project.histograms()[0]
    arrays = [hist.getdata(key) for key in ("X", "Yobs", "Ycalc", "Background", "Residual")]
    rows = []
    for index in range(len(arrays[0])):
        if any(bool(a.mask[index]) if hasattr(a.mask, "__getitem__") else bool(a.mask) for a in arrays):
            continue
        row = tuple(float(a[index]) for a in arrays)
        if not all(map(math.isfinite, row)):
            raise RuntimeError("GSAS-II 返回非有限曲线数值，未导出")
        rows.append(row)
    if len(rows) < 100:
        raise RuntimeError("GSAS-II 有效输出点不足，未导出")
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "origin-curves.csv").open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["2theta_deg", "Yobs", "Ycalc", "Background", "Yobs_minus_Ycalc"])
        writer.writerows(rows)
    reflections = []
    for phase_name, values in hist.reflections().items():
        if values.get("Type") != "PXC":
            continue
        offset = 1 if values.get("Super") else 0
        for reflection in values["RefList"]:
            position = float(reflection[5+offset])
            if math.isfinite(position):
                reflections.append((phase_name, int(reflection[0]), int(reflection[1]), int(reflection[2]), float(reflection[4+offset]), position))
    with (directory / "origin-reflections.csv").open("w", encoding="utf-8-sig", newline="") as stream:
        writer = csv.writer(stream)
        writer.writerow(["phase", "h", "k", "l", "d_angstrom", "2theta_deg"])
        writer.writerows(reflections)
    svg_plot(rows, directory / "refinement-plot.svg", reflections=[reflection[-1] for reflection in reflections])
    return len(rows)


def audit_functions(scripts: Path):
    if str(scripts) not in sys.path:
        sys.path.insert(0, str(scripts))
    from refinement_audit import candidate_safety_errors
    return candidate_safety_errors


def write_review(summary: dict, result: dict, path: Path, selection: str = "", note: str = ""):
    lines = ["# 候选模型审查", "", "此文档列出实际 skill 分支和数值检查。原子坐标、占位率、热参数未自动释放；样品化学身份由上传者确认。", "", "| 候选 | 拟合解释 | 可能的假改善 / 最弱环节 | 数值审查 | 结论范围 |", "|---|---|---|---|---|"]
    for candidate in result["candidates"]:
        errors = "；".join(candidate["selection_errors"]) or "数值门槛通过；仍需核对全谱差谱与杂相"
        lines.append(f"| {candidate['name']} | 实际释放 {', '.join(candidate.get('releases', []))}；Rwp={candidate.get('Rwp')}% | 晶胞与零点可能相关；背景和峰形不匹配可能留下正残差 | {errors} | {'用户选择的审查候选' if candidate['name']==selection else '比较候选'}，不独自证明结构或占位 |")
    lines += ["", "## 全谱正残差与几何敏感性", "", "以下数值来自 skill 的 candidate_summary.json；峰形不匹配、遗漏相与制样误差应结合原始谱区分。", "", "```json", json.dumps([{ "name": c["name"], "cell": c.get("cell"), "instrument": c.get("instrument"), "residual_audit": c.get("residual_audit"), "correlations": c.get("correlations") } for c in summary["candidates"]], ensure_ascii=False, indent=2), "```", "", "## 研究者审查记录", "", note or "尚未选择候选；请比较差谱、晶胞/零点路径依赖和样品化学证据。", "", "## 保存与清理", "", "所有比较分支保留在本机，暂缓清理以供复查。没有删除输入原文件。图形由平台读取计算数组后独立导出，skill 本身未生成图形。"]
    path.write_text("\n".join(lines), encoding="utf-8")


def run(job: dict, output: Path) -> dict:
    paths, points, warnings = validate_job(job)
    scripts = skill_scripts()
    # The required classifier runs before GSAS-II import or GPX/staging creation.
    classification = json.loads(invoke(scripts, "classify_refinement_request.py", ["--pattern", str(paths["pattern"]), "--declared-mode", "single"]))
    if classification.get("status") != "ready" or classification.get("classification") != "single_pattern_refinement":
        raise InputError("skill 未将输入核准为单张粉末图；未运行精修")
    engine_path = os.environ.get("GSASII_DIR", "")
    if not engine_path or not (Path(engine_path) / "GSASII/GSASIIscriptable.py").is_file():
        raise RuntimeError("独立 GSAS-II 引擎路径缺失；请通过 start-skill-bridge.ps1 启动")
    output = output.resolve()
    if output.exists() and any(output.iterdir()):
        raise InputError("输出目录非空；请使用新任务以保留历史")
    output.mkdir(parents=True, exist_ok=True)
    for kind, source in paths.items():
        shutil.copy2(source, output / f"raw-{kind}{source.suffix.lower()}")
    xye = output / "measured.xye"
    xye.write_text("# 2theta intensity sigma\n" + "".join(f"{x:.9g} {y:.12g} {sigma:.12g}\n" for x, y, sigma in points), encoding="utf-8")
    args = ["--sample-id", "Sample", "--xrd", str(xye), "--cif", str(paths["structure"]), "--instrument", str(paths["instrument"]), "--gsasii-path", engine_path, "--instrument-profile-status", "calibrated", "--profile-mode", "locked", "--background-order", str(int(job.get("background_terms", 4))), "--staging-root", str(output / "staging"), "--run-id", "run"]
    plan = json.loads(invoke(scripts, "run_staged_refinement.py", args + ["--plan-only"]))
    (output / "refinement-plan.json").write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    metadata_file = None
    if job.get("instrument_metadata"):
        metadata_file = output / "instrument-metadata.json"
        metadata_file.write_text(json.dumps(job["instrument_metadata"], ensure_ascii=False, indent=2), encoding="utf-8")
    invoke(scripts, "run_staged_refinement.py", args, output / "skill-run.log", metadata_file)
    summary_path = output / "staging/Sample_run/candidate_summary.json"
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    safety_errors = audit_functions(scripts)
    candidates = []
    for candidate in summary["candidates"]:
        errors = safety_errors(candidate)
        name = candidate["name"]
        curves = ""
        if candidate.get("status") == "succeeded":
            export_curves(Path(candidate["gpx"]["path"]), output / "curves" / name)
            curves = f"curves/{name}/origin-curves.csv"
        candidates.append({"name": name, "status": candidate.get("status"), "Rwp": candidate.get("metrics", {}).get("Rwp", {}).get("value"), "GOF": candidate.get("metrics", {}).get("GOF", {}).get("value"), "releases": candidate.get("releases", []), "convergence": candidate.get("convergence"), "correlations": candidate.get("correlations"), "residual_audit": candidate.get("residual_audit"), "selection_errors": errors, "eligible_for_selection": not errors, "curves": curves})
    result = {"engine": "GSAS-II GSASIIscriptable + gsas-ii-rietveld-refinement skill", "workflow": "skill", "status": "candidates_require_review", "skill_commit": SKILL_COMMIT, "request_classification": classification, "engine_source": engine_path, "python": sys.executable, "points": len(points), "instrument_metadata": job.get("instrument_metadata"), "input": {kind: {"name": source.name, "sha256": hashlib.sha256(source.read_bytes()).hexdigest()} for kind, source in paths.items()}, "candidates": candidates, "warnings": warnings + ["已锁定仪器峰形，实际比较尺度/背景、晶胞、零点以及两种先后路径；数值门槛通过仍需检查杂相与差谱。"], "selected_candidate": None}
    write_review(summary, result, output / "model-review.md")
    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def select(output: Path, candidate_name: str, review_note: str) -> dict:
    if not 10 <= len(review_note.strip()) <= 5000:
        raise InputError("请记录对差谱、杂相和晶胞/零点的具体审查（10–5000 字）")
    output = output.resolve()
    result = json.loads((output / "result.json").read_text(encoding="utf-8"))
    if result.get("workflow") != "skill" or result.get("selected_candidate"):
        raise InputError("此任务不是待选择的 skill 任务，或已经保存过选择结果")
    if candidate_name not in {c["name"] for c in result["candidates"] if c["eligible_for_selection"]}:
        raise InputError("候选没有通过 skill 数值门槛，不能保存为选定结果")
    scripts = skill_scripts()
    summary_path = output / "staging/Sample_run/candidate_summary.json"
    current_summary = json.loads(summary_path.read_text(encoding="utf-8"))
    if current_summary.get("selected_candidate") not in (None, candidate_name):
        raise InputError("此任务已生成另一模型的选择记录，请建立新任务以保留历史")
    if not current_summary.get("selected_candidate"):
        invoke(scripts, "select_refinement_candidate.py", ["--candidate-summary", str(summary_path), "--candidate", candidate_name, "--gsasii-path", os.environ["GSASII_DIR"]], output / "skill-select.log")
    summary = json.loads(summary_path.read_text(encoding="utf-8"))
    selected = summary["selected_files"]
    report = output / "refinement-report.md"
    validation = output / "report_validation.json"
    invoke(scripts, "build_validate_refinement_report.py", ["--candidate-summary", str(summary_path), "--write-report", str(report), "--validation-output", str(validation), "--replace"], output / "skill-report.log")
    if json.loads(validation.read_text(encoding="utf-8")).get("status") != "pass":
        raise RuntimeError("skill 报告校验未通过，未归档为选定结果")
    result["selected_candidate"] = candidate_name
    result["status"] = "selected_with_review_record"
    result["review_note"] = review_note.strip()
    write_review(summary, result, output / "model-review.md", candidate_name, review_note.strip())
    export_curves(Path(selected["gpx"]["path"]), output / "selected-curves")
    args = ["--sample-id", "Sample", "--cif-key", "supplied-model", "--archive-root", str(output / "archive"), "--source-cif", summary["inputs"]["cif"]["path"], "--result-cif", selected["result_cif"]["path"], "--instrument", summary["inputs"]["instrument"]["path"], "--xrd", summary["inputs"]["xrd"]["path"], "--gpx", selected["gpx"]["path"], "--lst", selected["lst"]["path"], "--report", str(report), "--candidate-summary", str(summary_path), "--report-validation", str(validation), "--extra", str(output / "model-review.md"), "--extra", str(output / "selected-curves/origin-curves.csv"), "--extra", str(output / "selected-curves/origin-reflections.csv"), "--extra", str(output / "selected-curves/refinement-plot.svg")]
    invoke(scripts, "archive_refinement_results.py", args, output / "skill-archive.log")
    (output / "result.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--select")
    parser.add_argument("--review-file", type=Path)
    args = parser.parse_args()
    try:
        result = select(args.output, args.select, args.review_file.read_text(encoding="utf-8")) if args.select and args.review_file else run(json.loads(args.input.read_text(encoding="utf-8")), args.output)
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (InputError, RuntimeError, OSError, ValueError, subprocess.TimeoutExpired) as error:
        print(str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
