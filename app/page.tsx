"use client";

import { useRef, useState } from "react";
import { buildSpeakableScript } from "@/lib/speechScript";

type AlexResult = any; // for MVP; you can strongly type this later

export default function Page() {
  const [status, setStatus] = useState<string>("idle");
  const [transcript, setTranscript] = useState<string>("");
  const [question, setQuestion] = useState<string>("");
  const [result, setResult] = useState<AlexResult | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ttsAbortRef = useRef<AbortController | null>(null);

  async function startRecording() {
    setStatus("requesting_mic");
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mr = new MediaRecorder(stream);
    chunksRef.current = [];

    mr.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunksRef.current, { type: mr.mimeType || "audio/webm" });
      await transcribe(blob);
    };

    mediaRecorderRef.current = mr;
    mr.start();
    setStatus("recording");
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setStatus("transcribing");
  }

  async function transcribe(blob: Blob) {
    setStatus("transcribing");

    const fd = new FormData();
    fd.append("audio", blob, "audio.webm");

    const res = await fetch("/api/transcribe", { method: "POST", body: fd });
    const data = await res.json();

    const text = (data.text || "").trim();
    setTranscript(text);
    setQuestion(text);
    setStatus("ready");
  }

  async function askAlex(q: string) {
    setStatus("asking");
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: q }),
    });

    const json = await res.json();
    setResult(json);
    setStatus("answered");
    return json;
  }

  async function speakResult(r: any) {
    // barge-in: stop existing audio + abort in-flight tts request
    bargeIn();

    const script = buildSpeakableScript(r);
    setStatus("tts");

    const ac = new AbortController();
    ttsAbortRef.current = ac;

    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: script }),
      signal: ac.signal,
    });

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    const audio = audioRef.current!;
    audio.src = url;
    await audio.play();

    setStatus("playing");
    audio.onended = () => setStatus("answered");
  }

  function bargeIn() {
    // stop audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.src = "";
    }
    // abort fetch
    if (ttsAbortRef.current) {
      ttsAbortRef.current.abort();
      ttsAbortRef.current = null;
    }
  }

  return (
    <div style={{ maxWidth: 900, margin: "24px auto", fontFamily: "system-ui" }}>
      <h1>ALEX – Mobile Web MVP</h1>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {status !== "recording" ? (
          <button onClick={startRecording}>🎙️ Start recording</button>
        ) : (
          <button onClick={stopRecording}>⏹️ Stop recording</button>
        )}

        <button
          onClick={() => {
            if (!question.trim()) return;
            askAlex(question);
          }}
        >
          Ask ALEX
        </button>

        <button
          onClick={() => {
            if (result) speakResult(result);
          }}
          disabled={!result}
        >
          🔊 Speak response
        </button>

        <button onClick={bargeIn}>🛑 Barge-in (stop audio)</button>
      </div>

      <div style={{ marginBottom: 12, color: "#555" }}>Status: {status}</div>

      <div style={{ display: "grid", gap: 12 }}>
        <div>
          <label>Question (typed or from STT)</label>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={3}
            style={{ width: "100%" }}
          />
          {transcript && (
            <div style={{ marginTop: 6, color: "#555" }}>
              <strong>Transcript:</strong> {transcript}
            </div>
          )}
        </div>

        <div>
          <label>Response (JSON)</label>
          <pre style={{ background: "#f6f6f6", padding: 12, borderRadius: 8, overflow: "auto" }}>
            {result ? JSON.stringify(result, null, 2) : "(none yet)"}
          </pre>
        </div>

        <audio ref={audioRef} controls style={{ width: "100%" }} />
      </div>
    </div>
  );
}
