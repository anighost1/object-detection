# Next.js Frontend

Realtime webcam frontend built with Next.js and Socket.IO.

Streams webcam frames to the Node.js backend and renders YOLO detection overlays live on canvas.

---

# Features

* Webcam streaming
* Realtime Socket.IO communication
* Live object detection overlays
* Bounding box rendering
* JPEG frame compression

---

# Project Structure

```text
frontend/
├── app/
├── components/
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
npm install socket.io-client
```

---

# Start Frontend

```bash
npm run dev
```

Frontend runs on:

```text
http://localhost:3001
```

(or default Next.js port)

---

# Features

## Webcam Streaming

Frames are captured using:

```javascript
navigator.mediaDevices.getUserMedia()
```

---

## Frame Compression

Frames are compressed using:

```javascript
canvas.toDataURL("image/jpeg", 0.5)
```

to reduce bandwidth.

---

## Realtime Detection

Frames are streamed every:

```text
200ms
```

to the backend.

---

# Socket Connection

Backend URL:

```javascript
http://localhost:3000
```

---

# Overlay Rendering

Bounding boxes are rendered on a transparent canvas overlay above the webcam feed.

---

# Detection Flow

```text
Webcam
   ↓
Canvas Frame Capture
   ↓
Socket.IO
   ↓
Node Backend
   ↓
Python YOLO Worker
   ↓
Detection Results
   ↓
Canvas Overlay
```

---

# Notes

* Browser camera permission required
* Best tested on Chrome
* HTTPS required in production for webcam access
