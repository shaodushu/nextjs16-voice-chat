#!/usr/bin/env python3
"""Cloud ASR HTTP server using SenseVoiceSmall via API.

Usage:
  python3 server/asr-cloud-server.py [--port PORT]

Environment:
  ASR_API_URL - API base URL (default: http://ai-platform.xwfintech.com/v1)
  ASR_API_KEY - API key
  ASR_MODEL - Model name (default: SenseVoiceSmall)
"""

import sys
import json
import time
import os
import argparse
import traceback
import base64
import tempfile
import re
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
import urllib.request
import urllib.error


def _load_env_file(path: str):
    """Load .env.local file into os.environ if not already set."""
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            m = re.match(r'^([A-Za-z0-9_]+)=(.*)$', line)
            if m:
                key, val = m.group(1), m.group(2).strip('"\'')
                if key not in os.environ:
                    os.environ[key] = val


_load_env_file(os.path.join(os.path.dirname(__file__), '..', '.env.local'))


class ASRCloudHandler(BaseHTTPRequestHandler):
    api_url = None
    api_key = None
    model = None
    language = 'zh'

    def do_POST(self):
        if self.path != '/asr':
            self.send_error(404)
            return

        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)

        if not body:
            self._json(400, {'error': 'empty body'})
            return

        try:
            t0 = time.time()

            # Save audio to temp file for multipart upload
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
                f.write(body)
                temp_path = f.name

            try:
                # Build multipart form data manually
                boundary = '----ASRBoundary7MA4YWxkTrZu0gW'

                # Form fields
                fields = [
                    ('model', self.model),
                    ('language', self.language),
                    ('response_format', 'json'),
                ]

                # Build body parts
                lines = []
                for name, value in fields:
                    lines.append(f'--{boundary}')
                    lines.append(f'Content-Disposition: form-data; name="{name}"')
                    lines.append('')
                    lines.append(value)

                # Add file
                lines.append(f'--{boundary}')
                lines.append('Content-Disposition: form-data; name="file"; filename="audio.wav"')
                lines.append('Content-Type: audio/wav')
                lines.append('')

                # Read file content
                with open(temp_path, 'rb') as f:
                    file_content = f.read()

                # Build final body
                body_start = '\r\n'.join(lines).encode('utf-8')
                body_end = f'\r\n--{boundary}--\r\n'.encode('utf-8')
                payload = body_start + b'\r\n' + file_content + b'\r\n' + body_end

                # Prepare API request
                api_endpoint = f"{self.api_url}/audio/transcriptions"

                req = urllib.request.Request(
                    api_endpoint,
                    data=payload,
                    headers={
                        'Content-Type': f'multipart/form-data; boundary={boundary}',
                        'Authorization': f'Bearer {self.api_key}'
                    },
                    method='POST'
                )

                with urllib.request.urlopen(req, timeout=30) as response:
                    result = json.loads(response.read().decode('utf-8'))
                    text = result.get('text', '')

                elapsed = time.time() - t0

                self._json(200, {
                    'text': text.strip(),
                    'duration': round(elapsed, 2),
                })
            finally:
                os.unlink(temp_path)

        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8')
            print(f"[ASR] API error: {e.code} {error_body}", flush=True)
            self._json(500, {'error': f'ASR API error: {e.code}', 'details': error_body})
        except Exception as e:
            traceback.print_exc()
            self._json(500, {'error': str(e)})

    def do_GET(self):
        if self.path == '/health':
            self._json(200, {'status': 'ok', 'mode': 'cloud'})
        else:
            self.send_error(404)

    def _json(self, status: int, data: dict):
        body = json.dumps(data, ensure_ascii=False).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        sys.stderr.write(f"[ASR-Cloud] {args[0]} {args[1]} {args[2]}\n")


def main():
    parser = argparse.ArgumentParser(description='Cloud ASR server')
    parser.add_argument('--port', type=int, default=3003)
    args = parser.parse_args()

    # Load from environment
    api_url = os.environ.get('ASR_API_URL', os.environ.get('DEEPSEEK_API_URL', 'http://ai-platform.xwfintech.com/v1'))
    api_key = os.environ.get('ASR_API_KEY', os.environ.get('DEEPSEEK_API_KEY', ''))
    model = os.environ.get('ASR_MODEL', 'SenseVoiceSmall')

    if not api_key:
        print("[ASR-Cloud] Error: ASR_API_KEY or DEEPSEEK_API_KEY must be set", flush=True)
        sys.exit(1)

    ASRCloudHandler.api_url = api_url.rstrip('/')
    ASRCloudHandler.api_key = api_key
    ASRCloudHandler.model = model
    ASRCloudHandler.language = os.environ.get('ASR_LANGUAGE', 'zh')

    print(f'[ASR-Cloud] Using API: {api_url}', flush=True)
    print(f'[ASR-Cloud] Model: {model}', flush=True)
    print(f'[ASR-Cloud] Language: {ASRCloudHandler.language}', flush=True)

    server = ThreadingHTTPServer(('0.0.0.0', args.port), ASRCloudHandler)
    print(f'[ASR-Cloud] Server running on http://localhost:{args.port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == '__main__':
    main()
