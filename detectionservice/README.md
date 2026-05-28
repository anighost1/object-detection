# Python YOLO Detection Service

Persistent Python worker for realtime YOLO object detection.

Communicates with Node.js using stdin/stdout IPC.

---

# Features

* Persistent YOLO worker
* Realtime object detection
* Base64 image decoding
* Optimized for Socket.IO pipelines
* Cross-platform compatible

---

# Project Structure

```text
detectionservice/
├── .venv/
├── worker.py
├── requirements.txt
├── yolo11n.pt
└── README.md
```

---

# Python Version

Recommended:

```text
Python 3.11
```

Python 3.14 works in CPU mode.

---

# Create Virtual Environment

## Windows

```bash
python -m venv .venv
```

Activate:

```bash
.venv\Scripts\activate
```

---

## Ubuntu/Linux

```bash
python3 -m venv .venv
```

Activate:

```bash
source .venv/bin/activate
```

---

# Install Dependencies

```bash
pip install -r requirements.txt
```

---

# requirements.txt

```text
ultralytics
pillow
opencv-python
numpy
```

---

# YOLO Model

Default model:

```text
yolo11n.pt
```

The model downloads automatically on first run.

---

# Worker Architecture

```text
Node.js
   ↓ stdin
Python Worker
   ↓ stdout
Node.js
```

---

# Important

Do NOT manually run:

```bash
python worker.py
```

in production.

Node.js automatically starts the worker process.

---

# Manual Testing

Optional:

```bash
python worker.py
```

Worker waits for stdin messages.

---

# GPU Support

## CPU Mode

Works automatically.

---

## NVIDIA GPU

Install CUDA-enabled PyTorch:

```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cu124
```

Verify:

```bash
python -c "import torch; print(torch.cuda.is_available())"
```

---

# Production Notes

Recommended for deployment:

* Ubuntu Server
* NVIDIA GPU
* Python 3.11
* PM2
* Docker

---

# Data Format

Incoming payload:

```json
{
  "frameId": 1,
  "image": "BASE64_IMAGE"
}
```

Outgoing payload:

```json
{
  "success": true,
  "frameId": 1,
  "count": 1,
  "detections": []
}
```
