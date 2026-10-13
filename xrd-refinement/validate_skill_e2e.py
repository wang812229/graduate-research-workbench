"""Manual real-engine acceptance test using official public PbSO4 measurements.

Run in the independent runtime with GSASII_DIR and YANXI_GSAS_SKILL set.
Not run as a simulated refinement in CI. No user sample is required or used.
"""
import argparse
import base64
import csv
from http.server import ThreadingHTTPServer
import io
import json
import math
import os
from pathlib import Path
import secrets
import subprocess
import sys
import threading
import urllib.error
import urllib.request
import zipfile
from bridge import create_handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    args = parser.parse_args()
    data, output = args.data_dir.resolve(), args.output_dir.resolve()
    classifier = Path(os.environ["YANXI_GSAS_SKILL"]) / "scripts/classify_refinement_request.py"
    classification = json.loads(subprocess.check_output([sys.executable, str(classifier), "--pattern", str(data / "PBSO4.XRA"), "--declared-mode", "single"], text=True))
    if classification.get("status") != "ready":
        raise RuntimeError("官方样例未通过 skill 分类")
    from GSASII import GSASIIscriptable as G2
    output.mkdir(parents=True, exist_ok=False)
    project = G2.G2Project(newgpx=str(output / "imported-official.gpx"))
    hist = project.add_powder_histogram(str(data / "PBSO4.XRA"), str(data / "INST_XRY.PRM"), fmthint="GSAS")
    xs, ys, weights = (hist.getdata(key) for key in ("X", "Yobs", "Yweight"))
    pattern = output / "official-measured.xye"
    pattern.write_text("# 2theta intensity sigma from official GSAS weights\n" + "".join(f"{float(x):.9g} {float(y):.12g} {math.sqrt(1/float(w)):.12g}\n" for x, y, w in zip(xs, ys, weights) if w > 0), encoding="utf-8")
    token = secrets.token_hex(24)
    server = ThreadingHTTPServer(("127.0.0.1", 0), create_handler(token, output / "jobs"))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    def request(path, payload):
        req = urllib.request.Request(f"http://127.0.0.1:{server.server_port}/{path}", data=json.dumps(payload).encode(), headers={"Origin": "http://localhost:8080", "Authorization": f"Bearer {token}", "Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=1800) as response:
            return json.load(response)
    try:
        files = {kind: {"name": path.name, "base64": base64.b64encode(path.read_bytes()).decode()} for kind, path in {"pattern": pattern, "structure": data / "PbSO4-Wyckoff.cif", "instrument": data / "INST_XRY.PRM"}.items()}
        payload = request("refine", {"files": files, "workflow": "skill", "background_terms": 6, "confirm_structure_match": True, "confirm_instrument_calibrated": True})
        result = payload["result"]
        if result["workflow"] != "skill" or len(result["candidates"]) != 6 or result["points"] != 6000:
            raise RuntimeError("没有完成 6000 点的六分支真实 skill 精修")
        if Path(result["engine_source"]).resolve() != Path(os.environ["GSASII_DIR"]).resolve():
            raise RuntimeError("没有使用声明的独立引擎")
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(payload["zip_base64"]))) as archive:
            for candidate in result["candidates"]:
                if candidate["status"] != "succeeded":
                    continue
                rows = list(csv.reader(io.StringIO(archive.read(candidate["curves"]).decode("utf-8-sig"))))
                if len(rows) != 6001 or rows[0][0] != "2theta_deg":
                    raise RuntimeError("候选 Origin CSV 与实测点数不符")
        blocked = next((c for c in result["candidates"] if not c["eligible_for_selection"]), None)
        if blocked:
            try:
                request("select", {"job_id": payload["job_id"], "candidate": blocked["name"], "review_note": "验收用：此分支未通过数值门槛，应拒绝选择。"})
            except urllib.error.HTTPError as error:
                if error.code != 422:
                    raise
            else:
                raise RuntimeError("不合格候选被错误接受")
        candidate = min((c for c in result["candidates"] if c["eligible_for_selection"]), key=lambda c: c["Rwp"])
        final = request("select", {"job_id": payload["job_id"], "candidate": candidate["name"], "review_note": "官方 PbSO4 工程验收：此分支数值通过但强峰仍有明显残差，不能作为结构确认；仅验证候选选择、报告与归档输出。"})
        with zipfile.ZipFile(io.BytesIO(base64.b64decode(final["zip_base64"]))) as archive:
            validation = json.loads(archive.read("report_validation.json"))
            if validation.get("status") != "pass" or not any(name.startswith("archive/") and name.endswith("manifest.json") for name in archive.namelist()):
                raise RuntimeError("报告或最终档案没有通过实际校验")
        summary = {"engine_source": result["engine_source"], "python": result["python"], "points": result["points"], "candidate_Rwp_percent": {c["name"]: c["Rwp"] for c in result["candidates"]}, "selection_blocked": blocked["name"] if blocked else None, "selected_for_engineering_test": candidate["name"], "report_validation": "pass", "output_dir": str(output)}
        (output / "acceptance.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(summary, ensure_ascii=False, indent=2))
    finally:
        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    main()
