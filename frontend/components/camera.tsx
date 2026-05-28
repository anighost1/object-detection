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

    const captureCanvasRef =
        useRef<HTMLCanvasElement | null>(null);

    const overlayCanvasRef =
        useRef<HTMLCanvasElement | null>(null);

    const socketRef = useRef<Socket | null>(null);

    const intervalRef = useRef<NodeJS.Timeout | null>(
        null
    );

    const [connected, setConnected] =
        useState(false);

    const [sending, setSending] =
        useState(false);

    // ---------------------------------------------------
    // SYNC OVERLAY SIZE
    // ---------------------------------------------------

    function syncOverlayCanvas(
        video: HTMLVideoElement,
        overlayCanvas: HTMLCanvasElement
    ) {
        const width = video.videoWidth || 640;

        const height = video.videoHeight || 480;

        overlayCanvas.width = width;
        overlayCanvas.height = height;

        overlayCanvas.style.width = `${video.clientWidth || width
            }px`;

        overlayCanvas.style.height = `${video.clientHeight || height
            }px`;
    }

    // ---------------------------------------------------
    // DRAW DETECTIONS
    // ---------------------------------------------------

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

        detections.forEach(
            (detection, index) => {
                const bbox = detection.bbox;

                if (!bbox) {
                    return;
                }

                if (
                    !isNumber(bbox.x1) ||
                    !isNumber(bbox.y1) ||
                    !isNumber(bbox.x2) ||
                    !isNumber(bbox.y2)
                ) {
                    return;
                }

                const x = bbox.x1;
                const y = bbox.y1;

                const width =
                    bbox.x2 - bbox.x1;

                const height =
                    bbox.y2 - bbox.y1;

                const color = getColor(index);

                // BOX
                ctx.strokeStyle = color;
                ctx.lineWidth = 3;

                ctx.strokeRect(
                    x,
                    y,
                    width,
                    height
                );

                // LABEL
                const label =
                    detection.label || 'object';

                const confidence =
                    detection.confidence || 0;

                const text = `${label} ${Math.round(
                    confidence * 100
                )}%`;

                ctx.font =
                    '600 14px sans-serif';

                const textWidth =
                    ctx.measureText(text).width;

                ctx.fillStyle =
                    'rgba(0,0,0,0.7)';

                ctx.fillRect(
                    x,
                    Math.max(y - 28, 0),
                    textWidth + 14,
                    24
                );

                ctx.fillStyle = '#ffffff';

                ctx.fillText(
                    text,
                    x + 7,
                    Math.max(y - 10, 14)
                );
            }
        );
    }

    // ---------------------------------------------------
    // START CAMERA
    // ---------------------------------------------------

    async function startCamera() {
        try {
            const stream =
                await navigator.mediaDevices.getUserMedia(
                    {
                        video: {
                            width: 640,
                            height: 480
                        },
                        audio: false
                    }
                );

            if (videoRef.current) {
                videoRef.current.srcObject =
                    stream;
            }
        } catch (err) {
            console.error(err);
        }
    }

    // ---------------------------------------------------
    // SOCKET SETUP
    // ---------------------------------------------------

    useEffect(() => {
        const socket = io(
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

        socket.on(
            'detection-result',
            (data) => {
                drawMarkings(data);
            }
        );

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
        if (sending) {
            return;
        }

        setSending(true);

        const captureCanvas =
            captureCanvasRef.current;

        const video = videoRef.current;

        if (
            !captureCanvas ||
            !video
        ) {
            setSending(false);
            return;
        }

        const ctx =
            captureCanvas.getContext('2d');

        if (!ctx) {
            setSending(false);
            return;
        }

        let frameId = 0;

        intervalRef.current =
            setInterval(() => {
                if (
                    video.videoWidth === 0 ||
                    video.videoHeight === 0
                ) {
                    return;
                }

                captureCanvas.width =
                    video.videoWidth;

                captureCanvas.height =
                    video.videoHeight;

                // DRAW VIDEO FRAME
                ctx.drawImage(
                    video,
                    0,
                    0
                );

                // COMPRESS FRAME
                const dataUrl =
                    captureCanvas.toDataURL(
                        'image/jpeg',
                        0.5
                    );

                // SEND TO NODE SERVER
                socketRef.current?.emit(
                    'detect-frame',
                    {
                        frameId:
                            frameId++,
                        image: dataUrl
                    }
                );
            }, 200);
    }

    // ---------------------------------------------------
    // STOP STREAMING
    // ---------------------------------------------------

    function stopStreaming() {
        if (intervalRef.current) {
            clearInterval(
                intervalRef.current
            );

            intervalRef.current = null;
        }

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