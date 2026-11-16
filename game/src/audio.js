// Procedural sound: every effect is synthesised with WebAudio, so the game ships no
// audio files and makes no network request. The context is created on the first user
// gesture (pointer lock), which is also the only time a browser allows sound to start.
export function createAudio() {
  let context = null;
  let master = null;
  let noiseBuffer = null;

  function ensure() {
    if (context) return true;
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) return false;
      context = new AudioContextClass();
      master = context.createGain();
      master.gain.value = 0.32;
      master.connect(context.destination);
      const length = context.sampleRate;
      noiseBuffer = context.createBuffer(1, length, context.sampleRate);
      const data = noiseBuffer.getChannelData(0);
      for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      context = null;
      return false;
    }
    return true;
  }

  function resume() {
    if (ensure() && context.state === 'suspended') context.resume().catch(() => {});
  }

  // A short burst of filtered noise: the body of every gunshot and explosion.
  function noiseBurst(duration, filterType, frequency, gainValue, when = 0) {
    if (!ensure()) return;
    const t = context.currentTime + when;
    const source = context.createBufferSource();
    source.buffer = noiseBuffer;
    const filter = context.createBiquadFilter();
    filter.type = filterType;
    filter.frequency.value = frequency;
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t);
    source.stop(t + duration + 0.02);
  }

  // A pitched blip: clicks, beeps and the kill chime.
  function tone(frequency, duration, type, gainValue, slideTo = 0, when = 0) {
    if (!ensure()) return;
    const t = context.currentTime + when;
    const oscillator = context.createOscillator();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, t);
    if (slideTo > 0) oscillator.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(t);
    oscillator.stop(t + duration + 0.02);
  }

  return {
    resume,
    shot() {
      noiseBurst(0.11, 'lowpass', 2400, 0.9);
      tone(190, 0.08, 'square', 0.22, 70);
    },
    enemyShot(distance) {
      const volume = Math.max(0.08, 0.55 - distance * 0.012);
      noiseBurst(0.14, 'lowpass', 1100, volume);
      tone(140, 0.1, 'square', volume * 0.4, 60);
    },
    dryFire() {
      tone(1100, 0.03, 'square', 0.12);
    },
    reloadStart() {
      tone(520, 0.05, 'square', 0.14);
      tone(340, 0.05, 'square', 0.14, 0, 0.12);
    },
    reloadEnd() {
      tone(700, 0.05, 'square', 0.16);
      tone(940, 0.06, 'square', 0.16, 0, 0.09);
    },
    hit() {
      tone(1250, 0.05, 'sine', 0.3);
    },
    kill() {
      tone(880, 0.07, 'sine', 0.3);
      tone(1320, 0.12, 'sine', 0.3, 0, 0.07);
    },
    hurt() {
      noiseBurst(0.16, 'lowpass', 500, 0.5);
      tone(110, 0.18, 'sawtooth', 0.2, 55);
    },
    plantBeep(final) {
      tone(final ? 1500 : 980, final ? 0.3 : 0.08, 'square', 0.2);
    },
    defuseBeep() {
      tone(760, 0.08, 'square', 0.18);
    },
    explosion() {
      noiseBurst(0.9, 'lowpass', 320, 1.0);
      tone(72, 0.7, 'sine', 0.6, 34);
      noiseBurst(0.35, 'highpass', 3000, 0.25, 0.02);
    },
    grenadePin() {
      tone(1500, 0.03, 'square', 0.12);
    },
    bounce() {
      tone(220, 0.06, 'triangle', 0.2, 140);
    },
    flash() {
      noiseBurst(0.3, 'highpass', 5000, 0.35);
      tone(2400, 0.25, 'sine', 0.12, 1800);
    },
    buy() {
      tone(660, 0.05, 'sine', 0.22);
      tone(990, 0.08, 'sine', 0.22, 0, 0.06);
    },
    denied() {
      tone(220, 0.12, 'square', 0.18, 160);
    },
    roundWin() {
      tone(523, 0.12, 'triangle', 0.3);
      tone(659, 0.12, 'triangle', 0.3, 0, 0.12);
      tone(784, 0.24, 'triangle', 0.32, 0, 0.24);
    },
    roundLose() {
      tone(392, 0.14, 'triangle', 0.3);
      tone(330, 0.14, 'triangle', 0.3, 0, 0.14);
      tone(262, 0.3, 'triangle', 0.32, 0, 0.28);
    },
    step() {
      noiseBurst(0.05, 'lowpass', 700, 0.1);
    },
  };
}
