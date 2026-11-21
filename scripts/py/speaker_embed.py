"""Speaker embeddings (SpeechBrain ECAPA-TDNN, VoxCeleb) for 16 kHz mono WAV files.

Usage: python speaker_embed.py --savedir <model dir> <file.wav> [...]
Prints one JSON object {"model": ..., "embeddings": {file: [192 floats, L2-normalised] | null}}.
The model is fetched from Hugging Face into --savedir on first use and loaded from there afterwards.
"""
import argparse
import json
import sys

import numpy as np
import soundfile as sf
import torch
from speechbrain.inference.speaker import EncoderClassifier

MODEL = "speechbrain/spkrec-ecapa-voxceleb"
MIN_SECONDS = 1.0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--savedir", required=True)
    ap.add_argument("--max-seconds", type=float, default=120.0)
    ap.add_argument("files", nargs="+")
    args = ap.parse_args()

    clf = EncoderClassifier.from_hparams(source=MODEL, savedir=args.savedir, run_opts={"device": "cpu"})
    out: dict[str, list[float] | None] = {}
    for f in args.files:
        try:
            wav, sr = sf.read(f, dtype="float32", always_2d=True)
            wav = wav.mean(axis=1)
            if sr != 16000 or len(wav) < MIN_SECONDS * sr:
                out[f] = None
                continue
            wav = wav[: int(args.max_seconds * sr)]
            with torch.no_grad():
                emb = clf.encode_batch(torch.from_numpy(wav).unsqueeze(0)).squeeze().numpy().astype(np.float64)
            n = float(np.linalg.norm(emb))
            out[f] = [round(float(x) / n, 6) for x in emb] if n > 0 else None
        except Exception as e:  # one bad file must not drop the batch
            print(f"{f}: {e}", file=sys.stderr)
            out[f] = None
    json.dump({"model": MODEL, "embeddings": out}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
