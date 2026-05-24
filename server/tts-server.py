#!/usr/bin/env python3
"""Local TTS HTTP server using Piper TTS (ONNX, runs locally).

Usage: python3 server/tts-server.py [--port PORT]
"""

import sys
import io
import json
import time
import subprocess
import argparse
from pathlib import Path
from http.server import HTTPServer, BaseHTTPRequestHandler

PIPER_DIR = Path(__file__).resolve().parent.parent / 'bin' / 'piper'
PIPER_BIN = PIPER_DIR / 'piper'
MODEL_PATH = PIPER_DIR / 'zh_CN-huayan-medium.onnx'
ESPEAK_DATA = PIPER_DIR / 'espeak-ng-data'


def synthesize(text: str) -> bytes:
    """Run Piper TTS subprocess, return WAV bytes."""
    if not MODEL_PATH.exists():
        raise RuntimeError(f'Model not found: {MODEL_PATH}')
    if not PIPER_BIN.exists():
        raise RuntimeError(f'Piper binary not found: {PIPER_BIN}')

    env = {'LD_LIBRARY_PATH': str(PIPER_DIR)}
    if 'LD_LIBRARY_PATH' in __import__('os').environ:
        existing = __import__('os').environ['LD_LIBRARY_PATH']
        env['LD_LIBRARY_PATH'] = f"{PIPER_DIR}:{existing}"

    proc = subprocess.run(
        [
            str(PIPER_BIN),
            '--model', str(MODEL_PATH),
            '--output_file', '-',
            '--espeak_data', str(ESPEAK_DATA),
            '--quiet',
        ],
        input=text.encode('utf-8'),
        capture_output=True,
        timeout=30,
        env=env,
    )

    if proc.returncode != 0:
        stderr = proc.stderr.decode('utf-8', errors='replace').strip()
        raise RuntimeError(f'Piper exited {proc.returncode}: {stderr}')

    return proc.stdout


class TTSHandler(BaseHTTPRequestHandler):
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
            wav_data = synthesize(text)
            elapsed = time.time() - t0

            self._audio(200, wav_data, 'audio/wav', elapsed)
        except subprocess.TimeoutExpired:
            self._json(504, {'error': 'TTS timeout'})
        except Exception as e:
            self._json(500, {'error': str(e)})

    def do_GET(self):
        if self.path == '/health':
            self._json(200, {'status': 'ok'})
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
        sys.stderr.write(f"[TTS] {args[0]} {args[1]} {args[2]}\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=3004)
    args = parser.parse_args()

    server = HTTPServer(('0.0.0.0', args.port), TTSHandler)
    print(f"[TTS] Piper server running on http://localhost:{args.port}", flush=True)
    print(f"[TTS] Model: {MODEL_PATH}", flush=True)
    print(f"[TTS] Sample rate: 22050Hz, 16-bit, mono WAV", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == '__main__':
    main()
