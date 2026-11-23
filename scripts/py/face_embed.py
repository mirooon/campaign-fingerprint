"""Faces and 128-d embeddings (OpenCV YuNet detector + SFace recognizer) for images.

Usage:
  python face_embed.py [--model-dir DIR] <image> [...]
      Prints one JSON object {"model": ..., "faces": {image: [{x, y, w, h, score, embedding}]}, "errors": {image: message}}.
      `embedding` is the L2-normalised SFace vector; box in pixels of the original image; score is the YuNet score (0-1).
      An image without a face gives an empty list. Exit code 0 even when single images fail (see "errors").
  python face_embed.py [--model-dir DIR] --build-index data/faces
      Reads data/faces/<person-id>/*.jpg (the largest face of each photo) and writes data/faces/index.json
      {"model": ..., "persons": {id: [vectors]}, "sources": {id: [file names]}}.
Models are read from --model-dir (default env FACE_MODEL_DIR, then ~/models/opencv); fetched by scripts/py/setup-face.sh.
"""
import argparse
import json
import os
import sys

import cv2
import numpy as np

MODEL = "yunet-2023mar+sface-2021dec"
DETECTOR_FILE = "face_detection_yunet_2023mar.onnx"
RECOGNIZER_FILE = "face_recognition_sface_2021dec.onnx"
SCORE_THRESHOLD = 0.6  # keep weaker detections out; the quality of the rest lowers the match weight in face.ts
MAX_SIDE = 1600  # larger pictures are shrunk for detection (boxes are scaled back)
IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp")


def load_models(model_dir: str):
    """YuNet detector and SFace recognizer from the ONNX files in model_dir."""
    detector = cv2.FaceDetectorYN.create(os.path.join(model_dir, DETECTOR_FILE), "", (320, 320), SCORE_THRESHOLD, 0.3, 50)
    recognizer = cv2.FaceRecognizerSF.create(os.path.join(model_dir, RECOGNIZER_FILE), "")
    return detector, recognizer


def faces_in(path: str, detector, recognizer) -> list[dict]:
    """Faces of one image: box in original pixels, detector score and the normalised 128-d vector."""
    img = cv2.imread(path)
    if img is None:
        raise ValueError("cannot read the image")
    h, w = img.shape[:2]
    scale = min(1.0, MAX_SIDE / max(h, w))
    if scale < 1.0:
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    detector.setInputSize((img.shape[1], img.shape[0]))
    _, rows = detector.detect(img)
    out: list[dict] = []
    for row in rows if rows is not None else []:
        feature = recognizer.feature(recognizer.alignCrop(img, row)).flatten().astype(np.float64)
        norm = float(np.linalg.norm(feature))
        if norm == 0:
            continue
        x, y, bw, bh = (float(v) / scale for v in row[:4])
        out.append(
            {
                "x": round(x),
                "y": round(y),
                "w": round(bw),
                "h": round(bh),
                "score": round(float(row[-1]), 4),
                "embedding": [round(float(v) / norm, 6) for v in feature],
            }
        )
    return out


def build_index(root: str, detector, recognizer) -> int:
    """Writes <root>/index.json from <root>/<person-id>/*.jpg; returns the exit code (1 when a person has no usable photo)."""
    persons: dict[str, list[list[float]]] = {}
    sources: dict[str, list[str]] = {}
    status = 0
    for person in sorted(os.listdir(root)):
        folder = os.path.join(root, person)
        if not os.path.isdir(folder):
            continue
        for name in sorted(os.listdir(folder)):
            if not name.lower().endswith(IMAGE_EXTENSIONS):
                continue
            try:
                found = faces_in(os.path.join(folder, name), detector, recognizer)
            except Exception as e:  # reported below, the index is built from the other photos
                print(f"{person}/{name}: {e}", file=sys.stderr)
                continue
            if not found:
                print(f"{person}/{name}: no face detected", file=sys.stderr)
                continue
            if len(found) > 1:
                print(f"{person}/{name}: {len(found)} faces, taking the largest", file=sys.stderr)
            best = max(found, key=lambda f: f["w"] * f["h"])
            persons.setdefault(person, []).append(best["embedding"])
            sources.setdefault(person, []).append(name)
        if person not in persons:
            print(f"{person}: no usable photo", file=sys.stderr)
            status = 1
    with open(os.path.join(root, "index.json"), "w", encoding="utf8") as f:
        json.dump({"model": MODEL, "persons": persons, "sources": sources}, f, separators=(",", ":"))
        f.write("\n")
    return status


def main() -> int:
    """Command line: embeds the given images (JSON on stdout) or builds the reference index."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--model-dir", default=os.environ.get("FACE_MODEL_DIR") or os.path.expanduser("~/models/opencv"))
    ap.add_argument("--build-index", metavar="DIR")
    ap.add_argument("images", nargs="*")
    args = ap.parse_args()

    detector, recognizer = load_models(args.model_dir)
    if args.build_index:
        return build_index(args.build_index, detector, recognizer)

    faces: dict[str, list[dict]] = {}
    errors: dict[str, str] = {}
    for path in args.images:
        try:
            faces[path] = faces_in(path, detector, recognizer)
        except Exception as e:  # one bad file must not drop the batch; the reason goes to the output
            faces[path] = []
            errors[path] = str(e)
    json.dump({"model": MODEL, "faces": faces, "errors": errors}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
