# Image for evaluators: GUI (Next.js) and every CLI (`bun run base | analyze-material | demo ...`) with
# the media tools, no network at run time and no data other than data/sample.
#   target `run`  (default): bun, node_modules, built GUI, tesseract (pol), ffmpeg, chromaprint, Python venv
#   target `full`: + whisper.cpp (model mounted from the host, WHISPER_MODEL) and SpeechBrain on CPU torch
ARG BUN_VERSION=1.4.4

FROM oven/bun:${BUN_VERSION} AS bun

# --- system layer shared by every stage: node + bun + media tools + Python venv ---
FROM node:22-slim AS system
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-pol ffmpeg libchromaprint-tools unzip python3 python3-venv ca-certificates \
    && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"
WORKDIR /app
COPY scripts/py/requirements.txt scripts/py/requirements.txt
RUN pip install --no-cache-dir -r scripts/py/requirements.txt

# --- build of the GUI ---
FROM system AS build
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN bun run build

# --- default image ---
FROM system AS run
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
    TZ=Europe/Warsaw HF_HUB_OFFLINE=1 BUN_BIN=/usr/local/bin/bun \
    VIEWER_DATA_DIR=/dane/baza DEMO_OUT=/dane/demo MATERIAL_WORK_DIR=/dane/praca ANALYZE_OFFLINE=1 \
    CACHE_DIR=/tmp/cache HOME=/home/node
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json /app/tsconfig.json /app/next.config.ts ./
COPY --from=build /app/app ./app
COPY --from=build /app/components ./components
COPY --from=build /app/lib ./lib
COPY --from=build /app/types ./types
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/data ./data
RUN mkdir -p /dane && chown node:node /dane /app
USER node
VOLUME ["/dane"]
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", "3000"]

# --- profile `full`: whisper.cpp (ASR) and SpeechBrain (speaker) ---
FROM system AS whisper
RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake git \
    && rm -rf /var/lib/apt/lists/* \
    && git clone --depth 1 --branch v1.7.6 https://github.com/ggml-org/whisper.cpp /whisper.cpp \
    && cmake -S /whisper.cpp -B /whisper.cpp/build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF -DGGML_NATIVE=OFF \
    && cmake --build /whisper.cpp/build --target whisper-cli -j 4

FROM run AS full
USER root
COPY --from=whisper /whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY docker/requirements-full.txt /tmp/requirements-full.txt
RUN python3 -m venv /opt/venv-speaker \
    && /opt/venv-speaker/bin/pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu torch torchaudio \
    && /opt/venv-speaker/bin/pip install --no-cache-dir -r /tmp/requirements-full.txt
USER node
# models are mounted from the host (see docker-compose.yml): WHISPER_MODEL, SPEAKER_MODEL_DIR
ENV SPEAKER_PYTHON=/opt/venv-speaker/bin/python WHISPER_MODEL=/models/whisper/ggml-large-v3-turbo.bin SPEAKER_MODEL_DIR=/models/speechbrain/spkrec-ecapa-voxceleb
