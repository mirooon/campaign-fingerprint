"""Builds the voice gallery (data/voices/index.json + data/voices/ZRODLA.md) from public recordings.

Usage: python build_voice_index.py --sources <zrodla.json> --work-dir <dir outside the repository> --model-dir <ECAPA model dir> --vad-dir <VAD model dir>
                                   [--index data/voices/index.json] [--zrodla data/voices/ZRODLA.md] [--only-download]

`--sources` is a JSON list of {"set": "gallery" | "strangers" | "fakes", "person": id, "url": "https://www.youtube.com/watch?v=...",
"start": seconds, "seconds": length (30-120)}. Each fragment is fetched as audio with yt-dlp (only the section, 16 kHz mono WAV)
into `--work-dir/<set>/<person>/`, cut into windows and embedded (speaker_embed.py). The recordings and the window vectors stay in
`--work-dir`, outside the repository; the repository gets only the reference vectors and the list of sources.

Reference vector of a recording = the mean of the windows of the speaker that fits the other recordings of the person best (an
interviewer or a co-host is a second cluster, not the person). A recording whose best cluster has a cosine below MIN_CONSISTENCY to the
other recordings of the person is dropped and reported. Only the "gallery" set goes into the index and into ZRODLA.md.
"""
import argparse
import importlib.util
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

import numpy as np

# Must equal DEFAULT_VOICE_CONFIG in lib/media/speaker.ts (a test compares them).
WINDOW_SECONDS = 4.0
STEP_SECONDS = 2.0
MIN_LEVEL_DB = -45.0
MIN_SPEECH = 0.5
# Cosine between windows of one speaker (clustering of the speakers of a recording) and of recordings of one person (consistency check).
CLUSTER_COSINE = 0.5
MIN_CONSISTENCY = 0.4
MIN_CLUSTER_WINDOWS = 3
MAX_FRAGMENT_SECONDS = 120
DOWNLOAD_THREADS = 8
YOUTUBE_LICENCE = "standard YouTube licence; use: computing a voice feature vector for research, the recording is neither stored in the repository nor published"


