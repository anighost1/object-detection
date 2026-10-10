import sys
import json
import base64
import io
from typing import Any

import cv2
import numpy as np
from PIL import Image
from ultralytics import YOLO
import torch
import time

# MODEL_PATH = "yolo.pt"
MODEL_PATH = "../detectionservice/yolo.pt"
CONFIDENCE_THRESHOLD = 0.25
IOU_THRESHOLD = 0.45

# ---------------------------------------------------
# LOAD MODEL ONLY ONCE
# ---------------------------------------------------

print("Loading YOLO model...", file=sys.stderr)

model = YOLO(MODEL_PATH)

print("YOLO model loaded.", file=sys.stderr)

USE_CUDA = torch.cuda.is_available()

print(f"CUDA available: {USE_CUDA}", file=sys.stderr)

if USE_CUDA:
    print(
        f"GPU: {torch.cuda.get_device_name(0)}",
        file=sys.stderr,
    )
else:
    print("Using CPU for inference", file=sys.stderr)

# ---------------------------------------------------
# DETECTION
# ---------------------------------------------------


def mask_to_polygon(mask: np.ndarray) -> list[list[float]]:
    """Convert a binary mask to polygon coordinates."""
    mask_uint8 = (mask * 255).astype(np.uint8)
    contours, _ = cv2.findContours(
        mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )

    if not contours:
        return []

    # Get the largest contour
    largest_contour = max(contours, key=cv2.contourArea)
    polygon = largest_contour.squeeze().tolist()

    # Ensure polygon is a list of [x, y] pairs
    if isinstance(polygon[0], (int, float)):
        # Single point case
        polygon = [polygon]
    elif not isinstance(polygon[0], list):
        polygon = [[float(p[0]), float(p[1])] for p in polygon]
    else:
        polygon = [[float(p[0]), float(p[1])] for p in polygon]

    return polygon


def run_model(image: Image.Image) -> list[dict[str, Any]]:
    start = time.perf_counter()

    results = model.predict(
        image,
        verbose=False,
        conf=CONFIDENCE_THRESHOLD,
        iou=IOU_THRESHOLD,
        imgsz=640,
        device=0 if USE_CUDA else "cpu",
        half=USE_CUDA,
    )

    inference_ms = (time.perf_counter() - start) * 1000

    print(
        f"YOLO inference: {inference_ms:.1f} ms",
        file=sys.stderr,
    )

    # Keep your existing result parsing and detection logic below.
    detections: list[dict[str, Any]] = []

    result = results[0]
    names = model.names
    has_masks = result.masks is not None

    for idx, box in enumerate(result.boxes):
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        class_id = int(box.cls[0])
        confidence = float(box.conf[0])

        detection_dict = {
            "label": names[class_id],
            "class_id": class_id,
            "confidence": round(confidence, 4),
            "bbox": {
                "x1": round(float(x1), 2),
                "y1": round(float(y1), 2),
                "x2": round(float(x2), 2),
                "y2": round(float(y2), 2),
            },
        }

        if has_masks and idx < len(result.masks.data):
            mask = result.masks.data[idx].cpu().numpy()
            polygon = mask_to_polygon(mask)

            if polygon:
                detection_dict["segments"] = polygon

        detections.append(detection_dict)

    return detections


# ---------------------------------------------------
# BASE64 IMAGE DECODER
# ---------------------------------------------------


def decode_base64_image(base64_string: str) -> Image.Image:
    image_bytes = base64.b64decode(base64_string)

    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

    return image


# ---------------------------------------------------
# MAIN WORKER LOOP
# ---------------------------------------------------

print("Python YOLO worker ready.", file=sys.stderr)

while True:
    try:
        # Read one line from stdin
        line = sys.stdin.readline()

        # EOF / closed pipe
        if not line:
            break

        line = line.strip()

        if not line:
            continue

        # Parse JSON payload
        payload = json.loads(line)

        frame_id = payload.get("frameId")
        image_base64 = payload.get("image")

        if not image_base64:
            response = {
                "success": False,
                "error": "No image field provided",
                "frameId": frame_id,
            }

            print(json.dumps(response), flush=True)
            continue

        # Decode image
        image = decode_base64_image(image_base64)

        # Run YOLO
        detections = run_model(image)

        # Build response
        response = {
            "success": True,
            "frameId": frame_id,
            "count": len(detections),
            "detections": detections,
        }

        # IMPORTANT:
        # flush=True ensures Node receives output immediately
        print(json.dumps(response), flush=True)

    except Exception as e:
        error_response = {
            "success": False,
            "error": str(e),
        }

        print(json.dumps(error_response), flush=True)
