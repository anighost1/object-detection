from ultralytics import YOLO

model = YOLO("yolo26n.pt")

model.train(
    data="dataset.yaml",
    epochs=100,
    imgsz=640,
    batch=8,
)
