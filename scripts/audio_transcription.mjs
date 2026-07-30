import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import OpenAI from "openai";

const execFileAsync = promisify(execFile);
const defaultTimeoutMs = Number(process.env.KP_AUDIO_TRANSCRIBE_TIMEOUT_MS || process.env.RECORDING_TRANSCRIBE_TIMEOUT_MS || 120_000);

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout ${Math.round(timeoutMs / 1000)}s`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function prepareAudioForStt(filePath) {
  try {
    const processedDir = path.join(path.dirname(filePath), "processed");
    await fs.mkdir(processedDir, { recursive: true });
    const outputPath = path.join(processedDir, `${path.basename(filePath, path.extname(filePath))}-stt.wav`);
    await execFileAsync("ffmpeg", [
      "-y",
      "-i",
      filePath,
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-af",
      "highpass=f=120,lowpass=f=3800,afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11",
      outputPath,
    ], { timeout: 45_000, maxBuffer: 2 * 1024 * 1024 });
    return outputPath;
  } catch {
    return filePath;
  }
}

function cleanTranscript(text = "") {
  return String(text || "")
    .replace(/\s+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function transcribeAudioFile(filePath, context = "", options = {}) {
  if (!process.env.OPENAI_API_KEY) {
    return { transcript: "", error: "OPENAI_API_KEY yo'q, audio transcript qilib bo'lmaydi", model: "" };
  }
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const sttFilePath = await prepareAudioForStt(filePath);
  const model = options.model || process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
  const prompt = [
    "Uzbek/Russian sales discovery call for software project proposal.",
    "Output readable Uzbek Latin transcript.",
    "Do not summarize. Mark unclear fragments as [noaniq].",
    "Preserve requirements, budget, timeline, integrations, pains, and client constraints.",
    context ? `Weak context: ${context.slice(0, 800)}` : "",
  ].filter(Boolean).join(" ");

  try {
    const result = await withTimeout(
      client.audio.transcriptions.create({
        file: createReadStream(sttFilePath),
        model,
        prompt,
      }),
      options.timeoutMs || defaultTimeoutMs,
      `STT ${model}`,
    );
    return { transcript: cleanTranscript(result.text || ""), error: "", model };
  } catch (error) {
    return { transcript: "", error: error.message, model };
  }
}
