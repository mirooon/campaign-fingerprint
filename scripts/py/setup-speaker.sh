#!/usr/bin/env bash
# Venv for the SpeechBrain speaker adapter (lib/media/speaker.ts) and, optionally, MetaAdsCollector.
# Usage: bash scripts/py/setup-speaker.sh   (from the starter directory; needs uv)
set -euo pipefail
cd "$(dirname "$0")/../.."
uv venv --python 3.12 .venv-speaker
uv pip install --python .venv-speaker/bin/python speechbrain torch torchaudio soundfile
# fetch the ECAPA model once (~85 MB) so later runs are offline
.venv-speaker/bin/python -c "from speechbrain.inference.speaker import EncoderClassifier as E; import os; E.from_hparams(source='speechbrain/spkrec-ecapa-voxceleb', savedir=os.environ.get('SPEAKER_MODEL_DIR', os.path.expanduser('~/models/speechbrain/spkrec-ecapa-voxceleb')))"
# Meta Ad Library lookup (lib/osint/adLibrary.ts)
uv tool install meta-ads-collector || true
