const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();

const server = http.createServer(app);

// const io = new Server(server, {
//   path: "/od/backend/socket.io",
//   cors: {
//     origin: "*",
//   },
// });
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

// ---------------------------------------------------
// PYTHON WORKER CONFIG
// ---------------------------------------------------

const isWindows = process.platform === "win32";

// Dynamic virtual environment python path
const venvPython = isWindows
  ? path.join(
    __dirname,
    "../detectionservice/.venv/Scripts/python.exe"
  )
  : path.join(
    __dirname,
    "../detectionservice/.venv/bin/python"
  );

// Fallback system python
const pythonCommand = fs.existsSync(venvPython)
  ? venvPython
  : isWindows
    ? "python"
    : "python3";

// Worker file path
const workerPath = path.join(
  __dirname,
  "../detectionservice/worker.py"
);

// ---------------------------------------------------
// START PYTHON WORKER
// ---------------------------------------------------

console.log("Starting Python YOLO worker...");

const pythonWorker = spawn(
  pythonCommand,
  [workerPath],
  {
    stdio: ["pipe", "pipe", "pipe"],
  }
);

// ---------------------------------------------------
// PYTHON STDERR
// ---------------------------------------------------

pythonWorker.stderr.on("data", (data) => {
  console.log("[PYTHON]", data.toString());
});

// ---------------------------------------------------
// PYTHON STDOUT
// ---------------------------------------------------

// ---------------------------------------------------
// LATEST-FRAME-WINS QUEUE
// ---------------------------------------------------

let pythonBuffer = "";
let isProcessing = false;
let activeJob = null;
let pendingJob = null;

function processNextFrame() {
  if (isProcessing || !pendingJob) return;

  activeJob = pendingJob;
  pendingJob = null;
  isProcessing = true;

  const message = {
    frameId: activeJob.frameId,
    image: activeJob.image,
    capturedAt: activeJob.capturedAt,
  };

  pythonWorker.stdin.write(
    JSON.stringify(message) + "\n",
    (err) => {
      if (err) {
        console.error("Python stdin error:", err);
      }
    }
  );
}

// Replace the OLD stdout handler with this one.
pythonWorker.stdout.on("data", (data) => {
  pythonBuffer += data.toString();

  const lines = pythonBuffer.split("\n");
  pythonBuffer = lines.pop();

  for (const line of lines) {
    if (!line.trim()) continue;

    let result;

    try {
      result = JSON.parse(line);
    } catch (err) {
      console.error("Invalid Python JSON:", line);
      continue;
    }

    // Match result to the job currently being processed.
    if (!activeJob) {
      console.warn("Received result without an active job");
      continue;
    }

    const completedJob = activeJob;
    activeJob = null;
    isProcessing = false;

    if (completedJob.capturedAt != null) {
      result.capturedAt = completedJob.capturedAt;
    }

    // Do not send results to disconnected clients.
    if (io.sockets.sockets.has(completedJob.socketId)) {
      io.to(completedJob.socketId).emit(
        "detection-result",
        result
      );
    }

    // Process the most recent waiting frame.
    processNextFrame();
  }
});

// ---------------------------------------------------
// PYTHON EXIT
// ---------------------------------------------------

pythonWorker.on("close", (code) => {
  console.error(
    `Python worker exited with code ${code}`
  );
});

// ---------------------------------------------------
// SOCKET CONNECTION
// ---------------------------------------------------

io.on("connection", (socket) => {
  console.log(
    "Client connected:",
    socket.id
  );

  // -----------------------------------------------
  // RECEIVE FRAME
  // -----------------------------------------------

  socket.on("detect-frame", (payload = {}) => {
    const { frameId, image, capturedAt } = payload;

    if (!image) {
      socket.emit("detection-error", {
        success: false,
        error: "No image provided",
        frameId,
      });
      return;
    }

    const cleanBase64 = image.replace(
      /^data:image\/\w+;base64,/,
      ""
    );

    // Overwrite any older frame waiting for Python.
    pendingJob = {
      socketId: socket.id,
      frameId,
      capturedAt,
      image: cleanBase64,
    };

    processNextFrame();
  });

  // -----------------------------------------------
  // DISCONNECT
  // -----------------------------------------------

  socket.on("disconnect", () => {
    console.log(
      "Client disconnected:",
      socket.id
    );
  });
});

// ---------------------------------------------------
// BASIC ROUTE
// ---------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    success: true,
    message:
      "YOLO Socket Server Running",
  });
});

// ---------------------------------------------------
// START SERVER
// ---------------------------------------------------

const PORT = process.env.PORT || 8000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Server running on port ${PORT}`
  );
});