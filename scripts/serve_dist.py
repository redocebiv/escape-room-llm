"""Serve dist/ under /escape-room-llm/, the same subpath GitHub Pages uses.

Serving from the root would hide the one class of bug that only appears once
deployed: an absolute asset path such as "/js/app.js", which works locally
and 404s on Pages. Anything outside the prefix is a 404 here too.

Usage: python3 scripts/serve_dist.py [port]
"""

import functools
import http.server
import pathlib
import sys

DIST = pathlib.Path(__file__).resolve().parent.parent / "dist"
PREFIX = "/escape-room-llm"


class PagesLikeHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".json": "application/json",
    }

    def do_GET(self):
        # Pages redirects the bare prefix to the slash form; relative URLs depend on it.
        if self.path.split("?")[0] == PREFIX:
            self.send_response(301)
            self.send_header("Location", PREFIX + "/")
            self.end_headers()
            return
        super().do_GET()

    def translate_path(self, path):
        if path.startswith(PREFIX + "/"):
            path = path[len(PREFIX):]
        else:
            path = "/__outside_the_site__"
        return super().translate_path(path)

    def log_message(self, *args):
        pass


class QuietServer(http.server.ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        # A browser that navigates away mid-download closes the socket. That is
        # normal — the E2E suite does it on purpose — not an error worth a
        # traceback that reads like a failure in CI logs.
        if isinstance(sys.exc_info()[1], (BrokenPipeError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
    handler = functools.partial(PagesLikeHandler, directory=str(DIST))
    print(f"serving {DIST} at http://127.0.0.1:{port}{PREFIX}/")
    QuietServer(("127.0.0.1", port), handler).serve_forever()
