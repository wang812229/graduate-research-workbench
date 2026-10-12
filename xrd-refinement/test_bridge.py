import http.client
from http.server import ThreadingHTTPServer
import importlib.util
from pathlib import Path
import tempfile
import threading
import unittest

spec = importlib.util.spec_from_file_location("xrd_bridge", Path(__file__).with_name("bridge.py"))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), bridge.create_handler("test-token", Path(self.tmp.name)))
        thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)

    def request(self, method, headers=None, body=""):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)
        conn.request(method, "/refine", body=body, headers=headers or {})
        response = conn.getresponse()
        status = response.status
        response.read()
        header = response.getheader("Access-Control-Allow-Origin")
        conn.close()
        return status, header

    def test_wrong_origin_rejected(self):
        status, _ = self.request("POST", {"Origin": "https://evil.example", "Authorization": "Bearer test-token", "Content-Length": "2"}, "{}")
        self.assertEqual(status, 403)

    def test_wrong_token_rejected(self):
        status, _ = self.request("POST", {"Origin": "https://wang812229.github.io", "Authorization": "Bearer wrong", "Content-Length": "2"}, "{}")
        self.assertEqual(status, 403)

    def test_allowed_preflight(self):
        status, origin = self.request("OPTIONS", {"Origin": "https://wang812229.github.io"})
        self.assertEqual(status, 204)
        self.assertEqual(origin, "https://wang812229.github.io")


if __name__ == "__main__":
    unittest.main()
