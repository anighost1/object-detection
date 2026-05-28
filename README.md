# Realtime YOLO Detection Monorepo

Realtime object detection system using:

* Next.js frontend
* Node.js Socket.IO backend
* Persistent Python YOLO worker

Designed for:

* realtime webcam AI
* object detection
* drone vision
* surveillance systems
* computer vision experiments

---

# Architecture

```text
Frontend (Next.js)
        ↓ socket.io
Backend (Node.js)
        ↓ child_process stdin/stdout
Python YOLO Worker
        ↓
YOLO Inference
```

The Python worker stays alive permanently.

YOLO loads only once.

This avoids:

* repeated model loading
* API overhead
* extra websocket servers

---

# Monorepo Structure

```text
testBox/
│
├── frontend/
│   ├── app/
│   ├── package.json
│   └── README.md
│
├── backend/
│   ├── server.js
│   ├── package.json
│   └── README.md
│
├── detectionservice/
│   ├── .venv/
│   ├── worker.py
│   ├── requirements.txt
│   ├── yolo11n.pt
│   └── README.md
│
└── README.md
```

---

# Features

## Frontend

* Webcam streaming
* Live detection overlay
* Socket.IO realtime communication
* Canvas rendering
* JPEG frame compression

---

## Backend

* Socket.IO server
* Persistent Python worker
* Cross-platform support
* stdin/stdout IPC
* Dynamic virtual environment resolution

---

## Python Detection Service

* YOLO object detection
* Base64 frame decoding
* Persistent model loading
* GPU/CPU support
* Optimized realtime inference

---

# Requirements

## Node.js

Recommended:

```text
Node.js 20+
```

---

## Python

Recommended:

```text
Python 3.11
```

Python 3.14 works in CPU mode.

---

# Setup

---

# 1. Clone Repository

```bash
git clone <repository-url>
```

```bash
cd testBox
```

---

# 2. Setup Python Detection Service

```bash
cd detectionservice
```

---

## Create Virtual Environment

### Windows

```bash
python -m venv .venv
```

Activate:

```bash
.venv\Scripts\activate
```

---

### Ubuntu/Linux

```bash
python3 -m venv .venv
```

Activate:

```bash
source .venv/bin/activate
```

---

# Install Python Dependencies

## CPU Version

```bash
pip install ultralytics pillow opencv-python numpy
```

---

## NVIDIA GPU Version

Install CUDA PyTorch first:

```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
```

Then:

```bash
pip install ultralytics pillow opencv-python numpy
```

---

# Verify Installation

```bash
python -c "from ultralytics import YOLO; print('YOLO OK')"
```

---

# 3. Setup Backend

```bash
cd ../backend
```

Install dependencies:

```bash
npm install
```

Required packages:

```bash
npm install express socket.io
```

---

# 4. Setup Frontend

```bash
cd ../frontend
```

Install dependencies:

```bash
npm install
```

Required packages:

```bash
npm install socket.io-client
```

---

# Running The Project

---

# Start Backend

```bash
cd backend
```

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

IMPORTANT:

Do NOT manually run:

```bash
python worker.py
```

Node.js automatically starts the Python worker.

---

# Start Frontend

```bash
cd frontend
```

```bash
npm run dev
```

Open:

```text
http://localhost:3001
```

(or default Next.js port)

---

# Detection Flow

```text
Webcam
   ↓
Canvas Capture
   ↓
Socket.IO
   ↓
Node.js Backend
   ↓
Python Worker
   ↓
YOLO Detection
   ↓
Detection Result
   ↓
Canvas Overlay
```

---

# Socket Events

---

# Frontend → Backend

## detect-frame

Payload:

```json
{
  "frameId": 1,
  "image": "BASE64_IMAGE"
}
```

---

# Backend → Frontend

## detection-result

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

# Performance Notes

## Current Setup

Frames are streamed every:

```text
200ms
```

Approximately:

```text
5 FPS
```

---

# Increase FPS

Reduce interval:

```javascript
setInterval(..., 100)
```

---

# Reduce CPU Usage

Lower:

* webcam resolution
* JPEG quality
* frame rate

---

# GPU Support

## Verify GPU

```bash
python -c "import torch; print(torch.cuda.is_available())"
```

Expected:

```text
True
```

---

# Force GPU

Inside `worker.py`:

```python
model.to("cuda")
```

---

# Deployment

---

# Ubuntu Server

Recommended stack:

* Ubuntu 22.04
* Node.js 20+
* Python 3.11
* NVIDIA CUDA
* PM2
* Nginx

---

# Install PM2

```bash
npm install -g pm2
```

Start backend:

```bash
pm2 start server.js --name yolo-backend
```

---

# Nginx Reverse Proxy

Recommended for:

* HTTPS
* websocket proxying
* production deployment

---

# Future Improvements

Potential upgrades:

* object tracking
* TensorRT acceleration
* Redis queues
* multi-worker inference
* RTSP camera support
* WebRTC streaming
* 360 camera support
* segmentation models
* pose estimation

---

# Important Notes

## Do NOT spawn Python per frame

BAD:

```text
spawn python → detect → exit
```

GOOD:

```text
persistent worker process
```

---

# Why Persistent Worker?

Because YOLO:

* loads once
* keeps GPU memory allocated
* reduces latency
* improves FPS dramatically

---

# Production Architecture

Current architecture:

```text
Next.js
   ↓
Node.js
   ↓
Persistent Python Worker
```

This is excellent for:

* prototypes
* internal tools
* medium-scale realtime systems

---

# License

MIT
