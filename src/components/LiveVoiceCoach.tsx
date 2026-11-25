import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Loader2,
  Mic,
  MicOff,
  PhoneCall,
  PhoneOff,
  Send,
  Volume2,
  AudioWaveform,
} from 'lucide-react';
import { auth } from '../firebase';
import { L } from '../i18n';
import { CandidateProfile, Lang } from '../types';

interface LiveVoiceCoachProps {
  lang: Lang;
  profile: CandidateProfile;
  role: string;
  company: string;
  details?: string;
}

interface TranscriptEntry {
  id: string;
  speaker: 'candidate' | 'coach';
  text: string;
}

type VoiceName = 'Zephyr' | 'Kore' | 'Puck' | 'Charon' | 'Fenrir';

const VOICES: Array<{ id: VoiceName; labelFr: string; labelEn: string }> = [
  { id: 'Zephyr', labelFr: 'Zephyr (Clair & posé)', labelEn: 'Zephyr (Clear & calm)' },
  { id: 'Kore', labelFr: 'Kore (Professionnel)', labelEn: 'Kore (Professional)' },
  { id: 'Puck', labelFr: 'Puck (Dynamique)', labelEn: 'Puck (Energetic)' },
  { id: 'Charon', labelFr: 'Charon (Direction)', labelEn: 'Charon (Executive)' },
  { id: 'Fenrir', labelFr: 'Fenrir (Direct)', labelEn: 'Fenrir (Direct)' },
];

function float32ToPcm16Base64(float32: Float32Array): string {
  const pcm16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i += 1) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64Pcm16ToFloat32(base64: string): Float32Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const view = new DataView(bytes.buffer);
  const count = Math.floor(bytes.byteLength / 2);
  const samples = new Float32Array(new ArrayBuffer(count * 4));
  for (let i = 0; i < count; i += 1) {
    samples[i] = view.getInt16(i * 2, true) / 0x8000;
  }
  return samples;
}

