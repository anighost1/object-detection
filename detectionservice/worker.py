import os
import sys
import json
import base64
import time
from typing import Any

import cv2
import numpy as np
import torch
from ultralytics import YOLO

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(BASE_DIR, "yolo.pt")

CONFIDENCE_THRESHOLD = float(os.getenv("YOLO_CONF", "0.25"))
IOU_THRESHOLD = float(os.getenv("YOLO_IOU", "0.45"))
IMAGE_SIZE = int(os.getenv("YOLO_IMGSZ", "512"))
MAX_DETECTIONS = int(os.getenv("YOLO_MAX_DET", "60"))
RETURN_SEGMENTS = os.getenv("YOLO_SEGMENTS", "1") == "1"
MAX_POLYGON_POINTS = int(os.getenv("YOLO_MAX_POLYGON_POINTS", "160"))

USE_CUDA = torch.cuda.is_available()
DEVICE = 0 if USE_CUDA else "cpu"

print("Loading YOLO model...", file=sys.stderr, flush=True)
model = YOLO(MODEL_PATH)

print(
    f"YOLO ready | device={DEVICE} | imgsz={IMAGE_SIZE} "
    f"| segments={RETURN_SEGMENTS}",
    file=sys.stderr,
    flush=True,
)


def decode_image(data: str) -> np.ndarray:
    """Decode plain base64 or a data URL into a BGR image."""
    if not isinstance(data, str) or not data:
        raise ValueError("Missing image data")

    if data.startswith("data:") and "," in data:
        data = data.split(",", 1)[1]

    raw = base64.b64decode(data, validate=True)
    encoded = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_COLOR)

    if image is None:
        raise ValueError("Invalid or unsupported image")

    return image


def simplify_polygon(points: np.ndarray) -> list[list[float]]:
    """Simplify an original-image pixel contour."""
    points = np.asarray(points, dtype=np.float32)

    if points.ndim != 2 or points.shape[0] < 3 or points.shape[1] != 2:
        return []

    contour = points.reshape(-1, 1, 2)
    perimeter = cv2.arcLength(contour, True)
    epsilon = max(1.0, perimeter * 0.003)
    polygon = cv2.approxPolyDP(contour, epsilon, True)

    while len(polygon) > MAX_POLYGON_POINTS and epsilon < max(2.0, perimeter * 0.05):
        epsilon *= 1.5
        polygon = cv2.approxPolyDP(contour, epsilon, True)

    polygon = polygon.reshape(-1, 2)

    if len(polygon) < 3:
        return []

    return [[round(float(x), 1), round(float(y), 1)] for x, y in polygon]


def run_model(
    image: np.ndarray,
) -> tuple[list[dict[str, Any]], float]:
    if USE_CUDA:
        torch.cuda.synchronize()

    start = time.perf_counter()

    results = model.predict(
        source=image,
        verbose=False,
        conf=CONFIDENCE_THRESHOLD,
        iou=IOU_THRESHOLD,
        imgsz=IMAGE_SIZE,
        device=DEVICE,
        half=USE_CUDA,
        rect=True,
        max_det=MAX_DETECTIONS,
        augment=False,
    )

    if USE_CUDA:
        torch.cuda.synchronize()

    inference_ms = (time.perf_counter() - start) * 1000
    result = results[0]
    detections: list[dict[str, Any]] = []

    if result.boxes is None or len(result.boxes) == 0:
        return detections, inference_ms

    # Transfer tensors in batches, not once per detection.
    boxes = result.boxes.xyxy.cpu().numpy()
    classes = result.boxes.cls.cpu().numpy().astype(np.int32)
    scores = result.boxes.conf.cpu().numpy()
    names = result.names

    # Ultralytics scales these polygons to the original input image.
    polygons = result.masks.xy if RETURN_SEGMENTS and result.masks is not None else None

    for i, coords in enumerate(boxes):
        x1, y1, x2, y2 = coords
        class_id = int(classes[i])

        item: dict[str, Any] = {
            "label": names[class_id],
            "class_id": class_id,
            "confidence": round(float(scores[i]), 4),
            "bbox": {
                "x1": round(float(x1), 1),
                "y1": round(float(y1), 1),
                "x2": round(float(x2), 1),
                "y2": round(float(y2), 1),
            },
        }

        if polygons is not None and i < len(polygons):
            polygon = simplify_polygon(polygons[i])
            if polygon:
                item["segments"] = polygon

        detections.append(item)

    return detections, inference_ms


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue

    frame_id = None

    try:
        payload = json.loads(line)
        frame_id = payload.get("frameId")
        image_data = payload.get("image")

        if not image_data:
            raise ValueError("No image field provided")

        total_start = time.perf_counter()

        decode_start = time.perf_counter()
        image = decode_image(image_data)
        decode_ms = (time.perf_counter() - decode_start) * 1000

        height, width = image.shape[:2]

        detections, inference_ms = run_model(image)
        processing_ms = (time.perf_counter() - total_start) * 1000

        response = {
            "success": True,
            "frameId": frame_id,
            "count": len(detections),
            "imageWidth": width,
            "imageHeight": height,
            "detections": detections,
            "timing": {
                "decodeMs": round(decode_ms, 2),
                "inferenceMs": round(inference_ms, 2),
                "processingMs": round(processing_ms, 2),
            },
        }

        print(json.dumps(response, separators=(",", ":")), flush=True)

    except Exception as exc:
        print(
            json.dumps(
                {
                    "success": False,
                    "frameId": frame_id,
                    "error": str(exc),
                }
            ),
            flush=True,
        )
