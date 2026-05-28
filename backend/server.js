const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const app = express();

const server = http.createServer(app);

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

let pythonBuffer = "";

pythonWorker.stdout.on("data", (data) => {
  pythonBuffer += data.toString();

  /*
    Worker sends newline-delimited JSON
  */

  const messages = pythonBuffer.split("\n");

  /*
    Keep incomplete chunk
  */

  pythonBuffer = messages.pop();

  for (const message of messages) {
    if (!message.trim()) {
      continue;
    }

    try {
      const parsed = JSON.parse(message);

      /*
        Broadcast result
      */

      io.emit(
        "detection-result",
        parsed
      );
    } catch (err) {
      console.error(
        "Failed to parse Python JSON"
      );

      console.error(err);

      console.error(message);
    }
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

  socket.on(
    "detect-frame",
    async (payload) => {
      try {
        /*
          payload:
          {
            frameId: number,
            image: base64
          }
        */

        const {
          frameId,
          image,
        } = payload;

        if (!image) {
          socket.emit(
            "detection-error",
            {
              success: false,
              error:
                "No image provided",
            }
          );

          return;
        }

        /*
          Remove base64 prefix
        */

        const cleanBase64 =
          image.replace(
            /^data:image\/\w+;base64,/,
            ""
          );

        /*
          Send to Python worker
        */

        const message = {
          frameId,
          image: cleanBase64,
        };

        pythonWorker.stdin.write(
          JSON.stringify(
            message
          ) + "\n"
        );
      } catch (err) {
        console.error(err);

        socket.emit(
          "detection-error",
          {
            success: false,
            error: err.message,
          }
        );
      }
    }
  );

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

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
  console.log(
    `Server running on port ${PORT}`
  );
});