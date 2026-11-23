#!/usr/bin/env bash
# Venv and models for the face adapter (lib/media/face.ts): OpenCV YuNet (MIT) detects faces,
# SFace (Apache-2.0) embeds them; opencv-python-headless is Apache-2.0. No other face weights.
# Usage: bash scripts/py/setup-face.sh   (from the repo directory; needs uv)
#   FACE_VENV=.venv-speaker  add opencv to an existing adapter venv instead of creating .venv-face
#   FACE_MODEL_DIR=~/models/opencv  where the two ONNX files go (outside the repo, ~40 MB)
set -euo pipefail
cd "$(dirname "$0")/../.."
VENV="${FACE_VENV:-.venv-face}"
MODEL_DIR="${FACE_MODEL_DIR:-$HOME/models/opencv}"
ZOO="https://github.com/opencv/opencv_zoo/raw/main/models"

[ -x "$VENV/bin/python" ] || uv venv --python 3.12 "$VENV"
uv pip install --python "$VENV/bin/python" opencv-python-headless numpy

mkdir -p "$MODEL_DIR"
fetch() { # <relative path in OpenCV Zoo> <file name>
  [ -s "$MODEL_DIR/$2" ] || curl -fsSL "$ZOO/$1/$2" -o "$MODEL_DIR/$2"
}
fetch face_detection_yunet face_detection_yunet_2023mar.onnx
fetch face_recognition_sface face_recognition_sface_2021dec.onnx
echo "done: FACE_PYTHON=$PWD/$VENV/bin/python FACE_MODEL_DIR=$MODEL_DIR"
