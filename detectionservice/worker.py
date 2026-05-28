import sys
import json
import base64
import io
from typing import Any

from PIL import Image
from ultralytics import YOLO

MODEL_PATH = "yolo11n.pt"
CONFIDENCE_THRESHOLD = 0.25
IOU_THRESHOLD = 0.45

# ---------------------------------------------------
# LOAD MODEL ONLY ONCE
# ---------------------------------------------------

print("Loading YOLO model...", file=sys.stderr)

model = YOLO(MODEL_PATH)

print("YOLO model loaded.", file=sys.stderr)

# ---------------------------------------------------
# DETECTION
# ---------------------------------------------------


def run_model(image: Image.Image) -> list[dict[str, Any]]:
    results = model.predict(
        image,
        verbose=False,
        conf=CONFIDENCE_THRESHOLD,
        iou=IOU_THRESHOLD,
    )

    detections: list[dict[str, Any]] = []

    result = results[0]
    names = model.names

    for box in result.boxes:
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        class_id = int(box.cls[0])
        confidence = float(box.conf[0])

        detections.append(
            {
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
        )

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
