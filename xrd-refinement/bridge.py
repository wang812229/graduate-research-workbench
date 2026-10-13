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
import os
import re
import signal
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


def run_engine(command, *, timeout, cwd):
    """Bound a job and terminate its child refinement processes on timeout."""
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               text=True, encoding="utf-8", errors="replace", cwd=cwd,
                               start_new_session=os.name != "nt",
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        if os.name == "nt":
            subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                           capture_output=True, check=False,
                           creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        else:
            os.killpg(process.pid, signal.SIGKILL)
        if process.poll() is None:
            process.kill()
        process.communicate()
        raise
    return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)


def create_handler(token: str, work_dir: Path):
    class Handler(BaseHTTPRequestHandler):
        def _package(self, output, job_dir):
            result = json.loads((output / "result.json").read_text(encoding="utf-8"))
            archive = io.BytesIO()
            paths = [path for path in sorted(output.rglob("*")) if path.is_file() and not path.is_symlink() and ".bak" not in path.name]
            if sum(path.stat().st_size for path in paths) > 150 * 1024 * 1024:
                raise ValueError("结果超过 150 MB；请在本地任务目录读取并按候选拆分导出")
            with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as zipped:
                for path in paths:
                    zipped.write(path, str(path.relative_to(output)).replace("\\", "/"))
            previews = {}
            for candidate in result.get("candidates", []):
                if re.fullmatch(r"[a-z0-9_]{1,80}", candidate["name"]):
                    path = output / "curves" / candidate["name"] / "refinement-plot.svg"
                    if path.is_file() and path.stat().st_size < 2 * 1024 * 1024:
                        previews[candidate["name"]] = path.read_text(encoding="utf-8")
            return {"result": result, "zip_base64": base64.b64encode(archive.getvalue()).decode("ascii"), "preview_svg": previews, "local_directory": str(job_dir), "job_id": job_dir.name}

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
            if self.path not in {"/refine", "/select"} or not self._authorized():
                return self._response(403, {"error": "本地精修服务令牌或来源不正确"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 1 <= length <= MAX_REQUEST:
                    return self._response(413, {"error": "请求过大或为空"})
                request = json.loads(self.rfile.read(length))
                if self.path == "/select":
                    job_id = request.get("job_id", "")
                    if not isinstance(job_id, str) or not re.fullmatch(r"[a-f0-9]{32}", job_id):
                        raise ValueError("精修任务编号无效")
                    job_dir = (work_dir / job_id).resolve(strict=True)
                    if not job_dir.is_relative_to(work_dir.resolve()) or job_dir.is_symlink():
                        raise ValueError("精修任务目录无效")
                    output = job_dir / "output"
                    review = request.get("review_note", "")
                    if not isinstance(review, str) or not 10 <= len(review.strip()) <= 5000:
                        raise ValueError("请填写 10–5000 字的候选模型审查记录")
                    candidate = request.get("candidate", "")
                    if not isinstance(candidate, str) or not re.fullmatch(r"[a-z0-9_]{1,80}", candidate):
                        raise ValueError("候选模型名称无效")
                    review_file = job_dir / "researcher-review.txt"
                    review_file.write_text(review.strip(), encoding="utf-8")
                    completed = run_engine([sys.executable, str(Path(__file__).with_name("skill_adapter.py")), "--output", str(output), "--select", candidate, "--review-file", str(review_file)], timeout=900, cwd=job_dir)
                    if completed.returncode:
                        return self._response(422, {"error": completed.stderr[-3000:] or "skill 候选选择失败", "local_directory": str(job_dir)})
                    return self._response(200, self._package(output, job_dir))
                files = request.pop("files")
                if not isinstance(files, dict) or not all(k in files for k in ("pattern", "structure", "instrument")):
                    raise ValueError("需提交 XRD 实测曲线、结构 CIF 和仪器参数")
                if set(files) - set(EXTENSIONS):
                    raise ValueError("未知文件类型")
                if request.get("workflow", "basic") not in {"basic", "skill"}:
                    raise ValueError("未知精修流程")
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
                completed = run_engine(
                    [sys.executable, str(Path(__file__).with_name("skill_adapter.py" if request.get("workflow") == "skill" else "runner.py")), "--input", str(manifest), "--output", str(output)],
                    timeout=1800, cwd=job_dir,
                )
                if completed.returncode != 0:
                    return self._response(422, {"error": completed.stderr[-3000:] or "GSAS-II 精修失败", "local_directory": str(job_dir)})
                return self._response(200, self._package(output, job_dir))
            except subprocess.TimeoutExpired:
                self._response(504, {"error": "精修或归档超过允许时间，已终止任务进程；请在本地任务目录检查模型与日志"})
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
