import type http from 'http';
import { GoogleGenAI, Modality, type LiveServerMessage } from '@google/genai';
import { WebSocketServer, type WebSocket } from 'ws';
import { clampStr, verifyFirebaseIdToken } from './serverSecurity.ts';

const LIVE_VOICE_MODEL = 'gemini-3.8-live';
const ALLOWED_VOICES = new Set(['Zephyr', 'Kore', 'Puck', 'Charon', 'Fenrir']);
const MAX_SESSION_MS = 10 * 60_000; // 10 minutes max per live coaching session
const MAX_CONCURRENT_SESSIONS = 16;

const LANGUAGE_NAMES: Record<string, string> = {
  fr: 'French',
  en: 'English',
  es: 'Spanish',
  de: 'German',
  pt: 'Portuguese',
  ar: 'Arabic',
};

interface StartControlPayload {
  type: 'start';
  mode?: 'interview' | 'career_coach';
  role?: string;
  company?: string;
  details?: string;
  candidateSummary?: string;
  lang?: string;
  voiceName?: string;
  token?: string;
}

function buildSystemInstruction(payload: StartControlPayload): string {
  const outputLang = LANGUAGE_NAMES[payload.lang || 'fr'] || 'French';
  const role = clampStr(payload.role, 120) || 'Senior Candidate';
  const company = clampStr(payload.company, 120) || 'Target Company';
  const details = clampStr(payload.details, 600);
  const candidateSummary = clampStr(payload.candidateSummary, 900);

  if (payload.mode === 'career_coach') {
    return `You are the JOBFOUNDS Live Voice Career & Negotiation Coach.
Respond exclusively in spoken ${outputLang} with a natural, encouraging, executive coaching tone.
Keep turns concise (2 to 4 spoken sentences) so the conversation flows naturally in real time.
Focus on: career positioning, international relocation strategy, salary negotiation, and interview readiness for "${role}" (target company: "${company}").
Candidate background: ${candidateSummary || 'Not specified'}.
Extra context: ${details || 'None'}.
Never invent fake job offers or unverified credentials. Start with a brief warm welcome and ask what the candidate wants to practice first.`;
  }

  return `You are a senior hiring manager conducting a realistic live voice job interview on JOBFOUNDS for the role "${role}" at "${company}".
Speak exclusively in ${outputLang} with a professional, human, conversational pace.
Ask ONE clear interview question at a time (behavioral STAR, role-specific, or situational), listen to the candidate's spoken answer, give 1-2 sentences of constructive verbal feedback, then ask the next tailored follow-up question.
Ground your questions in the candidate's real background: ${candidateSummary || 'General candidate profile'}.
Role context: ${details || 'Standard role expectations'}.
Begin by greeting the candidate briefly and asking the first interview question.`;
}

function safeSend(ws: WebSocket, data: Record<string, unknown>) {
  if (ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify(data));
    } catch {
      // ignore broken pipe on disconnect
    }
  }
}

