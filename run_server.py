from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import os, webbrowser, threading, time

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)

class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

server = ThreadingHTTPServer(('127.0.0.1', 0), NoCacheHandler)
port = server.server_address[1]
build = int(time.time())
url = f'http://127.0.0.1:{port}/?build={build}'
print(f'Dang chay BAN MOI tai: {url}')
print('Moi lan chay se dung mot cong trong moi. Nhan Ctrl+C de dung.')
threading.Timer(0.7, lambda: webbrowser.open(url)).start()
server.serve_forever()
