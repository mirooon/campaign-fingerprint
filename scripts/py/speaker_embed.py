"""Speaker embeddings (SpeechBrain ECAPA-TDNN, VoxCeleb) for 16 kHz mono WAV files.

Usage: python speaker_embed.py --savedir <model dir> [--windows --vad-dir <VAD model dir> [--window-seconds 4 --step-seconds 2]] <file.wav> [...]
Without --windows prints one JSON object {"model": ..., "embeddings": {file: [192 floats, L2-normalised] | null}}
(one vector for the first --max-seconds of the file).
With --windows prints {"model": ..., "windows": {file: [{start, end, levelDb, speech, embedding}] | null}}: the
file cut into windows (seconds), each with its level in dBFS, a speech score 0-1 (mean speech probability of
the SpeechBrain VAD: about 0 for music, noise and silence, near 1 for a voice) and its own vector.
The models are fetched from Hugging Face into --savedir / --vad-dir on first use and loaded from there afterwards.
"""
import argparse
import json
import sys

import numpy as np
import soundfile as sf
import torch
from speechbrain.inference.speaker import EncoderClassifier
from speechbrain.inference.VAD import VAD

MODEL = "speechbrain/spkrec-ecapa-voxceleb"
VAD_MODEL = "speechbrain/vad-crdnn-libriparty"
MIN_SECONDS = 1.0
SAMPLE_RATE = 16000
VAD_FRAMES_PER_SECOND = 100


def load_classifier(savedir: str) -> EncoderClassifier:
    """Loads the ECAPA model from `savedir` (fetched there on first use), on the CPU."""
    return EncoderClassifier.from_hparams(source=MODEL, savedir=savedir, run_opts={"device": "cpu"})


def read_mono(path: str) -> tuple[np.ndarray, int]:
    """Reads a WAV as mono float32 and returns it with its sample rate."""
    wav, sr = sf.read(path, dtype="float32", always_2d=True)
    return wav.mean(axis=1), sr


def normalise(emb: np.ndarray) -> list[float] | None:
    """L2-normalises a vector to a rounded list; None for a zero vector."""
    n = float(np.linalg.norm(emb))
    return [round(float(x) / n, 6) for x in emb] if n > 0 else None


def load_vad(savedir: str) -> VAD:
    """Loads the SpeechBrain voice-activity model (CRDNN trained on LibriParty with noise and music) from `savedir` (fetched there on first use), on the CPU."""
    return VAD.from_hparams(source=VAD_MODEL, savedir=savedir, run_opts={"device": "cpu"})


def embed_windows(clf: EncoderClassifier, vad: VAD, path: str, window_s: float, step_s: float, max_seconds: float) -> list[dict] | None:
    """Cuts a recording into windows of `window_s` every `step_s` seconds (at most `max_seconds` in all) and embeds each;
    `speech` is the mean speech probability of the VAD (0 for music, noise and silence, near 1 for a voice).
    None when it is not 16 kHz or shorter than one window."""
    wav, sr = read_mono(path)
    win, step = int(window_s * sr), int(step_s * sr)
    wav = wav[: int(max_seconds * sr)]
    if sr != SAMPLE_RATE or len(wav) < win:
        return None
    probs = vad.get_speech_prob_file(path).squeeze().numpy()
    starts = list(range(0, len(wav) - win + 1, step))
    chunks = np.stack([wav[s : s + win] for s in starts])
    with torch.no_grad():
        embs = clf.encode_batch(torch.from_numpy(chunks)).squeeze(1).numpy().astype(np.float64)
    out = []
    for s, chunk, emb in zip(starts, chunks, embs):
        vec = normalise(emb)
        if vec is None:
            continue
        rms = float(np.sqrt((chunk.astype(np.float64) ** 2).mean()))
        out.append(
            {
                "start": round(s / sr, 2),
                "end": round((s + win) / sr, 2),
                "levelDb": round(20 * float(np.log10(rms + 1e-9)), 1),
                "speech": round(float(probs[int(s / sr * VAD_FRAMES_PER_SECOND) : int((s + win) / sr * VAD_FRAMES_PER_SECOND)].mean()), 3),
                "embedding": vec,
            }
        )
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--savedir", required=True)
    ap.add_argument("--max-seconds", type=float, default=120.0)
    ap.add_argument("--windows", action="store_true")
    ap.add_argument("--vad-dir", help="folder of the VAD model (required with --windows)")
    ap.add_argument("--window-seconds", type=float, default=4.0)
    ap.add_argument("--step-seconds", type=float, default=2.0)
    ap.add_argument("files", nargs="+")
    args = ap.parse_args()

    clf = load_classifier(args.savedir)
    vad = load_vad(args.vad_dir) if args.windows else None
    out: dict[str, object] = {}
    for f in args.files:
        try:
            if args.windows:
                out[f] = embed_windows(clf, vad, f, args.window_seconds, args.step_seconds, args.max_seconds)
                continue
            wav, sr = read_mono(f)
            if sr != SAMPLE_RATE or len(wav) < MIN_SECONDS * sr:
                out[f] = None
                continue
            wav = wav[: int(args.max_seconds * sr)]
            with torch.no_grad():
                emb = clf.encode_batch(torch.from_numpy(wav).unsqueeze(0)).squeeze().numpy().astype(np.float64)
            out[f] = normalise(emb)
        except Exception as e:  # one bad file must not drop the batch
            print(f"{f}: {e}", file=sys.stderr)
            out[f] = None
    json.dump({"model": MODEL, "windows" if args.windows else "embeddings": out}, sys.stdout)
    return 0


if __name__ == "__main__":
    sys.exit(main())