export function attachLiveVoiceBridge(
  httpServer: http.Server,
  getAiClient: () => GoogleGenAI
): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });
  let activeSessions = 0;

  httpServer.on('upgrade', (request, socket, head) => {
    const rawUrl = request.url || '/';
    let pathname = '/';
    try {
      pathname = new URL(rawUrl, 'http://localhost').pathname;
    } catch {
      return;
    }

    if (pathname !== '/api/live/interview') {
      return;
    }

    if (activeSessions >= MAX_CONCURRENT_SESSIONS) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  });

  wss.on('connection', (clientWs: WebSocket) => {
    activeSessions += 1;
    let liveSession: Awaited<ReturnType<GoogleGenAI['live']['connect']>> | null = null;
    let sessionReady = false;
    let closed = false;

    const cleanup = () => {
      if (closed) return;
      closed = true;
      sessionReady = false;
      activeSessions = Math.max(0, activeSessions - 1);
      clearTimeout(maxTimer);
      if (liveSession) {
        try {
          liveSession.close();
        } catch {
          // ignore close errors
        }
        liveSession = null;
      }
    };

    const maxTimer = setTimeout(() => {
      safeSend(clientWs, {
        error: 'Live coaching session reached the 10-minute safety duration limit.',
      });
      try {
        clientWs.close(1000, 'Session timeout');
      } catch {
        // ignore
      }
      cleanup();
    }, MAX_SESSION_MS);
    maxTimer.unref?.();

    clientWs.on('close', cleanup);
    clientWs.on('error', cleanup);

    clientWs.on('message', async (raw) => {
      if (closed) return;
      let msg: any;
      try {
        msg = JSON.parse(raw.toString('utf-8'));
      } catch {
        safeSend(clientWs, { error: 'Invalid JSON control frame.' });
        return;
      }

      if (msg?.type === 'start') {
        if (liveSession) {
          return;
        }
        try {
          const payload = msg as StartControlPayload;
          if (payload.token) {
            // Optional verification for authenticated sessions; does not block preview testing
            await verifyFirebaseIdToken(String(payload.token)).catch(() => null);
          }

          const voiceName = ALLOWED_VOICES.has(String(payload.voiceName))
            ? String(payload.voiceName)
            : 'Zephyr';

          const ai = getAiClient();
          const session = await ai.live.connect({
            model: LIVE_VOICE_MODEL,
            config: {
              responseModalities: [Modality.AUDIO],
              speechConfig: {
                voiceConfig: {
                  prebuiltVoiceConfig: { voiceName },
                },
              },
              inputAudioTranscription: {},
              outputAudioTranscription: {},
              systemInstruction: buildSystemInstruction(payload),
            },
            callbacks: {
              onopen: () => {
                sessionReady = true;
                safeSend(clientWs, { ready: true, voiceName });
              },
              onmessage: (message: LiveServerMessage) => {
                if (closed) return;
                const content = message.serverContent;
                if (content?.inputTranscription?.text) {
                  safeSend(clientWs, {
                    inputTranscript: content.inputTranscription.text,
                  });
                }
                if (content?.outputTranscription?.text) {
                  safeSend(clientWs, {
                    outputTranscript: content.outputTranscription.text,
                  });
                }
                for (const part of content?.modelTurn?.parts ?? []) {
                  if (part.inlineData?.data) {
                    safeSend(clientWs, { audio: part.inlineData.data });
                  }
                }
                if (content?.interrupted) {
                  safeSend(clientWs, { interrupted: true });
                }
                if (content?.turnComplete) {
                  safeSend(clientWs, { turnComplete: true });
                }
              },
              onerror: (err: unknown) => {
                const detail =
                  err instanceof Error ? err.message : 'Live voice model connection error.';
                safeSend(clientWs, { error: detail });
              },
              onclose: () => {
                if (!closed) {
                  safeSend(clientWs, { ended: true });
                  try {
                    clientWs.close(1000, 'Upstream closed');
                  } catch {
                    // ignore
                  }
                  cleanup();
                }
              },
            },
          });

          if (closed) {
            session.close();
            return;
          }

          liveSession = session;
          if (!sessionReady) {
            sessionReady = true;
            safeSend(clientWs, { ready: true, voiceName });
          }

          // Trigger the coach's opening spoken welcome automatically
          const outputLang = LANGUAGE_NAMES[payload.lang || 'fr'] || 'French';
          session.sendRealtimeInput({
            text: `Start the live voice session now in ${outputLang} with a brief greeting and your opening question.`,
          });
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : 'Failed to initialize Gemini Live voice session.';
          safeSend(clientWs, { error: message });
          try {
            clientWs.close(1011, 'Init error');
          } catch {
            // ignore
          }
          cleanup();
        }
        return;
      }

      if (msg?.type === 'stop') {
        try {
          clientWs.close(1000, 'Client ended session');
        } catch {
          // ignore
        }
        cleanup();
        return;
      }

      if (!liveSession || !sessionReady) {
        return;
      }

      if (typeof msg?.audio === 'string' && msg.audio.length > 0 && msg.audio.length < 256_000) {
        try {
          liveSession.sendRealtimeInput({
            audio: {
              data: msg.audio,
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        } catch {
          // ignore if session closed concurrently
        }
      } else if (typeof msg?.text === 'string' && msg.text.trim().length > 0) {
        try {
          liveSession.sendRealtimeInput({
            text: clampStr(msg.text, 600),
          });
        } catch {
          // ignore
        }
      }
    });
  });
}
