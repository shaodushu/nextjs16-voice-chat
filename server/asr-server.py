#!/usr/bin/env python3
"""Local ASR HTTP server using FunASR SenseVoice.

Usage:
  python3 server/asr-server.py [--port PORT] [--model MODEL] [--itn]

Improvements over baseline:
  - ThreadingHTTPServer for concurrent requests
  - Automatic tempfile cleanup (NamedTemporaryFile + os.unlink)
  - Hot Model

Models (larger = more accurate but slower):
  - iic/SenseVoiceSmall     (default, fast, reasonable accuracy)
  - iic/speech_paraformer_asr-enhance  (larger, better accuracy)
  - iic/speech_seaco_paraformer_large  (best accuracy, slowest)
"""

import sys
import json
import time
import os
import tempfile
import argparse
import traceback
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from funasr import AutoModel
from funasr.utils.postprocess_utils import rich_transcription_postprocess


class ASRHandler(BaseHTTPRequestHandler):
    model = None
    use_itn = True
    language = 'zh'
    hotwords = None

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

            # Write to temp file then pass path — FunASR needs file path
            # (direct bytes/numpy array causes numpy version conflict in native code)
            with tempfile.NamedTemporaryFile(suffix='.wav', delete=False) as f:
                f.write(body)
                temp_path = f.name

            try:
                kwargs = dict(
                    input=temp_path,
                    language=self.language,
                    use_itn=self.use_itn,
                    disable_pbar=True,
                    ban_emoji=True,
                )
                if self.hotwords:
                    kwargs['hotword'] = self.hotwords
                res = self.model.generate(**kwargs)
            finally:
                __import__('os').unlink(temp_path)

            raw_text = res[0]["text"] if res else ""
            text = rich_transcription_postprocess(raw_text)
            elapsed = time.time() - t0

            self._json(200, {
                'text': text.strip(),
                'duration': round(elapsed, 2),
            })
        except Exception as e:
            traceback.print_exc()
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

    def log_message(self, fmt, *args):
        sys.stderr.write(f"[ASR] {args[0]} {args[1]} {args[2]}\n")


def main():
    parser = argparse.ArgumentParser(description='Local ASR server')
    parser.add_argument('--port', type=int, default=3003)
    parser.add_argument('--model', type=str, default='iic/SenseVoiceSmall',
                        help='FunASR model name')
    parser.add_argument('--no-itn', action='store_true',
                        help='Disable inverse text normalization')
    args = parser.parse_args()

    # Environment variable overrides (CLI args take precedence)
    model_name = args.model or os.environ.get('ASR_MODEL', 'iic/SenseVoiceSmall')
    language = os.environ.get('ASR_LANGUAGE', 'zh')
    if args.no_itn:
        use_itn = False
    else:
        use_itn = os.environ.get('ASR_ITN', '1') == '1'

    # Hotword support (comma-separated from env var)
    hotword_str = os.environ.get('ASR_HOTWORD', '')
    hotwords = [w.strip() for w in hotword_str.split(',') if w.strip()] if hotword_str else None

    # Server-side VAD (FSMN-VAD) — disabled by default due to numpy 1.26 incompatibility
    # Set ASR_VAD_MODEL=fsmn-vad to enable (requires compatible numpy version)
    vad_model = os.environ.get('ASR_VAD_MODEL', '')
    if not vad_model:
        vad_model = None
    vad_kwargs = {'max_single_segment_time': 60000}

    print(f'[ASR] Loading {model_name}...', flush=True)
    t0 = time.time()
    model = AutoModel(
        model=model_name,
        trust_remote_code=True,
        device='cpu',
        disable_update=True,
        disable_pbar=True,
        vad_model=vad_model,
        vad_kwargs=vad_kwargs if vad_model else {},
    )
    ASRHandler.model = model
    ASRHandler.use_itn = use_itn
    ASRHandler.language = language
    ASRHandler.hotwords = hotwords
    print(
        f'[ASR] Model loaded in {time.time()-t0:.1f}s '
        f'(ITN={"on" if use_itn else "off"}, '
        f'VAD={vad_model or "off"}, '
        f'hotwords={hotwords})',
        flush=True,
    )

    server = ThreadingHTTPServer(('0.0.0.0', args.port), ASRHandler)
    print(f'[ASR] Server running on http://localhost:{args.port}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == '__main__':
    main()
