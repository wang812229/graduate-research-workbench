"""Loopback-only bridge between the static workbench and installed GSAS-II.

Start with the Python interpreter that imports GSAS-II. The one-time bearer
token printed to the terminal must be entered in the browser. No cloud upload.
"""
from __future__ import annotations

import argparse
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
from pathlib import Path
import secrets
import subprocess
import sys
import uuid
import zipfile


ALLOWED_ORIGINS = {
    "https://wang812229.github.io",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
}
EXTENSIONS = {
    "pattern": {".xy", ".xye", ".csv", ".txt"},
    "structure": {".cif"},
    "instrument": {".instprm", ".prm"},
    "card": {".csv", ".txt", ".xy", ".xye"},
}
MAX_REQUEST = 90 * 1024 * 1024


def create_handler(token: str, work_dir: Path):
    class Handler(BaseHTTPRequestHandler):
        def _response(self, code, payload):
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            if self.headers.get("Origin") in ALLOWED_ORIGINS:
                self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
                self.send_header("Access-Control-Allow-Private-Network", "true")
                self.send_header("Vary", "Origin")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _authorized(self):
            return self.headers.get("Origin") in ALLOWED_ORIGINS and secrets.compare_digest(
                self.headers.get("Authorization", ""), f"Bearer {token}"
            )

        def do_OPTIONS(self):
            if self.headers.get("Origin") not in ALLOWED_ORIGINS:
                return self._response(403, {"error": "网站来源未获准"})
            self.send_response(204)
            self.send_header("Access-Control-Allow-Origin", self.headers["Origin"])
            self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.end_headers()

        def do_POST(self):
            if self.path != "/refine" or not self._authorized():
                return self._response(403, {"error": "本地精修服务令牌或来源不正确"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 1 <= length <= MAX_REQUEST:
                    return self._response(413, {"error": "请求过大或为空"})
                request = json.loads(self.rfile.read(length))
                files = request.pop("files")
                if not isinstance(files, dict) or not all(k in files for k in ("pattern", "structure", "instrument")):
                    raise ValueError("需提交 XRD 实测曲线、结构 CIF 和仪器参数")
                if set(files) - set(EXTENSIONS):
                    raise ValueError("未知文件类型")
                job_dir = work_dir / uuid.uuid4().hex
                job_dir.mkdir(parents=True, exist_ok=False)
                for kind, entry in files.items():
                    name = Path(entry["name"]).name
                    suffix = Path(name).suffix.lower()
                    if suffix not in EXTENSIONS[kind]:
                        raise ValueError(f"{kind} 扩展名不支持")
                    data = base64.b64decode(entry["base64"], validate=True)
                    if not 0 < len(data) <= 30 * 1024 * 1024:
                        raise ValueError(f"{kind} 必须非空且不超过 30 MB")
                    path = job_dir / f"input-{kind}{suffix}"
                    path.write_bytes(data)
                    request[kind] = str(path)
                manifest = job_dir / "job.json"
                manifest.write_text(json.dumps(request, ensure_ascii=False, indent=2), encoding="utf-8")
                output = job_dir / "output"
                completed = subprocess.run(
                    [sys.executable, str(Path(__file__).with_name("runner.py")), "--input", str(manifest), "--output", str(output)],
                    capture_output=True, text=True, timeout=900, check=False, cwd=job_dir,
                )
                if completed.returncode != 0:
                    return self._response(422, {"error": completed.stderr[-3000:] or "GSAS-II 精修失败", "local_directory": str(job_dir)})
                result = json.loads((output / "result.json").read_text(encoding="utf-8"))
                archive = io.BytesIO()
                with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zipped:
                    for path in sorted(output.iterdir()):
                        if path.is_file() and not path.name.startswith("stage-"):
                            zipped.write(path, path.name)
                return self._response(200, {"result": result, "zip_base64": base64.b64encode(archive.getvalue()).decode("ascii"), "local_directory": str(job_dir)})
            except subprocess.TimeoutExpired:
                self._response(504, {"error": "GSAS-II 运行超过 15 分钟，已终止；请在本地检查模型"})
            except (ValueError, KeyError, TypeError, OSError) as exc:
                self._response(400, {"error": str(exc)})

        def log_message(self, format, *args):
            # Do not print names of private sample files or bearer tokens.
            pass

    return Handler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--work-dir", type=Path, default=Path.home() / "Documents" / "Yanxi-XRD")
    args = parser.parse_args()
    args.work_dir.mkdir(parents=True, exist_ok=True)
    token = secrets.token_urlsafe(32)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), create_handler(token, args.work_dir))
    print(f"仅本机服务：http://127.0.0.1:{args.port}/refine", flush=True)
    print(f"本次启动令牌：{token}", flush=True)
    print("原始数据与结果只保存在：" + str(args.work_dir), flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
