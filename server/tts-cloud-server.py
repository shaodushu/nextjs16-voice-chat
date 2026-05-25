#!/usr/bin/env python3
"""Cloud TTS HTTP server using IndexTTS-1.5 via API.

Usage:
  python3 server/tts-cloud-server.py [--port PORT]

Environment:
  TTS_API_URL - API base URL (default: http://ai-platform.xwfintech.com/v1)
  TTS_API_KEY - API key
  TTS_MODEL - Model name (default: IndexTTS-1.5)
  TTS_VOICE - Voice name (default: 杜小雯)
"""

import sys
import json
import time
import os
import argparse
import traceback
import base64
import re
from http.server import HTTPServer, BaseHTTPRequestHandler
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


class TTSCloudHandler(BaseHTTPRequestHandler):
    api_url = None
    api_key = None
    model = None
    voice = None

    def do_POST(self):
        if self.path != '/tts':
            self.send_error(404)
            return

        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length)

        if not body:
            self._json(400, {'error': 'empty body'})
            return

        try:
            data = json.loads(body)
            text = data.get('text', '').strip()
            if not text:
                self._json(400, {'error': 'empty text'})
                return

            t0 = time.time()

            # Prepare API request
            api_endpoint = f"{self.api_url}/audio/speech"
            payload = json.dumps({
                'model': self.model,
                'input': text,
                'voice': self.voice,
                'response_format': 'wav'
            }).encode('utf-8')

            req = urllib.request.Request(
                api_endpoint,
                data=payload,
                headers={
                    'Content-Type': 'application/json',
                    'Authorization': f'Bearer {self.api_key}'
                },
                method='POST'
            )

            with urllib.request.urlopen(req, timeout=60) as response:
                # API returns binary WAV data directly
                content_type = response.headers.get('Content-Type', '')
                if 'application/json' in content_type:
                    # JSON response with base64 audio
                    result = json.loads(response.read().decode('utf-8'))
                    audio_base64 = result.get('audio', '')
                    wav_data = base64.b64decode(audio_base64) if audio_base64 else b''
                else:
                    # Binary response (WAV data directly)
                    wav_data = response.read()

            elapsed = time.time() - t0

            if wav_data:
                self._audio(200, wav_data, 'audio/wav', elapsed)
            else:
                self._json(500, {'error': 'Empty audio response'})

        except urllib.error.HTTPError as e:
            error_body = e.read().decode('utf-8')
            print(f"[TTS] API error: {e.code} {error_body}")
            self._json(500, {'error': f'TTS API error: {e.code}'})
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

    def _audio(self, status: int, audio_data: bytes, content_type: str, duration_s: float):
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('X-Duration', str(round(duration_s, 2)))
        self.send_header('Content-Length', str(len(audio_data)))
        self.end_headers()
        self.wfile.write(audio_data)

    def log_message(self, fmt, *args):
        sys.stderr.write(f"[TTS-Cloud] {args[0]} {args[1]} {args[2]}\n")


def main():
    parser = argparse.ArgumentParser(description='Cloud TTS server')
    parser.add_argument('--port', type=int, default=3004)
    args = parser.parse_args()

    # Load from environment
    api_url = os.environ.get('TTS_API_URL', os.environ.get('DEEPSEEK_API_URL', 'http://ai-platform.xwfintech.com/v1'))
    api_key = os.environ.get('TTS_API_KEY', os.environ.get('DEEPSEEK_API_KEY', ''))
    model = os.environ.get('TTS_MODEL', 'IndexTTS-1.5')
    voice = os.environ.get('TTS_VOICE', '杜小雯')

    if not api_key:
        print("[TTS-Cloud] Error: TTS_API_KEY or DEEPSEEK_API_KEY must be set", flush=True)
        sys.exit(1)

    TTSCloudHandler.api_url = api_url.rstrip('/')
    TTSCloudHandler.api_key = api_key
    TTSCloudHandler.model = model
    TTSCloudHandler.voice = voice

    print(f'[TTS-Cloud] Using API: {api_url}', flush=True)
    print(f'[TTS-Cloud] Model: {model}', flush=True)
    print(f'[TTS-Cloud] Voice: {voice}', flush=True)

    server = HTTPServer(('0.0.0.0', args.port), TTSCloudHandler)
    print(f'[TTS-Cloud] Server running on http://localhost:{args.port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == '__main__':
    main()
