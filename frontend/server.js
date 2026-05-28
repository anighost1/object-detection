const express = require('express');
const http = require('http');
const cors = require('cors');
const axios = require('axios');
const { Server } = require('socket.io');

const YOLO_SERVER_URL = process.env.YOLO_SERVER_URL || 'http://localhost:8000/detect';
const YOLO_TIMEOUT_MS = Number(process.env.YOLO_TIMEOUT_MS) || 10000;
const PORT = process.env.PORT || 3000;

function isBase64String(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  const base64 = trimmed.replace(/^data:[^;]+;base64,/, '');
  return /^[A-Za-z0-9+/=\s]+$/.test(base64);
}

function parseDataUrl(value) {
  const match = /^data:(.+?);base64,(.+)$/.exec(value.trim());

  if (!match) {
    return null;
  }

  return {
    mimeType: match[1],
    base64: match[2]
  };
}

function bufferToBase64(buffer) {
  if (Buffer.isBuffer(buffer)) {
    return buffer.toString('base64');
  }

  if (buffer instanceof ArrayBuffer) {
    return Buffer.from(buffer).toString('base64');
  }

  if (ArrayBuffer.isView(buffer)) {
    return Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength).toString('base64');
  }

  return null;
}

function normalizePayload(payload) {
  if (payload == null) {
    return null;
  }

  if (typeof payload === 'string') {
    const parsed = parseDataUrl(payload);

    if (parsed) {
      return {
        base64: parsed.base64,
        mimeType: parsed.mimeType,
        rawSize: Math.ceil(parsed.base64.length * 3 / 4)
      };
    }

    if (isBase64String(payload)) {
      const cleaned = payload.trim().replace(/^base64,/, '');

      return {
        base64: cleaned,
        mimeType: 'unknown',
        rawSize: Math.ceil(cleaned.length * 3 / 4)
      };
    }

    return null;
  }

  if (Buffer.isBuffer(payload) || payload instanceof ArrayBuffer || ArrayBuffer.isView(payload)) {
    const base64 = bufferToBase64(payload);

    if (!base64) {
      return null;
    }

    return {
      base64,
      mimeType: 'unknown',
      rawSize: Buffer.from(payload).length
    };
  }

  if (typeof payload === 'object') {
    const data = payload.data ?? payload.image ?? payload.buffer;
    const mimeType = payload.mimeType ?? payload.type ?? payload.contentType;

    if (data == null) {
      return null;
    }

    const normalized = normalizePayload(data);

    if (!normalized) {
      return null;
    }

    return {
      ...normalized,
      mimeType: normalized.mimeType !== 'unknown' ? normalized.mimeType : mimeType ?? 'unknown'
    };
  }

  return null;
}

function getMeta(normalized) {
  return {
    mimeType: normalized.mimeType || 'unknown',
    size: normalized.base64.length,
    bytes: normalized.rawSize || Math.ceil(normalized.base64.length * 3 / 4)
  };
}

async function callYolo(imageBase64) {
  const response = await axios.post(
    YOLO_SERVER_URL,
    { image: imageBase64 },
    {
      timeout: YOLO_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json'
      }
    }
  );

  return response.data;
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

app.get('/', (_req, res) => {
  res.json({ success: true, message: 'Socket.IO Image Receiver running' });
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

io.on('connection', (socket) => {
  console.log(`client connected: ${socket.id}`);

  const handleImageEvent = async (payload, ack) => {
    const normalized = normalizePayload(payload);

    if (!normalized) {
      const errorPayload = {
        success: false,
        reason: 'Invalid image payload',
        event: 'image',
        payloadType: typeof payload
      };

      socket.emit('detection-error', errorPayload);
      if (typeof ack === 'function') ack(errorPayload);
      return;
    }

    const meta = getMeta(normalized);
    socket.emit('image-accepted', { success: true, ...meta });

    try {
      const detectionResult = await callYolo(normalized.base64);
      socket.emit('detection-result', detectionResult);
      if (typeof ack === 'function') ack({ success: true, result: detectionResult });
    } catch (error) {
      const status = error?.response?.status;
      const responseData = error?.response?.data;
      const errorPayload = {
        success: false,
        reason: 'YOLO upstream request failed',
        message: error?.message || String(error),
        code: error?.code || undefined,
        status: status,
        upstream: YOLO_SERVER_URL,
        response: responseData
      };

      socket.emit('detection-error', errorPayload);
      if (typeof ack === 'function') ack(errorPayload);
    }
  };

  socket.on('image', handleImageEvent);
  socket.on('detect-image', handleImageEvent);

  socket.on('disconnect', () => {
    console.log(`client disconnected: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`Forwarding image payloads to YOLO server at ${YOLO_SERVER_URL}`);
});
