
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: { origin: "*" },
});

const isWindows = process.platform === "win32";

const venvPython = isWindows
  ? path.join(__dirname, "../detectionservice/.venv/Scripts/python.exe")
  : path.join(__dirname, "../detectionservice/.venv/bin/python");

const pythonCommand = fs.existsSync(venvPython)
  ? venvPython
  : isWindows
    ? "python"
    : "python3";

const workerPath = path.join(
  __dirname,
  "../detectionservice/worker.py"
);

let pythonWorker = null;
let workerReady = false;
let workerBuffer = "";

let activeJob = null;
let pendingJob = null;
let isProcessing = false;
let workerFailed = false;

function startPythonWorker() {
  console.log("Starting Python YOLO worker...");

  workerFailed = false;
  workerReady = false;
  workerBuffer = "";

  pythonWorker = spawn(pythonCommand, [workerPath], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  pythonWorker.stderr.on("data", (data) => {
    // Keep diagnostics separate from the JSON stdout protocol.
    process.stderr.write(`[PYTHON] ${data}`);
  });

  pythonWorker.stdout.on("data", (data) => {
    workerBuffer += data.toString();

    const lines = workerBuffer.split("\n");
    workerBuffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.trim()) continue;

      let result;
      try {
        result = JSON.parse(line);
      } catch {
        console.error("Invalid Python JSON:", line.slice(0, 300));
        continue;
      }

      // The worker is sequential, so its next response belongs to activeJob.
      if (!activeJob) {
        console.warn("Received a Python response without an active job");
        continue;
      }

      const completedJob = activeJob;
      activeJob = null;
      isProcessing = false;

      const workerFinishedAt = Date.now();

      result.frameId = result.frameId ?? completedJob.frameId;
      result.capturedAt = completedJob.capturedAt ?? null;
      result.serverReceivedAt = completedJob.receivedAt;
      result.serverProcessingMs =
        workerFinishedAt - completedJob.receivedAt;

      // If a newer frame is waiting, this result is already stale.
      if (pendingJob) {
        console.log(
          `Dropping stale result frame=${completedJob.frameId}; ` +
          `newer frame=${pendingJob.frameId} is waiting`
        );
      } else if (io.sockets.sockets.has(completedJob.socketId)) {
        io.to(completedJob.socketId).emit("detection-result", result);
      }

      processNextFrame();
    }
  });

  pythonWorker.on("error", (err) => {
    workerFailed = true;
    workerReady = false;
    console.error("Python worker spawn/error:", err.message);
    failOutstandingJobs("Python worker could not be started");
  });

  pythonWorker.on("close", (code) => {
    workerFailed = true;
    workerReady = false;
    isProcessing = false;
    activeJob = null;

    console.error(`Python worker exited with code ${code}`);

    failOutstandingJobs("Python worker stopped");
  });
}

function failOutstandingJobs(message) {
  const jobs = [activeJob, pendingJob].filter(Boolean);

  activeJob = null;
  pendingJob = null;
  isProcessing = false;

  for (const job of jobs) {
    if (io.sockets.sockets.has(job.socketId)) {
      io.to(job.socketId).emit("detection-error", {
        success: false,
        error: message,
        frameId: job.frameId,
      });
    }
  }
}

function processNextFrame() {
  if (isProcessing || !pendingJob || workerFailed || !pythonWorker) {
    return;
  }

  const job = pendingJob;
  pendingJob = null;

  activeJob = {
    ...job,
    workerStartedAt: Date.now(),
  };

  isProcessing = true;

  const message = JSON.stringify({
    frameId: job.frameId,
    image: job.image,
    capturedAt: job.capturedAt,
  }) + "\n";

  pythonWorker.stdin.write(message, (err) => {
    if (err) {
      console.error("Python stdin write error:", err.message);

      if (activeJob?.frameId === job.frameId) {
        activeJob = null;
        isProcessing = false;
      }

      if (io.sockets.sockets.has(job.socketId)) {
        io.to(job.socketId).emit("detection-error", {
          success: false,
          error: "Failed to send frame to Python worker",
          frameId: job.frameId,
        });
      }

      processNextFrame();
    }
  });
}

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("detect-frame", (payload = {}) => {
    const { frameId, image, capturedAt } = payload;

    if (typeof image !== "string" || !image.length) {
      socket.emit("detection-error", {
        success: false,
        error: "No image provided",
        frameId,
      });
      return;
    }

    // Accept either a data URL or raw Base64.
    const cleanBase64 = image.replace(
      /^data:image\/[a-zA-Z0-9.+-]+;base64,/,
      ""
    );

    if (pendingJob) {
      const oldJob = pendingJob;

      if (io.sockets.sockets.has(oldJob.socketId)) {
        io.to(oldJob.socketId).emit("detection-error", {
          success: false,
          error: "Frame superseded by a newer frame",
          frameId: oldJob.frameId,
        });
      }
    }

    // Replace the previous waiting frame instead of queueing it.
    pendingJob = {
      socketId: socket.id,
      frameId,
      capturedAt: capturedAt ?? null,
      image: cleanBase64,
      receivedAt: Date.now(),
    };

    processNextFrame();
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);

    if (pendingJob?.socketId === socket.id) {
      pendingJob = null;
    }

    // Do not cancel an active inference; just prevent its result
    // from being delivered to the disconnected socket.
  });
});

app.get("/", (_req, res) => {
  res.json({
    success: true,
    message: "YOLO Socket Server Running",
    workerReady: !workerFailed,
  });
});

const PORT = process.env.PORT || 8000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
  startPythonWorker();
});
