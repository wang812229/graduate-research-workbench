"""Opt-in end-to-end GSAS-II validation with official PbSO4 tutorial files.

Run with the GSAS-II Python and activated Conda DLL paths. Prepare data-dir
with PBSO4.xy (converted by GSAS-II from PBSO4.XRA), INST_XRY.PRM and
PbSO4-Wyckoff.cif. This is not a CI mock and needs the actual GSAS-II engine.
"""
from __future__ import annotations

import argparse
import base64
from http.server import ThreadingHTTPServer
import io
import json
from pathlib import Path
from threading import Thread
import urllib.error
import urllib.request
import zipfile

from bridge import create_handler


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-dir", required=True, type=Path)
    args = parser.parse_args()
    data = args.data_dir.resolve()
    named = {
        "pattern": data / "PBSO4.xy",
        "instrument": data / "INST_XRY.PRM",
        "structure": data / "PbSO4-Wyckoff.cif",
    }
    if not all(path.is_file() for path in named.values()):
        raise SystemExit("缺少官方 PbSO4.xy、INST_XRY.PRM 或 PbSO4-Wyckoff.cif")
    payload = {
        "files": {kind: {"name": path.name, "base64": base64.b64encode(path.read_bytes()).decode("ascii")}
                  for kind, path in named.items()},
        "confirm_structure_match": True,
        "confirm_instrument_calibrated": True,
        "refine_cell": True,
        "refine_profile": False,
        "background_terms": 4,
    }
    token = "offline-validation-only"
    server = ThreadingHTTPServer(("127.0.0.1", 0), create_handler(token, data / "bridge-validation"))
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        request = urllib.request.Request(
            f"http://127.0.0.1:{server.server_port}/refine",
            data=json.dumps(payload).encode("utf-8"),
            headers={"Origin": "https://wang812229.github.io", "Authorization": f"Bearer {token}",
                     "Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                body = json.load(response)
        except urllib.error.HTTPError as error:
            raise RuntimeError(error.read().decode("utf-8")) from error
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    result = body["result"]
    with zipfile.ZipFile(io.BytesIO(base64.b64decode(body["zip_base64"]))) as archive:
        files = set(archive.namelist())
        required = {"refinement.gpx", "refinement.lst", "stage-1.gpx", "stage-2.gpx",
                    "origin-curves.csv", "refinement-plot.svg", "refined-structure.cif", "result.json"}
        if not required <= files:
            raise RuntimeError(f"下载包缺少: {sorted(required-files)}")
        lines = archive.read("origin-curves.csv").decode("utf-8-sig").splitlines()
        if len(lines) != result["points"] + 1:
            raise RuntimeError("Origin 曲线行数与 GSAS-II 实测点数不符")
    if result["engine"] != "GSAS-II GSASIIscriptable" or result["points"] != 6000:
        raise RuntimeError("引擎标识或官方样例点数不符")
    print(json.dumps({"engine": result["engine"], "points": result["points"],
                      "stage_wR_percent": [stage["wR_percent"] for stage in result["stages"]],
                      "zip_files": sorted(files)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
