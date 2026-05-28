import argparse
import base64
import json
import os
import sys

from http.server import BaseHTTPRequestHandler, HTTPServer


def load_image(path):
    if not os.path.exists(path):
        raise FileNotFoundError(path)

    with open(path, 'rb') as file:
        return base64.b64encode(file.read()).decode('ascii')


def detect_image(image_path):
    return {
        'success': True,
        'model': 'yolo11n.pt',
        'image': os.path.basename(image_path),
        'count': 0,
        'detections': []
    }


class SimpleHandler(BaseHTTPRequestHandler):
    def _send_json(self, payload, status=200):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != '/detect':
            self._send_json({'success': False, 'error': 'Not found'}, status=404)
            return

        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length).decode('utf-8')

        try:
            payload = json.loads(body)
            image_data = payload.get('image')

            if not image_data:
                raise ValueError('Missing image field')

            self._send_json({
                'success': True,
                'model': 'yolo11n.pt',
                'count': 0,
                'image': 'uploaded-image',
                'detections': []
            })
        except Exception as exc:
            self._send_json({'success': False, 'error': str(exc)}, status=400)


def run_server(port=8000):
    server = HTTPServer(('0.0.0.0', port), SimpleHandler)
    print(f'Python YOLO stub server listening on http://localhost:{port}/detect')
    server.serve_forever()


def main():
    parser = argparse.ArgumentParser(description='YOLO image detection stub')
    parser.add_argument('image_path', nargs='?', help='Optional image path for CLI mode')
    parser.add_argument('--json', action='store_true', help='Output JSON to stdout in CLI mode')
    parser.add_argument('--serve', action='store_true', help='Run a simple /detect HTTP server on port 8000')
    args = parser.parse_args()

    if args.serve:
        run_server()
        return

    if not args.image_path:
        parser.error('image_path is required unless --serve is passed')

    result = detect_image(args.image_path)

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(result)


if __name__ == '__main__':
    main()
