"""Measures the match threshold of the face adapter (docs/TECHNICAL.md, "Próg twarzy").

Usage: python face_threshold.py --index data/faces/index.json --strangers <dir with photos of OTHER people> [--model-dir DIR]
  Same person (leave-one-out): each reference photo is compared with the other photos of the same person
  (the best cosine); a hit when it is the highest of the closed list and reaches the threshold.
  Different people: every face of the stranger photos is compared with all references; a false hit when the
  best cosine reaches the threshold. Both with the quality weight of lib/media/face.ts (size and detector score).
Prints a table per threshold and the lowest threshold with a false-hit rate on strangers <= --max-far.
The stranger photos stay outside the repository; only the numbers go to the docs.
"""
import argparse
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # also under `python -I`, which drops the script directory
from face_embed import faces_in, load_models  # noqa: E402  (same detector settings as the adapter)

# keep in step with DEFAULT_FACE_CONFIG in lib/media/face.ts
MIN_SIDE, REF_SIDE, REF_SCORE = 24, 80, 0.9


def quality(face: dict) -> float:
    """Weight 0-1 of a face: shorter side and detector score (same formula as faceQuality in face.ts)."""
    return min(1.0, min(face["w"], face["h"]) / REF_SIDE) * min(1.0, face["score"] / REF_SCORE)


def main() -> int:
    """Command line: prints the hit and false-hit rates per threshold for the index and the stranger photos."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--index", default="data/faces/index.json")
    ap.add_argument("--strangers", required=True)
    ap.add_argument("--model-dir", default=os.environ.get("FACE_MODEL_DIR") or os.path.expanduser("~/models/opencv"))
    ap.add_argument("--max-far", type=float, default=0.01)
    args = ap.parse_args()

    index = json.load(open(args.index, encoding="utf8"))
    refs = {p: [np.array(v) for v in vs] for p, vs in index["persons"].items()}
    detector, recognizer = load_models(args.model_dir)

    genuine: list[tuple[float, bool]] = []  # (best cosine to the other photos of the person, was it the top person)
    for person, vecs in refs.items():
        for i, v in enumerate(vecs):
            others = [w for j, w in enumerate(vecs) if j != i]
            if not others:
                continue
            own = max(float(v @ w) for w in others)
            rival = max((float(v @ w) for q, ws in refs.items() if q != person for w in ws), default=-1.0)
            genuine.append((own, own > rival))

    impostor: list[float] = []
    top: list[tuple[float, str, str]] = []  # (weighted score, stranger file, person it resembles most)
    names = sorted(f for f in os.listdir(args.strangers) if f.lower().endswith((".jpg", ".jpeg", ".png", ".webp")))
    for name in names:
        faces = faces_in(os.path.join(args.strangers, name), detector, recognizer)
        if not faces:
            print(f"{name}: brak twarzy", file=sys.stderr)
            continue
        f = max(faces, key=lambda r: r["w"] * r["h"])
        if min(f["w"], f["h"]) < MIN_SIDE:
            continue
        e = np.array(f["embedding"])
        best, who = max((float(e @ w), p) for p, ws in refs.items() for w in ws)
        impostor.append(best * quality(f))
        top.append((best * quality(f), name, who))

    print(f"pary tej samej osoby (leave-one-out): {len(genuine)}; twarze obcych: {len(impostor)} ze zdjęć: {len(names)}")
    print("próg   trafienia tej samej osoby   fałszywe trafienia obcych")
    chosen = None
    for t in [x / 100 for x in range(20, 71, 2)]:
        tar = sum(1 for s, top in genuine if s >= t and top) / max(1, len(genuine))
        far = sum(1 for s in impostor if s >= t) / max(1, len(impostor))
        print(f"{t:.2f}   {tar:6.1%}                     {far:6.1%}")
        if chosen is None and far <= args.max_far:
            chosen = (t, tar, far)
    print("najwyższe wyniki obcych (do ręcznego sprawdzenia, czy to na pewno obca osoba):")
    for score, name, who in sorted(top, reverse=True)[:6]:
        print(f"  {score:.2f}  {name}  ~ {who}")
    if chosen:
        print(f"najniższy próg z fałszywymi trafieniami <= {args.max_far:.0%}: {chosen[0]:.2f} (trafienia {chosen[1]:.1%}, fałszywe {chosen[2]:.1%})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
