"""Windows durability adapter for upstream skill archive transactions.

Python fsync on a Windows read-only descriptor raises EBADF; POSIX directory
fsync also has no portable Windows equivalent. Flush writable file handles
and install the new sibling archive with Win32 MOVEFILE_WRITE_THROUGH.
Upstream copy/hash/report verification runs unchanged. Existing archives
cannot be overwritten through this adapter.
"""
import ctypes
import importlib.util
import json
import os
from pathlib import Path
import sys

driver = Path(sys.argv[1]).resolve(strict=True)
sys.path.insert(0, str(driver.parent))
spec = importlib.util.spec_from_file_location("yanxi_upstream_archive", driver)
upstream = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upstream)


def flush_file(path):
    with Path(path).open("r+b") as stream:
        stream.flush()
        os.fsync(stream.fileno())


def flush_directory_record(directory):
    # Retain an explicit record rather than pretending Windows supports POSIX
    # directory fsync. The final directory install is write-through below.
    marker = Path(directory) / ".windows-durability.json"
    with marker.open("w+b") as stream:
        stream.write(json.dumps({"file_flush": "writable descriptor os.fsync", "directory_install": "MoveFileExW MOVEFILE_WRITE_THROUGH", "existing_archive_replace": False}).encode())
        stream.flush()
        os.fsync(stream.fileno())


def install_new_archive(temporary, destination, *, replace=False):
    temporary, destination = Path(temporary).resolve(), Path(destination).resolve()
    if temporary.parent != destination.parent or temporary == destination or not temporary.is_dir():
        raise RuntimeError("Archive transaction must use distinct sibling directories")
    if destination.exists() or replace:
        raise RuntimeError("Existing archives are preserved; use a new job directory")
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    move = kernel.MoveFileExW
    move.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_ulong]
    move.restype = ctypes.c_int
    if not move(str(temporary), str(destination), 0x8):
        raise ctypes.WinError(ctypes.get_last_error())


upstream.fsync_file = flush_file
upstream.fsync_directory = flush_directory_record
upstream.atomic_install = install_new_archive
sys.argv = [str(driver), *sys.argv[2:]]
raise SystemExit(upstream.main())
