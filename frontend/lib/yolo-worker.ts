
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

type DetectionResult = {
    success: boolean;
    frameId?: number;
    count?: number;
    imageWidth?: number;
    imageHeight?: number;
    detections?: Array<{
        label?: string;
        class_id?: number;
        confidence?: number;
        bbox?: {
            x1: number;
            y1: number;
            x2: number;
            y2: number;
        };
        segments?: number[][];
    }>;
    timing?: {
        decodeMs: number;
        inferenceMs: number;
        processingMs: number;
    };
    error?: string;
};

type PendingRequest = {
    resolve: (value: DetectionResult) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
};

type WorkerState = {
    child: ChildProcessWithoutNullStreams;
    buffer: string;
    pending: PendingRequest[];
    busy: boolean;
    failed: boolean;
};

const globalForWorker = globalThis as typeof globalThis & {
    yoloWorkerState?: WorkerState;
};

function createWorker(): WorkerState {
    const projectRoot = path.resolve(process.cwd(), "..");
    const serviceDir = path.join(projectRoot, "detectionservice");

    const windows = process.platform === "win32";
    const venvPython = path.join(
        serviceDir,
        windows
            ? ".venv/Scripts/python.exe"
            : ".venv/bin/python"
    );

    const python = fs.existsSync(venvPython)
        ? venvPython
        : windows
            ? "python"
            : "python3";

    const workerPath = path.join(serviceDir, "worker.py");

    if (!fs.existsSync(workerPath)) {
        throw new Error(`Python worker not found: ${workerPath}`);
    }

    const child = spawn(python, [workerPath], {
        stdio: ["pipe", "pipe", "pipe"],
        cwd: serviceDir,
        env: process.env,
    });

    const state: WorkerState = {
        child,
        buffer: "",
        pending: [],
        busy: false,
        failed: false,
    };

    child.stderr.on("data", (chunk: Buffer) => {
        process.stderr.write(`[YOLO] ${chunk}`);
    });

    child.stdout.on("data", (chunk: Buffer) => {
        state.buffer += chunk.toString();

        const lines = state.buffer.split("\n");
        state.buffer = lines.pop() ?? "";

        for (const line of lines) {
            if (!line.trim()) continue;

            let result: DetectionResult;

            try {
                result = JSON.parse(line);
            } catch {
                console.error("[YOLO] Invalid JSON response:", line);
                continue;
            }

            const pending = state.pending.shift();

            if (!pending) {
                console.error("[YOLO] Unexpected worker response");
                continue;
            }

            clearTimeout(pending.timer);
            state.busy = false;
            pending.resolve(result);

            processNext(state);
        }
    });

    const fail = (error: Error) => {
        if (state.failed) return;

        state.failed = true;
        state.busy = false;

        for (const pending of state.pending.splice(0)) {
            clearTimeout(pending.timer);
            pending.reject(error);
        }
    };

    child.on("error", (error) => {
        fail(error);
    });

    child.on("close", (code) => {
        fail(new Error(`Python worker exited: ${code}`));

        if (globalForWorker.yoloWorkerState === state) {
            globalForWorker.yoloWorkerState = undefined;
        }
    });

    return state;
}

function processNext(state: WorkerState) {
    if (state.failed || state.busy || state.pending.length === 0) {
        return;
    }

    // The first pending request has already been sent when enqueued.
    // This function is intentionally left as a no-op scheduler;
    // request dispatch is handled by detectFrame below.
}

export function getWorker(): WorkerState {
    const current = globalForWorker.yoloWorkerState;

    if (current && !current.failed && !current.child.killed) {
        return current;
    }

    const state = createWorker();
    globalForWorker.yoloWorkerState = state;
    return state;
}

export async function detectFrame(
    frameId: number,
    image: string
): Promise<DetectionResult> {
    const state = getWorker();

    // Serialize inference calls: worker.py reads one JSON line at a time.
    while (state.busy) {
        await new Promise((resolve) => setTimeout(resolve, 10));

        if (state.failed) {
            throw new Error("Python worker stopped");
        }
    }

    if (state.failed || !state.child.stdin.writable) {
        throw new Error("Python worker is not available");
    }

    state.busy = true;

    return new Promise<DetectionResult>((resolve, reject) => {
        const timer = setTimeout(() => {
            state.busy = false;
            state.failed = true;
            state.child.kill();

            reject(new Error("Python detection timed out"));
        }, 60_000);

        const pending: PendingRequest = {
            resolve,
            reject,
            timer,
        };

        state.pending.push(pending);

        state.child.stdin.write(
            JSON.stringify({ frameId, image }) + "\n",
            (error) => {
                if (!error) return;

                const index = state.pending.indexOf(pending);

                if (index !== -1) {
                    state.pending.splice(index, 1);
                }

                clearTimeout(timer);
                state.busy = false;
                reject(error);
            }
        );
    });
}