export function LiveVoiceCoach({
  lang,
  profile,
  role,
  company,
  details = '',
}: LiveVoiceCoachProps) {
  const [coachMode, setCoachMode] = useState<'interview' | 'career_coach'>('interview');
  const [voiceName, setVoiceName] = useState<VoiceName>('Zephyr');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'live'>('idle');
  const [muted, setMuted] = useState(false);
  const [micLevel, setMicLevel] = useState(0);
  const [coachSpeaking, setCoachSpeaking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [textFollowUp, setTextFollowUp] = useState('');

  // Refs used inside audio & WebSocket callbacks to prevent stale closures
  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const mutedRef = useRef(false);
  const activeRef = useRef(false);
  const nextStartTimeRef = useRef(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  mutedRef.current = muted;

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  const stopQueuedPlayback = useCallback(() => {
    for (const src of activeSourcesRef.current) {
      try {
        src.stop();
      } catch {
        // already stopped
      }
    }
    activeSourcesRef.current = [];
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    } else {
      nextStartTimeRef.current = 0;
    }
    setCoachSpeaking(false);
  }, []);

  const schedulePcm24kPlayback = useCallback((base64Audio: string) => {
    const ctx = outputCtxRef.current;
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      void ctx.resume();
    }

    const floatSamples = base64Pcm16ToFloat32(base64Audio);
    if (floatSamples.length === 0) return;

    const audioBuffer = ctx.createBuffer(1, floatSamples.length, 24000);
    audioBuffer.copyToChannel(floatSamples, 0);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.02, nextStartTimeRef.current);
    source.start(startAt);
    nextStartTimeRef.current = startAt + audioBuffer.duration;
    setCoachSpeaking(true);

    activeSourcesRef.current.push(source);
    source.onended = () => {
      activeSourcesRef.current = activeSourcesRef.current.filter((s) => s !== source);
      if (activeSourcesRef.current.length === 0) {
        setCoachSpeaking(false);
      }
    };
  }, []);

  const appendTranscript = useCallback((speaker: 'candidate' | 'coach', chunk: string) => {
    const clean = chunk.trim();
    if (!clean) return;
    setTranscript((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.speaker === speaker) {
        const separator = last.text.endsWith(' ') || clean.startsWith(' ') ? '' : ' ';
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...last,
          text: `${last.text}${separator}${clean}`,
        };
        return updated;
      }
      return [
        ...prev,
        { id: `${speaker}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, speaker, text: clean },
      ];
    });
  }, []);

  const teardownSession = useCallback(() => {
    activeRef.current = false;
    stopQueuedPlayback();

    if (processorRef.current) {
      try {
        processorRef.current.disconnect();
      } catch {
        // ignore
      }
      processorRef.current.onaudioprocess = null;
      processorRef.current = null;
    }

    if (mediaStreamRef.current) {
      for (const track of mediaStreamRef.current.getTracks()) {
        track.stop();
      }
      mediaStreamRef.current = null;
    }

    if (inputCtxRef.current) {
      void inputCtxRef.current.close().catch(() => {});
      inputCtxRef.current = null;
    }

    if (outputCtxRef.current) {
      void outputCtxRef.current.close().catch(() => {});
      outputCtxRef.current = null;
    }

    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'stop' }));
        }
        ws.close();
      } catch {
        // ignore
      }
    }

    setMicLevel(0);
    setCoachSpeaking(false);
    setStatus('idle');
  }, [stopQueuedPlayback]);

  useEffect(() => {
    return () => {
      teardownSession();
    };
  }, [teardownSession]);

  const handleStartVoiceSession = async () => {
    setError(null);
    setTranscript([]);
    setStatus('connecting');

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          L(
            lang,
            'Votre navigateur ne supporte pas la capture microphone requise pour le coaching vocal en direct.',
            'Your browser does not support microphone capture required for live voice coaching.'
          )
        );
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;
      nextStartTimeRef.current = outputCtx.currentTime;

      const idToken = auth.currentUser ? await auth.currentUser.getIdToken().catch(() => '') : '';
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/api/live/interview`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      const candidateSummary = [
        profile.fullName,
        profile.currentTitle,
        `${profile.yearsExperience} yrs`,
        profile.skills.slice(0, 8).join(', '),
        profile.languages.join(', '),
      ]
        .filter(Boolean)
        .join(' · ');

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'start',
            mode: coachMode,
            role: role || profile.currentTitle,
            company: company || 'Entreprise cible',
            details,
            candidateSummary,
            lang,
            voiceName,
            token: idToken || undefined,
          })
        );
      };

      ws.onmessage = (event) => {
        let msg: any;
        try {
          msg = JSON.parse(String(event.data));
        } catch {
          return;
        }

        if (msg.ready) {
          activeRef.current = true;
          setStatus('live');

          // Start 16kHz PCM mic capture stream
          const source = inputCtx.createMediaStreamSource(stream);
          const processor = inputCtx.createScriptProcessor(4096, 1, 1);
          processorRef.current = processor;

          // Route through silent gain to prevent local mic echo
          const silentGain = inputCtx.createGain();
          silentGain.gain.value = 0;

          source.connect(processor);
          processor.connect(silentGain);
          silentGain.connect(inputCtx.destination);

          processor.onaudioprocess = (ev) => {
            if (!activeRef.current || mutedRef.current) {
              setMicLevel(0);
              return;
            }
            const socket = wsRef.current;
            if (!socket || socket.readyState !== WebSocket.OPEN) return;

            const channel = ev.inputBuffer.getChannelData(0);
            let sumSq = 0;
            for (let i = 0; i < channel.length; i += 1) {
              sumSq += channel[i] * channel[i];
            }
            const rms = Math.sqrt(sumSq / channel.length);
            setMicLevel(Math.min(100, Math.round(rms * 320)));

            const base64 = float32ToPcm16Base64(channel);
            socket.send(JSON.stringify({ audio: base64 }));
          };
          return;
        }

        if (msg.audio) {
          schedulePcm24kPlayback(msg.audio);
        }
        if (msg.interrupted) {
          stopQueuedPlayback();
        }
        if (msg.inputTranscript) {
          appendTranscript('candidate', msg.inputTranscript);
        }
        if (msg.outputTranscript) {
          appendTranscript('coach', msg.outputTranscript);
        }
        if (msg.error) {
          setError(String(msg.error));
          teardownSession();
        }
        if (msg.ended) {
          teardownSession();
        }
      };

      ws.onerror = () => {
        setError(
          L(
            lang,
            'La connexion audio en temps réel a été interrompue. Vérifiez votre connexion et réessayez.',
            'Real-time voice connection failed. Check your network and try again.'
          )
        );
        teardownSession();
      };

      ws.onclose = () => {
        if (activeRef.current) {
          teardownSession();
        }
      };
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : L(
              lang,
              'Impossible de démarrer la session vocale en direct.',
              'Unable to start live voice session.'
            );
      setError(msg);
      teardownSession();
    }
  };

  const handleSendTextNudge = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = textFollowUp.trim();
    if (!trimmed || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(JSON.stringify({ text: trimmed }));
    appendTranscript('candidate', trimmed);
    setTextFollowUp('');
  };

  return (
    <section className="bg-white border border-jf-border rounded-xl p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4 pb-4 border-b border-jf-border">
        <div className="space-y-1">
          <h3 className="font-display text-lg font-semibold text-jf-navy flex items-center gap-2">
            <Volume2 className="w-5 h-5 text-jf-blue" />
            <span>
              {L(
                lang,
                'Coach Vocal d’Entretien & Carrière en Temps Réel',
                'Live Voice Interview & Career Coach'
              )}
            </span>
          </h3>
          <p className="text-xs text-slate-600 max-w-2xl">
            {L(
              lang,
              'Échangez à l’oral en direct avec votre recruteur ou coach carrière IA. Audio bidirectionnel naturel avec interruption en temps réel et transcription automatique.',
              'Speak directly in real time with your AI interviewer or career coach. Bidirectional voice streaming with natural barge-in and live transcription.'
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {status === 'idle' ? (
            <button
              type="button"
              onClick={handleStartVoiceSession}
              className="px-4 py-2.5 text-sm font-semibold text-white bg-jf-blue hover:bg-jf-blue-hover rounded-lg inline-flex items-center gap-2 transition-colors"
            >
              <PhoneCall className="w-4 h-4" />
              <span>{L(lang, 'Démarrer l’appel vocal', 'Start Voice Call')}</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={teardownSession}
              className="px-4 py-2.5 text-sm font-semibold text-white bg-jf-navy hover:bg-jf-dark rounded-lg inline-flex items-center gap-2 transition-colors"
            >
              <PhoneOff className="w-4 h-4" />
              <span>{L(lang, 'Terminer la session', 'End Session')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Controls Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-slate-600">
            {L(lang, 'Mode de conversation vocale', 'Voice Session Mode')}
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={status !== 'idle'}
              onClick={() => setCoachMode('interview')}
              className={`px-3 py-2 text-xs font-medium rounded-lg border text-left transition-colors disabled:opacity-60 ${
                coachMode === 'interview'
                  ? 'bg-jf-navy text-white border-jf-navy'
                  : 'bg-jf-ice text-jf-navy border-jf-border hover:bg-jf-soft'
              }`}
            >
              {L(lang, 'Entretien oral simulé', 'Simulated Oral Interview')}
            </button>
            <button
              type="button"
              disabled={status !== 'idle'}
              onClick={() => setCoachMode('career_coach')}
              className={`px-3 py-2 text-xs font-medium rounded-lg border text-left transition-colors disabled:opacity-60 ${
                coachMode === 'career_coach'
                  ? 'bg-jf-navy text-white border-jf-navy'
                  : 'bg-jf-ice text-jf-navy border-jf-border hover:bg-jf-soft'
              }`}
            >
              {L(lang, 'Coach carrière & salaire', 'Career & Salary Coach')}
            </button>
          </div>
        </div>

        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-slate-600">
            {L(lang, 'Voix du coach IA', 'AI Coach Voice')}
          </span>
          <select
            value={voiceName}
            disabled={status !== 'idle'}
            onChange={(e) => setVoiceName(e.target.value as VoiceName)}
            className="w-full px-3 py-2 text-sm bg-white border border-jf-border rounded-lg disabled:opacity-60"
          >
            {VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {lang === 'fr' ? v.labelFr : v.labelEn}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && (
        <div
          role="alert"
          className="p-3.5 bg-jf-soft/75 border border-jf-dark/30 rounded-lg text-xs font-medium text-jf-navy"
        >
          {error}
        </div>
      )}

      {/* Active Call Studio Bar */}
      {status !== 'idle' && (
        <div className="p-4 bg-jf-navy text-white rounded-xl flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-full bg-jf-dark border border-jf-sky/40 flex items-center justify-center shrink-0">
              {status === 'connecting' ? (
                <Loader2 className="w-5 h-5 text-jf-sky animate-spin" />
              ) : (
                <AudioWaveform className="w-5 h-5 text-jf-sky" />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold truncate">
                {status === 'connecting'
                  ? L(lang, 'Connexion audio sécurisée…', 'Connecting live voice studio…')
                  : coachSpeaking
                    ? L(lang, 'Le coach IA vous répond…', 'AI Coach is speaking…')
                    : muted
                      ? L(lang, 'Microphone coupé', 'Microphone muted')
                      : L(lang, 'À l’écoute — parlez naturellement', 'Listening — speak naturally')}
              </div>
              <div className="text-xs text-jf-sky/85 truncate">
                {company || 'JOBFOUNDS'} · {role || profile.currentTitle} · {voiceName}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Mic level bar */}
            <div className="w-24 h-2 bg-jf-dark rounded-full overflow-hidden" aria-hidden="true">
              <div
                className="h-full bg-jf-sky transition-all duration-100"
                style={{ width: `${muted ? 0 : Math.max(6, micLevel)}%` }}
              />
            </div>

            <button
              type="button"
              onClick={() => setMuted((prev) => !prev)}
              className={`px-3 py-2 text-xs font-medium rounded-lg inline-flex items-center gap-1.5 transition-colors ${
                muted
                  ? 'bg-jf-soft text-jf-navy'
                  : 'bg-jf-dark hover:bg-jf-blue text-white border border-jf-sky/30'
              }`}
            >
              {muted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              <span>
                {muted ? L(lang, 'Réactiver micro', 'Unmute') : L(lang, 'Couper micro', 'Mute')}
              </span>
            </button>
          </div>
        </div>
      )}

      {/* Live Transcript */}
      <div className="border border-jf-border rounded-xl bg-jf-ice/50 p-4 space-y-3 min-h-[180px] max-h-[340px] overflow-y-auto">
        <div className="text-xs font-semibold text-jf-navy">
          {L(lang, 'Transcription en direct', 'Live Transcript')}
        </div>
        {transcript.length === 0 ? (
          <p className="text-xs text-slate-500 leading-relaxed">
            {status === 'idle'
              ? L(
                  lang,
                  'Cliquez sur « Démarrer l’appel vocal » pour lancer votre entretien oral en direct. Autorisez l’accès au microphone lorsque votre navigateur le demande.',
                  'Click "Start Voice Call" to begin your real-time oral interview. Grant microphone access when prompted by your browser.'
                )
              : L(
                  lang,
                  'La transcription apparaîtra ici en temps réel dès les premiers mots.',
                  'Live speech transcription will appear here as soon as speaking starts.'
                )}
          </p>
        ) : (
          <div className="space-y-2.5">
            {transcript.map((entry) => (
              <div
                key={entry.id}
                className={`p-3 rounded-lg text-xs leading-relaxed border ${
                  entry.speaker === 'coach'
                    ? 'bg-white border-jf-border text-jf-navy'
                    : 'bg-jf-soft/65 border-jf-sky/60 text-jf-navy ml-6'
                }`}
              >
                <div className="font-semibold text-[11px] text-jf-blue mb-0.5">
                  {entry.speaker === 'coach'
                    ? `${company || 'JOBFOUNDS'} — ${L(lang, 'Coach Vocal IA', 'AI Voice Coach')}`
                    : profile.fullName}
                </div>
                <p className="whitespace-pre-line">{entry.text}</p>
              </div>
            ))}
            <div ref={transcriptEndRef} />
          </div>
        )}
      </div>

      {/* Optional text prompt while voice call is live */}
      {status === 'live' && (
        <form onSubmit={handleSendTextNudge} className="flex gap-2">
          <input
            type="text"
            value={textFollowUp}
            onChange={(e) => setTextFollowUp(e.target.value)}
            placeholder={L(
              lang,
              'Optionnel : envoyer une consigne écrite pendant l’appel (ex. « Passe à une question technique »)…',
              'Optional: send a written instruction during the call (e.g. "Ask a technical question next")…'
            )}
            className="flex-1 px-3 py-2 text-xs bg-white border border-jf-border rounded-lg"
          />
          <button
            type="submit"
            disabled={!textFollowUp.trim()}
            className="px-3.5 py-2 text-xs font-medium text-white bg-jf-blue hover:bg-jf-blue-hover disabled:opacity-50 rounded-lg inline-flex items-center gap-1.5"
          >
            <Send className="w-3.5 h-3.5" />
            <span>{L(lang, 'Envoyer', 'Send')}</span>
          </button>
        </form>
      )}
    </section>
  );
}
