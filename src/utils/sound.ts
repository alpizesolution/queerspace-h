// Web Audio API sound synthesizer for gentle chat notifications

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export const soundEffects = {
  playMessageReceived: () => {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12); // A5

      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } catch {
      // Audio playback errors silently ignored
    }
  },

  playMessageSent: () => {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } catch {
      // Audio playback errors silently ignored
    }
  },

  /** A bright two-part chime: a rising arpeggio, then a soft sparkle on top. */
  playMatchFound: () => {
    try {
      const ctx = getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;
      const master = ctx.createGain();
      master.gain.value = 0.9;
      master.connect(ctx.destination);

      const tone = (freq: number, at: number, length: number, volume: number, type: OscillatorType = 'sine') => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, now + at);
        gain.gain.setValueAtTime(0.0001, now + at);
        gain.gain.exponentialRampToValueAtTime(volume, now + at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + at + length);
        osc.connect(gain);
        gain.connect(master);
        osc.start(now + at);
        osc.stop(now + at + length + 0.05);
      };

      // C major arpeggio up to the octave, each note with a quiet fifth for warmth.
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, i) => {
        tone(freq, i * 0.09, 0.55, 0.07);
        tone(freq * 1.5, i * 0.09, 0.4, 0.015, 'triangle');
      });
      // Sparkle: two high bell notes after the arpeggio lands.
      tone(1567.98, 0.42, 0.7, 0.03);
      tone(2093.0, 0.52, 0.8, 0.022);
    } catch {
      // Audio playback errors silently ignored
    }
  },
};

/**
 * Phones only allow sound after a tap. Resume the audio context on the first tap, so a match
 * found later while the user waits can still play its chime.
 */
export function unlockAudioOnFirstTap(): void {
  if (typeof window === 'undefined') return;
  const unlock = () => {
    getAudioContext();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { passive: true });
  window.addEventListener('keydown', unlock);
}
