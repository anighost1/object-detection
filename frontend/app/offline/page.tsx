
"use client";

import {
    useCallback,
    useEffect,
    useRef,
    useState,
} from "react";
import Panorama360 from "@/components/Panorama360";

type Detection = {
    label?: string;
    confidence?: number;
    bbox?: {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
    };
    segments?: number[][];
};

type DetectionResult = {
    success: boolean;
    frameId?: number;
    count?: number;
    detections?: Detection[];
    timing?: {
        inferenceMs: number;
        processingMs: number;
    };
    error?: string;
};

const colors = [
    "#ff4d4f",
    "#4ade80",
    "#38bdf8",
    "#f59e0b",
    "#c084fc",
];

export default function OfflinePage() {
    const videoRef = useRef<HTMLVideoElement>(null);
    const captureRef = useRef<HTMLCanvasElement>(null);
    const overlayRef = useRef<HTMLCanvasElement>(null);

    const busyRef = useRef(false);
    const frameIdRef = useRef(0);
    const lastDetectionTimeRef = useRef(-1);
    const resumeAfterDetectionRef = useRef(false);
    const enabledRef = useRef(false);

    const [videoUrl, setVideoUrl] = useState("");
    const [fileName, setFileName] = useState("");
    const [detecting, setDetecting] = useState(false);
    const [playing, setPlaying] = useState(false);
    const [status, setStatus] = useState("Select a recorded video");
    const [count, setCount] = useState(0);
    const [inferenceMs, setInferenceMs] = useState(0);
    const [error, setError] = useState("");

    useEffect(() => {
        return () => {
            if (videoUrl) URL.revokeObjectURL(videoUrl);
        };
    }, [videoUrl]);

    const clearOverlay = useCallback(() => {
        const canvas = overlayRef.current;
        const ctx = canvas?.getContext("2d");

        if (canvas && ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
        }

        setCount(0);
    }, []);

    function selectVideo(file?: File) {
        if (!file) return;

        if (videoUrl) URL.revokeObjectURL(videoUrl);

        const url = URL.createObjectURL(file);

        setVideoUrl(url);
        setFileName(file.name);
        setStatus("Video loaded");
        setError("");
        setDetecting(false);
        enabledRef.current = false;
        busyRef.current = false;
        frameIdRef.current = 0;
        lastDetectionTimeRef.current = -1;
        clearOverlay();
    }

    function drawDetections(
        result: DetectionResult,
        expectedFrameWidth: number,
        expectedFrameHeight: number
    ) {
        const canvas = overlayRef.current;
        const video = videoRef.current;

        if (!canvas || !video) return;

        // The overlay uses the same pixel coordinates as the captured frame.
        canvas.width = expectedFrameWidth;
        canvas.height = expectedFrameHeight;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.lineWidth = Math.max(2, canvas.width / 1440);
        ctx.font = `${Math.max(14, canvas.width / 120)}px sans-serif`;

        const detections = result.detections ?? [];

        detections.forEach((item, index) => {
            const color = colors[index % colors.length];
            const points = item.segments;

            if (points && points.length >= 3) {
                ctx.beginPath();
                ctx.moveTo(points[0][0], points[0][1]);

                for (let i = 1; i < points.length; i++) {
                    ctx.lineTo(points[i][0], points[i][1]);
                }

                ctx.closePath();
                ctx.strokeStyle = color;
                ctx.stroke();
            } else if (item.bbox) {
                const { x1, y1, x2, y2 } = item.bbox;

                ctx.strokeStyle = color;
                ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
            }

            if (item.bbox) {
                const text =
                    `${item.label ?? "object"} ` +
                    `${Math.round((item.confidence ?? 0) * 100)}%`;

                const { x1, y1 } = item.bbox;
                const textWidth = ctx.measureText(text).width;

                ctx.fillStyle = "rgba(0,0,0,0.8)";
                ctx.fillRect(x1, Math.max(0, y1 - 25), textWidth + 10, 23);

                ctx.fillStyle = color;
                ctx.fillText(text, x1 + 5, Math.max(17, y1 - 8));
            }
        });

        setCount(detections.length);
        setInferenceMs(result.timing?.inferenceMs ?? 0);
    }

    const detectCurrentFrame = useCallback(async () => {
        const video = videoRef.current;
        const capture = captureRef.current;

        if (
            !enabledRef.current ||
            busyRef.current ||
            !video ||
            !capture ||
            !video.videoWidth ||
            !video.videoHeight
        ) {
            return;
        }

        // Sample approximately every 0.75 seconds of source video.
        if (
            lastDetectionTimeRef.current >= 0 &&
            video.currentTime - lastDetectionTimeRef.current < 0.75
        ) {
            return;
        }

        busyRef.current = true;
        resumeAfterDetectionRef.current = !video.paused;

        video.pause();
        setStatus(`Detecting at ${video.currentTime.toFixed(2)}s…`);
        setError("");

        const ctx = capture.getContext("2d");

        if (!ctx) {
            busyRef.current = false;
            setError("Could not create frame canvas");
            return;
        }

        capture.width = video.videoWidth;
        capture.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, capture.width, capture.height);

        const timestamp = video.currentTime;
        lastDetectionTimeRef.current = timestamp;

        try {
            const response = await fetch("/api/offline-detect", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    frameId: frameIdRef.current++,
                    image: capture.toDataURL("image/jpeg", 0.65),
                }),
            });

            const result = (await response.json()) as DetectionResult;

            if (!response.ok || !result.success) {
                throw new Error(result.error ?? "Detection request failed");
            }

            // Do not draw onto a different frame after a file change or seek.
            if (video.currentTime === timestamp) {
                drawDetections(result, capture.width, capture.height);
            }

            setStatus(
                `${result.count ?? 0} objects detected at ${timestamp.toFixed(2)}s`
            );
        } catch (err) {
            setError(err instanceof Error ? err.message : "Detection failed");
            setStatus("Detection failed");
        } finally {
            busyRef.current = false;

            if (enabledRef.current && resumeAfterDetectionRef.current) {
                resumeAfterDetectionRef.current = false;
                void video.play().catch(() => {
                    setStatus("Press Play to continue");
                });
            }
        }
    }, []);

    function toggleDetection() {
        const next = !detecting;

        enabledRef.current = next;
        setDetecting(next);

        if (next) {
            lastDetectionTimeRef.current = -1;
            setStatus("Detection enabled");
            void detectCurrentFrame();
        } else {
            setStatus("Detection paused");
        }
    }

    return (
        <main className="min-h-screen bg-slate-950 p-4 text-white md:p-8">
            <div className="mx-auto max-w-7xl space-y-6">
                <header>
                    <p className="text-sm text-cyan-400">
                        OFFLINE ANALYSIS
                    </p>
                    <h1 className="mt-1 text-3xl font-semibold">
                        360° Video Detection
                    </h1>
                    <p className="mt-2 text-sm text-slate-400">
                        Analyse recorded footage without connecting a camera.
                    </p>
                </header>

                <section className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
                    <label className="cursor-pointer rounded-lg bg-white px-4 py-2 font-medium text-slate-950">
                        Choose video
                        <input
                            type="file"
                            accept="video/*"
                            className="hidden"
                            onChange={(event) => selectVideo(event.target.files?.[0])}
                        />
                    </label>

                    <span className="max-w-full truncate text-sm text-slate-400">
                        {fileName || "No video selected"}
                    </span>

                    <button
                        onClick={toggleDetection}
                        disabled={!videoUrl}
                        className="rounded-lg bg-cyan-600 px-4 py-2 font-medium disabled:opacity-40"
                    >
                        {detecting ? "Stop detection" : "Start detection"}
                    </button>

                    <span className="text-sm text-slate-400">{status}</span>
                </section>

                {error && (
                    <p className="rounded-lg bg-red-950 p-3 text-red-300">
                        {error}
                    </p>
                )}

                <section className="grid gap-5 lg:grid-cols-2">
                    <div className="overflow-hidden rounded-xl border border-slate-800 bg-black">
                        <div className="border-b border-slate-800 px-4 py-3">
                            <h2 className="font-medium">360° panorama</h2>
                        </div>

                        {videoUrl ? (
                            <Panorama360
                                videoRef={videoRef}
                                overlayCanvasRef={overlayRef}
                            />
                        ) : (
                            <div className="flex aspect-video items-center justify-center text-slate-500">
                                Select a 360° equirectangular video
                            </div>
                        )}
                    </div>

                    <div className="overflow-hidden rounded-xl border border-slate-800 bg-black">
                        <div className="border-b border-slate-800 px-4 py-3">
                            <h2 className="font-medium">Source video and outlines</h2>
                        </div>

                        <div className="relative">
                            <video
                                ref={videoRef}
                                src={videoUrl || undefined}
                                controls
                                playsInline
                                preload="metadata"
                                onPlay={() => setPlaying(true)}
                                onPause={() => setPlaying(false)}
                                onTimeUpdate={() => void detectCurrentFrame()}
                                onSeeked={() => {
                                    lastDetectionTimeRef.current = -1;
                                    clearOverlay();
                                    if (enabledRef.current) {
                                        void detectCurrentFrame();
                                    }
                                }}
                                onEnded={() => {
                                    enabledRef.current = false;
                                    setDetecting(false);
                                    setStatus("Video ended");
                                }}
                                className="block h-auto w-full"
                            />

                            <canvas
                                ref={overlayRef}
                                className="pointer-events-none absolute inset-0 h-full w-full"
                            />
                        </div>
                    </div>
                </section>

                <canvas ref={captureRef} className="hidden" />

                <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
                    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                        <p className="text-sm text-slate-400">Detected objects</p>
                        <p className="mt-2 text-2xl font-semibold">{count}</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                        <p className="text-sm text-slate-400">Inference time</p>
                        <p className="mt-2 text-2xl font-semibold">
                            {inferenceMs.toFixed(0)} ms
                        </p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                        <p className="text-sm text-slate-400">Playback</p>
                        <p className="mt-2 text-2xl font-semibold">
                            {playing ? "Playing" : "Paused"}
                        </p>
                    </div>
                </section>
            </div>
        </main>
    );
}
