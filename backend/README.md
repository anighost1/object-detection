# Node.js Socket Backend

Realtime Socket.IO backend that communicates with a persistent Python YOLO worker using `child_process`.

---

# Features

* Socket.IO realtime communication
* Persistent Python worker
* YOLO object detection
* Cross-platform Python path support
* Next.js compatible
* Optimized for realtime webcam detection

---

# Project Structure

```text
backend/
├── server.js
├── package.json
└── README.md
```

---

# Installation

```bash
npm install
```

---

# Required Packages

```bash
npm install express socket.io
```

---

# Start Backend

```bash
npm start
```

Expected output:

```text
Starting Python YOLO worker...
[PYTHON] Loading YOLO model...
[PYTHON] YOLO model loaded.
[PYTHON] Python YOLO worker ready.
Server running on port 3000
```

---

# Socket Events

## Incoming Event

```text
detect-frame
```

Payload:

```json
{
  "frameId": 1,
  "image": "BASE64_IMAGE"
}
```

---

## Outgoing Event

```text
detection-result
```

Payload:

```json
{
  "success": true,
  "frameId": 1,
  "count": 1,
  "detections": [
    {
      "label": "person",
      "confidence": 0.93,
      "bbox": {
        "x1": 100,
        "y1": 50,
        "x2": 300,
        "y2": 400
      }
    }
  ]
}
```

---

# Architecture

```text
Next.js Frontend
        ↓ socket.io
Node.js Backend
        ↓ child_process stdin/stdout
Python YOLO Worker
```

---

# Notes

* Python worker is started automatically by Node.js
* Do NOT manually run `worker.py`
* YOLO model loads only once for better performance

---

# Environment Variables

Optional:

```env
PORT=3000
```

---

# Production Recommendation

Use:

* PM2
* Docker
* Nginx reverse proxy

for production deployment.
