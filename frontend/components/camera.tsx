'use client';

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

type Point = {
    x: number;
    y: number;
};

type BoundingBox = {
    x: number;
    y: number;
    width: number;
    height: number;
};

type DetectionMarking = {
    label?: string;
    confidence?: number;

    bbox?: {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
    };

    segments?: number[][];

    [key: string]: unknown;
};

function isNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function getColor(index: number) {
    const palette = [
        '#ff4d4f',
        '#4ade80',
        '#38bdf8',
        '#f59e0b',
        '#c084fc'
    ];

    return palette[index % palette.length];
}

export default function Camera() {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const captureCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const socketRef = useRef<Socket | null>(null);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    const frameIdRef = useRef(0);
    const lastRenderedFrameIdRef = useRef(-1);
    const awaitingResultRef = useRef(false);

    const MAX_RESULT_AGE_MS = 500;

    const [connected, setConnected] =
        useState(false);

    const [sending, setSending] =
        useState(false);

    useEffect(() => {
        const canvas = overlayCanvasRef.current;
        if (canvas) {
            const ctx = canvas.getContext('2d');
            if (ctx) {
                ctx.imageSmoothingEnabled = false;
            }
        }
    }, []);

    // ---------------------------------------------------
    // POLYGON SIMPLIFICATION (Douglas-Peucker)
    // ---------------------------------------------------

    function pointLineDistance(
        point: number[],
        lineStart: number[],
        lineEnd: number[]
    ): number {
        const dx = lineEnd[0] - lineStart[0];
        const dy = lineEnd[1] - lineStart[1];
        const t =
            ((point[0] - lineStart[0]) * dx +
                (point[1] - lineStart[1]) * dy) /
            (dx * dx + dy * dy);
        const projectionX = lineStart[0] + t * dx;
        const projectionY = lineStart[1] + t * dy;
        const dx2 = point[0] - projectionX;
        const dy2 = point[1] - projectionY;
        return Math.sqrt(dx2 * dx2 + dy2 * dy2);
    }

    function simplifyPolygon(
        polygon: number[][],
        epsilon: number = 1.5
    ): number[][] {
        if (polygon.length < 3) return polygon;

        let dMax = 0;
        let index = 0;

        for (let i = 1; i < polygon.length - 1; i++) {
            const d = pointLineDistance(
                polygon[i],
                polygon[0],
                polygon[polygon.length - 1]
            );
            if (d > dMax) {
                index = i;
                dMax = d;
            }
        }

        if (dMax > epsilon) {
            const recResults1 = simplifyPolygon(
                polygon.slice(0, index + 1),
                epsilon
            );
            const recResults2 = simplifyPolygon(
                polygon.slice(index),
                epsilon
            );

            return [
                ...recResults1.slice(0, -1),
                ...recResults2
            ];
        } else {
            return [polygon[0], polygon[polygon.length - 1]];
        }
    }

    // ---------------------------------------------------
    // SYNC OVERLAY SIZE
    // ---------------------------------------------------

    function syncOverlayCanvas(
        video: HTMLVideoElement,
        overlayCanvas: HTMLCanvasElement
    ) {
        const width = video.videoWidth || 640;
        const height = video.videoHeight || 480;

        if (
            overlayCanvas.width !== width ||
            overlayCanvas.height !== height
        ) {
            overlayCanvas.width = width;
            overlayCanvas.height = height;
        }

        if (
            overlayCanvas.style.width !== `${video.clientWidth}px`
        ) {
            overlayCanvas.style.width = `${video.clientWidth}px`;
        }

        if (
            overlayCanvas.style.height !== `${video.clientHeight}px`
        ) {
            overlayCanvas.style.height = `${video.clientHeight}px`;
        }
    }

    // ---------------------------------------------------
    // DRAW DETECTIONS
    // ---------------------------------------------------

    function drawSegmentOutline(
        ctx: CanvasRenderingContext2D,
        segments: number[][],
        color: string
    ) {
        if (segments.length < 2) return;

        const simplified = simplifyPolygon(segments);

        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(simplified[0][0], simplified[0][1]);

        for (let i = 1; i < simplified.length; i++) {
            ctx.lineTo(simplified[i][0], simplified[i][1]);
        }

        ctx.closePath();
        ctx.stroke();
    }

    function drawMarkings(payload: unknown) {
        const video = videoRef.current;

        const overlayCanvas =
            overlayCanvasRef.current;

        if (!video || !overlayCanvas) {
            return;
        }

        syncOverlayCanvas(video, overlayCanvas);

        const ctx =
            overlayCanvas.getContext('2d');

        if (!ctx) {
            return;
        }

        ctx.clearRect(
            0,
            0,
            overlayCanvas.width,
            overlayCanvas.height
        );

        if (
            !payload ||
            typeof payload !== 'object'
        ) {
            return;
        }

        const data = payload as {
            detections?: DetectionMarking[];
        };

        const detections =
            data.detections || [];

        // Draw segment outlines (first pass - fast)
        for (let i = 0; i < detections.length; i++) {
            const detection = detections[i];
            const segments = detection.segments;

            if (Array.isArray(segments) && segments.length > 1) {
                drawSegmentOutline(ctx, segments, getColor(i));
            }
        }

        // Draw labels (second pass)
        ctx.font = '600 12px sans-serif';

        for (let i = 0; i < detections.length; i++) {
            const detection = detections[i];
            const bbox = detection.bbox;

            if (
                !bbox ||
                !isNumber(bbox.x1) ||
                !isNumber(bbox.y1)
            ) {
                continue;
            }

            const label = detection.label || 'object';
            const confidence = detection.confidence || 0;
            const text = `${label} ${Math.round(confidence * 100)}%`;
            const textWidth = ctx.measureText(text).width;

            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(
                bbox.x1,
                Math.max(bbox.y1 - 24, 0),
                textWidth + 12,
                22
            );

            ctx.fillStyle = '#ffffff';
            ctx.fillText(
                text,
                bbox.x1 + 6,
                Math.max(bbox.y1 - 8, 14)
            );
        }
    }

    // ---------------------------------------------------
    // START CAMERA
    // ---------------------------------------------------

    async function startCamera() {
        try {
            const stream =
                await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: {
                            ideal: "environment"
                        },
                        width: 640,
                        height: 480
                    },
                    audio: false
                });

            if (videoRef.current) {
                videoRef.current.srcObject =
                    stream;
            }
        } catch (err: any) {
            console.error(err);
        }
    }

    // ---------------------------------------------------
    // SOCKET SETUP
    // ---------------------------------------------------

    useEffect(() => {
        const socket = io(
            process.env.NEXT_PUBLIC_YOLO_SERVER_URL ||
            'http://localhost:3000',
            {
                transports: ['websocket']
            }
        );

        socketRef.current = socket;

        socket.on('connect', () => {
            console.log(
                'Socket connected'
            );

            setConnected(true);
        });

        socket.on('disconnect', () => {
            console.log(
                'Socket disconnected'
            );

            setConnected(false);
        });

        socket.on('detection-result', (data) => {
            // Release the next frame, even if this result is stale.
            awaitingResultRef.current = false;

            console.log('data',data);
            

            if (!data || data.success !== true) {
                return;
            }

            const frameId = data.frameId;

            if (
                typeof frameId === 'number' &&
                frameId <= lastRenderedFrameIdRef.current
            ) {
                return;
            }

            // capturedAt must be echoed by the Node.js server.
            if (typeof data.capturedAt === 'number') {
                const ageMs = performance.now() - data.capturedAt;

                if (ageMs > MAX_RESULT_AGE_MS) {
                    console.debug(
                        `Ignoring stale detection: ${ageMs.toFixed(0)} ms`
                    );
                    return;
                }
            }

            if (typeof frameId === 'number') {
                lastRenderedFrameIdRef.current = frameId;
            }

            drawMarkings(data);
        });

        socket.on('detection-error', (err) => {
            awaitingResultRef.current = false;
            console.error('Detection error:', err);
        });

        socket.on(
            'detection-error',
            (err) => {
                console.error(
                    'Detection error:',
                    err
                );
            }
        );

        startCamera();

        return () => {
            socket.disconnect();

            if (intervalRef.current) {
                clearInterval(
                    intervalRef.current
                );
            }

            const video =
                videoRef.current;

            if (video?.srcObject) {
                const stream =
                    video.srcObject as MediaStream;

                stream
                    .getTracks()
                    .forEach((track) =>
                        track.stop()
                    );
            }
        };
    }, []);

    // ---------------------------------------------------
    // START STREAMING
    // ---------------------------------------------------

    async function startStreaming() {
        if (sending || awaitingResultRef.current) {
            return;
        }

        const captureCanvas = captureCanvasRef.current;
        const video = videoRef.current;
        const socket = socketRef.current;

        if (
            !captureCanvas ||
            !video ||
            !socket ||
            !socket.connected
        ) {
            return;
        }

        const ctx = captureCanvas.getContext('2d');

        if (!ctx) return;

        setSending(true);

        // Start a fresh frame-ID sequence for this session.
        frameIdRef.current = 0;
        lastRenderedFrameIdRef.current = -1;

        const captureAndSend = () => {
            if (
                !socket.connected ||
                !video.videoWidth ||
                !video.videoHeight ||
                awaitingResultRef.current
            ) {
                return;
            }

            captureCanvas.width = video.videoWidth;
            captureCanvas.height = video.videoHeight;

            ctx.drawImage(
                video,
                0,
                0,
                captureCanvas.width,
                captureCanvas.height
            );

            // Timestamp immediately after capturing the image.
            const capturedAt = performance.now();
            const frameId = frameIdRef.current++;

            const image = captureCanvas.toDataURL(
                'image/jpeg',
                0.5
            );

            // Set before emit to prevent overlapping submissions.
            awaitingResultRef.current = true;

            socket.emit('detect-frame', {
                frameId,
                capturedAt,
                image,
            });
        };

        // Capture at most once per 100 ms, but skip while busy.
        intervalRef.current = setInterval(
            captureAndSend,
            100
        );

        // Send the first frame immediately.
        captureAndSend();
    }

    // ---------------------------------------------------
    // STOP STREAMING
    // ---------------------------------------------------

    function stopStreaming() {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }

        awaitingResultRef.current = false;
        setSending(false);
    }

    // ---------------------------------------------------
    // UI
    // ---------------------------------------------------

    return (
        <div className="flex min-h-screen flex-col items-center gap-6 bg-gray-100 p-10">
            <h1 className="text-3xl font-bold">
                YOLO Realtime Detection
            </h1>

            <div>
                Socket Status:{' '}
                <span
                    className={
                        connected
                            ? 'text-green-600'
                            : 'text-red-600'
                    }
                >
                    {connected
                        ? 'Connected'
                        : 'Disconnected'}
                </span>
            </div>

            <div className="relative inline-block overflow-hidden rounded-lg border bg-black shadow-lg">
                <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    width={640}
                    height={480}
                    className="block"
                />

                <canvas
                    ref={
                        overlayCanvasRef
                    }
                    className="pointer-events-none absolute inset-0"
                />
            </div>

            <canvas
                ref={captureCanvasRef}
                className="hidden"
            />

            <div className="flex gap-4">
                <button
                    onClick={
                        startStreaming
                    }
                    disabled={sending}
                    className="rounded bg-black px-6 py-3 text-white disabled:opacity-50"
                >
                    {sending
                        ? 'Streaming...'
                        : 'Start Streaming'}
                </button>

                <button
                    onClick={
                        stopStreaming
                    }
                    className="rounded bg-red-600 px-6 py-3 text-white"
                >
                    Stop
                </button>
            </div>
        </div>
    );
}