def load_embedder():
    """Loads scripts/py/speaker_embed.py as a module (the script is run with -I, so its directory is not on sys.path)."""
    spec = importlib.util.spec_from_file_location("speaker_embed", Path(__file__).with_name("speaker_embed.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def fetch_fragment(entry: dict, dest: Path) -> dict | None:
    """Downloads the section of one recording as 16 kHz mono WAV to `dest` (skipped when it exists) and returns its yt-dlp metadata
    (channel, title, licence, upload date); None when the download failed."""
    info_file = dest.with_suffix(".info.json")
    if dest.exists() and info_file.exists():
        return json.loads(info_file.read_text())
    start, end = entry["start"], entry["start"] + entry["seconds"]
    cmd = [
        "yt-dlp", "--no-warnings", "--quiet", "-f", "bestaudio", "-x", "--audio-format", "wav",
        "--postprocessor-args", "ffmpeg:-ar 16000 -ac 1", "--download-sections", f"*{start}-{end}",
        "--force-keyframes-at-cuts", "-o", str(dest.with_suffix(".%(ext)s")), "--print-json", entry["url"],
    ]
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0 or not dest.exists():
        print(f"{entry['url']}: yt-dlp did not download the fragment: {r.stderr.strip().splitlines()[-1:] }", file=sys.stderr)
        return None
    meta = json.loads(r.stdout.strip().splitlines()[-1])
    info = {k: meta.get(k) for k in ("id", "title", "channel", "license", "upload_date", "webpage_url")}
    info_file.write_text(json.dumps(info, ensure_ascii=False))
    return info


def speaker_clusters(windows: list[dict]) -> list[tuple[np.ndarray, int]]:
    """Groups the speech windows of a recording by speaker: greedily, the window with the most neighbours (cosine >= CLUSTER_COSINE)
    and its neighbours form a cluster. Returns (L2-normalised mean vector, number of windows) per cluster of at least
    MIN_CLUSTER_WINDOWS windows, largest first."""
    speech = [w for w in windows if w["levelDb"] >= MIN_LEVEL_DB and w["speech"] >= MIN_SPEECH]
    if not speech:
        return []
    vecs = np.array([w["embedding"] for w in speech])
    sim = vecs @ vecs.T
    free = np.ones(len(speech), dtype=bool)
    out = []
    while free.any():
        near = (sim >= CLUSTER_COSINE) & free[None, :]
        near[~free] = False
        seed = int(np.argmax(near.sum(axis=1)))
        members = near[seed] & free
        if members.sum() < MIN_CLUSTER_WINDOWS:
            break
        mean = vecs[members].mean(axis=0)
        out.append((mean / np.linalg.norm(mean), int(members.sum())))
        free &= ~members
    return out


def choose_clusters(candidates: dict[str, list[tuple[np.ndarray, int]]]) -> dict[str, np.ndarray | None]:
    """Picks for each recording of one person the speaker cluster that fits the other recordings best (three rounds, starting from the
    largest cluster); None for a recording whose best cluster has a cosine below MIN_CONSISTENCY to the others."""
    chosen: dict[str, np.ndarray | None] = {k: (v[0][0] if v else None) for k, v in candidates.items()}
    for _ in range(3):
        for key, clusters in candidates.items():
            others = [c for k, c in chosen.items() if k != key and c is not None]
            if not others or not clusters:
                continue
            ref = np.mean(others, axis=0)
            ref /= np.linalg.norm(ref)
            best = max(clusters, key=lambda c: float(c[0] @ ref))
            chosen[key] = best[0] if float(best[0] @ ref) >= MIN_CONSISTENCY else None
    return chosen


def write_zrodla(path: Path, rows: dict[str, list[dict]], names: dict[str, str]) -> None:
    """Writes the list of sources of the gallery: recording URL, time fragment, licence or basis of use, download date."""
    today = date.today().isoformat()
    lines = [
        "# Sources of the voice recordings (`data/voices`)",
        "",
        "Voice gallery of public figures from a closed list (`data/osoby-publiczne.json`, the same as for faces). **The repository holds only the voice feature vectors (192 numbers per recording, `index.json`) and this list of sources; the recordings are neither in the repository nor in the image.** The vector does not allow the voice to be reconstructed.",
        "",
        f"Basis of use: {YOUTUBE_LICENCE}. When a video has a Creative Commons licence, it is given in the Licence column. Download date of all fragments: {today} (yt-dlp, only the given audio fragment). The pattern of a person is the mean of the vectors of the recordings; fragments in which the person is not the dominant speaker or that do not match the other recordings were rejected (Used column).",
        "",
    ]
    for pid, recs in rows.items():
        lines += [f"## {names.get(pid, pid)} (`{pid}`)", "", "| Recording | Channel | Fragment | Licence | Used |", "|---|---|---|---|---|"]
        for r in recs:
            lic = r.get("license") or "standard YouTube licence (basis of use above)"
            lines.append(f"| {r['url']} | {r.get('channel') or ''} | {r['start']}–{r['start'] + r['seconds']} s | {lic} | {'yes' if r['used'] else 'no (' + r['why'] + ')'} |")
        lines.append("")
    path.write_text("\n".join(lines))


def main() -> int:
    """Downloads and embeds the recordings of `--sources`, picks the reference vector of each recording and writes the index and the list of sources."""
    ap = argparse.ArgumentParser()
    ap.add_argument("--sources", required=True)
    ap.add_argument("--work-dir", required=True)
    ap.add_argument("--model-dir", required=True)
    ap.add_argument("--vad-dir", required=True)
    ap.add_argument("--index")
    ap.add_argument("--zrodla")
    ap.add_argument("--persons-file", help="data/osoby-publiczne.json (names for ZRODLA.md)")
    ap.add_argument("--only-download", action="store_true")
    args = ap.parse_args()

    sources = json.loads(Path(args.sources).read_text())
    work = Path(args.work_dir)
    emb = None if args.only_download else load_embedder()
    clf = None
    vad = None
    rows: dict[str, list[dict]] = {}
    cands: dict[str, dict[str, list]] = {}
    valid = []
    for e in sources:
        if 30 <= e["seconds"] <= MAX_FRAGMENT_SECONDS:
            valid.append(e)
        else:
            print(f"{e['url']}: fragment {e['seconds']} s outside 30-{MAX_FRAGMENT_SECONDS} s, skipped", file=sys.stderr)

    def wav_of(e: dict) -> Path:
        """Path of the WAV of a source entry under `--work-dir/<set>/<person>/`."""
        folder = work / e["set"] / e["person"]
        folder.mkdir(parents=True, exist_ok=True)
        return folder / f"{e['url'].split('v=')[-1]}_{e['start']}.wav"

    with ThreadPoolExecutor(DOWNLOAD_THREADS) as pool:
        infos = list(pool.map(lambda e: fetch_fragment(e, wav_of(e)), valid))
    for e, info in zip(valid, infos):
        if info is None or args.only_download:
            continue
        wav = wav_of(e)
        wfile = wav.with_suffix(".windows.json")
        if not wfile.exists():
            clf = clf or emb.load_classifier(args.model_dir)
            vad = vad or emb.load_vad(args.vad_dir)
            windows = emb.embed_windows(clf, vad, str(wav), WINDOW_SECONDS, STEP_SECONDS, MAX_FRAGMENT_SECONDS)
            wfile.write_text(json.dumps(windows or []))
        windows = json.loads(wfile.read_text())
        if e["set"] == "gallery":
            key = wav.stem
            cands.setdefault(e["person"], {})[key] = speaker_clusters(windows)
            rows.setdefault(e["person"], []).append({**e, "channel": info.get("channel"), "license": info.get("license"), "key": key, "used": False, "why": ""})
    if args.only_download:
        return 0

    persons: dict[str, list[list[float]]] = {}
    for pid, byrec in cands.items():
        chosen = choose_clusters(byrec)
        for r in rows[pid]:
            vec = chosen.get(r["key"])
            if vec is None:
                r["why"] = "no clear speaker or inconsistent with the other recordings"
                continue
            r["used"] = True
            persons.setdefault(pid, []).append([round(float(x), 6) for x in vec])
        used = [np.array(v) for v in persons.get(pid, [])]
        if len(used) >= 2:
            m = np.array(used) @ np.array(used).T
            off = m[~np.eye(len(used), dtype=bool)]
            print(f"{pid}: {len(used)}/{len(rows[pid])} recordings, cosine between recordings: mean {off.mean():.2f}, min {off.min():.2f}", file=sys.stderr)
        else:
            print(f"{pid}: used {len(used)}/{len(rows[pid])} recordings", file=sys.stderr)
    if rows:
        (work / "gallery.json").write_text(json.dumps({pid: [{"key": r["key"], "used": r["used"]} for r in recs] for pid, recs in rows.items()}))
    if args.index:
        Path(args.index).write_text(json.dumps({"model": emb.MODEL, "persons": persons}, ensure_ascii=False, separators=(",", ":")) + "\n")
    if args.zrodla:
        names = {}
        if args.persons_file:
            names = {p["id"]: p["name"] for p in json.loads(Path(args.persons_file).read_text())}
        write_zrodla(Path(args.zrodla), rows, names)
    return 0


if __name__ == "__main__":
    sys.exit(main())
