/**
 * bun scripts/media-smoke.ts — live smoke test of the optional media adapters on
 * synthetic input generated here (no network, temp files only in os.tmpdir()):
 *  - OCR: Polish text rendered into a PNG
 *  - ASR: Polish speech synthesised with macOS `say -v Zosia`, converted to 16 kHz WAV
 *  - Chromaprint: that speech vs a quieter MP3 re-encode vs an unrelated synthetic melody
 * Always exits 0; missing tools are reported and skipped.
 */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { detectAsr, extractAudioWav, transcribe } from "../lib/media/asr";
import { detectFpcalc, fingerprintAudio, fingerprintSimilarity } from "../lib/media/audioFp";
import { detectOcr, ocrImage } from "../lib/media/ocr";
import { defaultRunner, which } from "../lib/media/tools";

const OCR_TEXT = "Zażółć gęślą jaźń. Zarabiaj 4800 zł dziennie!";
const SPEECH_TEXT = "Adam Testowy poleca platformę Krypto Zysk. Zarejestruj się dziś i zarabiaj nawet cztery tysiące złotych dziennie.";

function ms(start: number): string {
  return `${Date.now() - start} ms`;
}

async function writeMelodyWav(file: string, notes: number[]): Promise<void> {
  const rate = 16000;
  const perNote = Math.round(rate * 0.35);
  const pcm = Buffer.alloc(perNote * notes.length * 2);
  notes.forEach((f, n) => {
    for (let i = 0; i < perNote; i++) {
      const t = i / rate;
      const env = Math.min(1, i / 160, (perNote - i) / 160);
      const v = (0.6 * Math.sin(2 * Math.PI * f * t) + 0.25 * Math.sin(4 * Math.PI * f * t)) * env * 0.7;
      pcm.writeInt16LE(Math.round(v * 32767), (n * perNote + i) * 2);
    }
  });
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "ascii");
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVE", 8, "ascii");
  h.write("fmt ", 12, "ascii");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "ascii");
  h.writeUInt32LE(pcm.length, 40);
  await fs.writeFile(file, Buffer.concat([h, pcm]));
}

async function main(): Promise<void> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "starter-media-smoke-"));
  try {
    const [ocr, asr, fp] = await Promise.all([detectOcr(), detectAsr(), detectFpcalc()]);
    const ffmpegOk = (await defaultRunner("ffmpeg", ["-version"], { timeoutMs: 10_000 })).code === 0;
    const sayBin = await which("say");
    const zosia = sayBin ? /\bZosia\b/.test((await defaultRunner("say", ["-v", "?"], { timeoutMs: 10_000 })).stdout) : false;

    console.log("== Dostępność ==");
    console.log(`tesseract: ${ocr.available ? `tak (${ocr.version}, pol)` : `nie — ${ocr.reason}`}`);
    console.log(`ASR:       ${asr.available ? `tak (${asr.tool}, model ${asr.model})` : `nie — ${asr.reason}`}`);
    console.log(`fpcalc:    ${fp.available ? `tak (${fp.version})` : "nie"}`);
    console.log(`ffmpeg:    ${ffmpegOk ? "tak" : "nie"}`);
    console.log(`say Zosia: ${zosia ? "tak" : "nie"}`);

    console.log("\n== OCR ==");
    if (ocr.available) {
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="220"><rect width="1500" height="220" fill="#fff"/><text x="30" y="140" font-family="Arial, Helvetica, sans-serif" font-size="76" fill="#111">${OCR_TEXT}</text></svg>`;
      const png = path.join(tmp, "kreacja.png");
      await sharp(Buffer.from(svg)).png().toFile(png);
      const t = Date.now();
      const text = await ocrImage(png);
      console.log(`wejście:  ${OCR_TEXT}`);
      console.log(`wynik:    ${text ?? "(brak)"}  [${ms(t)}]`);
    } else console.log("pominięto");

    console.log("\n== ASR ==");
    let speechWav: string | null = null;
    if (sayBin && zosia && ffmpegOk) {
      const aiff = path.join(tmp, "lektor.aiff");
      const r = await defaultRunner("say", ["-v", "Zosia", "-o", aiff, SPEECH_TEXT], { timeoutMs: 60_000 });
      if (r.code === 0) {
        speechWav = path.join(tmp, "lektor.wav");
        if (!(await extractAudioWav(aiff, speechWav))) speechWav = null;
      }
    }
    if (asr.available && speechWav) {
      const t = Date.now();
      const text = await transcribe(speechWav, { status: asr });
      console.log(`wejście:  ${SPEECH_TEXT}`);
      console.log(`wynik:    ${text ?? "(brak)"}  [${ms(t)}, z ładowaniem modelu]`);
    } else console.log(`pominięto (${!asr.available ? "brak ASR" : "brak say -v Zosia lub ffmpeg"})`);

    console.log("\n== Chromaprint ==");
    if (fp.available && speechWav && ffmpegOk) {
      let copy = path.join(tmp, "lektor-cicho.mp3");
      let r = await defaultRunner("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", speechWav, "-af", "volume=0.6", "-c:a", "libmp3lame", "-b:a", "64k", copy], { timeoutMs: 60_000 });
      if (r.code !== 0) {
        copy = path.join(tmp, "lektor-cicho.m4a");
        r = await defaultRunner("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", speechWav, "-af", "volume=0.6", "-c:a", "aac", "-b:a", "64k", copy], { timeoutMs: 60_000 });
      }
      const unrelated = path.join(tmp, "melodia.wav");
      await writeMelodyWav(unrelated, [262, 330, 392, 523, 494, 440, 392, 349, 330, 294, 262, 392, 440, 523, 587, 659, 523, 440, 392, 330]);
      const t = Date.now();
      const [a, b, c] = await Promise.all([fingerprintAudio(speechWav), r.code === 0 ? fingerprintAudio(copy) : Promise.resolve(null), fingerprintAudio(unrelated)]);
      if (a && b && c) {
        console.log(`ten sam lektor, ciszej i ponownie zakodowany (${path.extname(copy)}): podobieństwo ${fingerprintSimilarity(a.fingerprint, b.fingerprint).toFixed(3)}`);
        console.log(`lektor vs niezwiązana melodia:                          podobieństwo ${fingerprintSimilarity(a.fingerprint, c.fingerprint).toFixed(3)}  [${ms(t)}]`);
      } else console.log("nie udało się policzyć odcisków");
    } else console.log("pominięto");
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

main()
  .catch((e: unknown) => console.error(`BŁĄD (ignorowany): ${e instanceof Error ? e.message : String(e)}`))
  .finally(() => process.exit(0));
