import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { cleanTranscript, detectAsr, isWav16kMono, transcribe, type AsrStatus } from "./asr";
import type { RunResult, ToolRunner } from "./tools";

type Call = { cmd: string; args: string[] };

function fakeRunner(handler: (cmd: string, args: string[]) => Partial<RunResult>, calls: Call[] = []): ToolRunner {
  return async (cmd, args) => {
    calls.push({ cmd, args });
    return { code: 0, stdout: "", stderr: "", timedOut: false, ...handler(cmd, args) };
  };
}

const dir = mkdtempSync(path.join(tmpdir(), "starter-asr-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function wavHeader(rate: number, channels: number, dataBytes: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + dataBytes, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * channels * 2, 28);
  h.writeUInt16LE(channels * 2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(dataBytes, 40);
  return h;
}

function writeWav(file: string, rate: number, channels: number, samples = 1600): void {
  writeFileSync(file, Buffer.concat([wavHeader(rate, channels, samples * 2 * channels), Buffer.alloc(samples * 2 * channels)]));
}

const modelFile = path.join(dir, "ggml-test.bin");
writeFileSync(modelFile, "not really a model");
const mlxModelDir = path.join(dir, "mlx-model");
mkdirSync(mlxModelDir);
const emptyHub = path.join(dir, "hub");
mkdirSync(emptyHub);

describe("detectAsr", () => {
  it("prefers whisper-cli when the binary and the model file exist", async () => {
    const calls: Call[] = [];
    const s = await detectAsr({ run: fakeRunner(() => ({ stdout: "whisper.cpp version: 1.9.5" }), calls), env: { WHISPER_MODEL: modelFile } });
    expect(s).toEqual({ available: true, tool: "whisper-cli", model: modelFile, reason: null });
    expect(calls.map((c) => [c.cmd, ...c.args])).toEqual([["whisper-cli", "--version"]]);
  });

  it("falls back to mlx_whisper only when its model is local (no downloads)", async () => {
    const local = await detectAsr({ run: fakeRunner(() => ({})), env: { WHISPER_MODEL: path.join(dir, "missing.bin"), MLX_WHISPER_MODEL: mlxModelDir } });
    expect(local).toMatchObject({ available: true, tool: "mlx_whisper", model: mlxModelDir });

    const notCached = await detectAsr({
      run: fakeRunner(() => ({})),
      env: { WHISPER_MODEL: path.join(dir, "missing.bin"), MLX_WHISPER_MODEL: "example-org/whisper-not-downloaded", HF_HUB_CACHE: emptyHub },
    });
    expect(notCached.available).toBe(false);
    expect(notCached.reason).toContain("lokalnie");

    const cachedRepo = path.join(emptyHub, "models--example-org--whisper-cached");
    mkdirSync(cachedRepo);
    const cached = await detectAsr({
      run: fakeRunner((cmd) => (cmd === "whisper-cli" ? { code: null, stderr: "ENOENT" } : {})),
      env: { MLX_WHISPER_MODEL: "example-org/whisper-cached", HF_HUB_CACHE: emptyHub },
    });
    expect(cached).toMatchObject({ available: true, tool: "mlx_whisper", model: "example-org/whisper-cached" });
  });

  it("is unavailable with reasons when nothing is installed", async () => {
    const s = await detectAsr({ run: fakeRunner(() => ({ code: null, stderr: "ENOENT" })), env: {} });
    expect(s).toMatchObject({ available: false, tool: null, model: null });
    expect(s.reason).toContain("whisper-cli niedostępny");
    expect(s.reason).toContain("mlx_whisper niedostępny");
  });
});

describe("isWav16kMono / cleanTranscript", () => {
  it("recognises whisper-ready WAV files", async () => {
    const ok = path.join(dir, "ok.wav");
    writeWav(ok, 16000, 1);
    const stereo = path.join(dir, "stereo.wav");
    writeWav(stereo, 44100, 2);
    const junk = path.join(dir, "junk.wav");
    writeFileSync(junk, "definitely not RIFF data, just text padding to exceed 44 bytes....");
    expect(await isWav16kMono(ok)).toBe(true);
    expect(await isWav16kMono(stereo)).toBe(false);
    expect(await isWav16kMono(junk)).toBe(false);
    expect(await isWav16kMono(path.join(dir, "nope.wav"))).toBe(false);
  });

  it("strips timestamps and non-speech markers", () => {
    expect(cleanTranscript("[00:00:00.000 --> 00:00:04.200]   Adam Testowy poleca.\n[00:00:04.200 --> 00:00:06.000]  [BLANK_AUDIO]\n Zarejestruj się dziś.")).toBe(
      "Adam Testowy poleca. Zarejestruj się dziś.",
    );
    expect(cleanTranscript(" [BLANK_AUDIO] \n")).toBeNull();
  });

  it("drops a transcript that holds only the phrases whisper writes over silence", () => {
    expect(cleanTranscript("Dziękuję za uwagę. Dziękuję za uwagę. Dziękuję za uwagę. Dziękuję. w")).toBeNull();
    expect(cleanTranscript("Napisy stworzone przez społeczność Amara.org")).toBeNull();
    expect(cleanTranscript("Dziękuję za uwagę. Zarejestruj się dziś i odbierz bonus.")).toBe("Dziękuję za uwagę. Zarejestruj się dziś i odbierz bonus.");
  });
});

describe("transcribe", () => {
  const whisperStatus: AsrStatus = { available: true, tool: "whisper-cli", model: modelFile, reason: null };

  it("converts non-WAV input with ffmpeg, runs whisper-cli and cleans up its temp dir", async () => {
    const calls: Call[] = [];
    let outBase = "";
    const run = fakeRunner((cmd, args) => {
      if (cmd === "ffmpeg") {
        writeFileSync(args[args.length - 1], "RIFF-converted-audio");
        return {};
      }
      outBase = args[args.indexOf("-of") + 1];
      writeFileSync(`${outBase}.txt`, "[00:00:00.000 --> 00:00:03.000]  Kamil Demonstracyjny rozdaje nagrody.\n[BLANK_AUDIO]\n");
      return { stdout: "ignored when the txt file exists" };
    }, calls);
    const text = await transcribe("/data/reklama.mp4", { run, status: whisperStatus });
    expect(text).toBe("Kamil Demonstracyjny rozdaje nagrody.");
    expect(calls[0].cmd).toBe("ffmpeg");
    expect(calls[0].args.slice(0, 13)).toEqual(["-hide_banner", "-loglevel", "error", "-y", "-i", "/data/reklama.mp4", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"]);
    const wav = calls[0].args[13];
    expect(calls[1]).toEqual({ cmd: "whisper-cli", args: ["-m", modelFile, "-f", wav, "-l", "pl", "-nt", "-np", "-otxt", "-of", outBase] });
    expect(existsSync(path.dirname(outBase))).toBe(false);
  });

  it("feeds 16 kHz mono WAV directly and falls back to stdout", async () => {
    const wav = path.join(dir, "direct.wav");
    writeWav(wav, 16000, 1);
    const calls: Call[] = [];
    const text = await transcribe(wav, { run: fakeRunner(() => ({ stdout: " Zofia Wymyślona potwierdza zwrot. \n" }), calls), status: whisperStatus });
    expect(text).toBe("Zofia Wymyślona potwierdza zwrot.");
    expect(calls.map((c) => c.cmd)).toEqual(["whisper-cli"]);
    expect(calls[0].args[3]).toBe(wav);
  });

  it("returns null on failures and when ASR is unavailable", async () => {
    const wav = path.join(dir, "direct.wav");
    expect(await transcribe(wav, { run: fakeRunner(() => ({ code: 1, stderr: "failed to load model" })), status: whisperStatus })).toBeNull();
    expect(await transcribe(wav, { run: fakeRunner(() => ({ code: null, timedOut: true })), status: whisperStatus })).toBeNull();
    expect(await transcribe("/x.mp4", { run: fakeRunner((cmd) => (cmd === "ffmpeg" ? { code: 1 } : {})), status: whisperStatus })).toBeNull();
    const calls: Call[] = [];
    expect(await transcribe(wav, { run: fakeRunner(() => ({}), calls), status: { available: false, tool: null, model: null, reason: "brak" } })).toBeNull();
    expect(calls).toEqual([]);
  });

  it("uses mlx_whisper with a txt output directory", async () => {
    const calls: Call[] = [];
    const run = fakeRunner((_cmd, args) => {
      writeFileSync(path.join(args[args.indexOf("--output-dir") + 1], "transcript.txt"), "Ewa Przykładowa inwestuje.\n");
      return {};
    }, calls);
    const text = await transcribe("/data/a.m4a", { run, status: { available: true, tool: "mlx_whisper", model: "mlx-community/whisper-large-v3-turbo", reason: null } });
    expect(text).toBe("Ewa Przykładowa inwestuje.");
    expect(calls[0].cmd).toBe("mlx_whisper");
    expect(calls[0].args.slice(0, 7)).toEqual(["/data/a.m4a", "--model", "mlx-community/whisper-large-v3-turbo", "--language", "pl", "--output-format", "txt"]);
  });
});
