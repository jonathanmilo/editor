// Sonidos de máquina de escribir sintetizados con Web Audio (sin archivos externos).
window.TypeSound = (() => {
  let ctx, noise;

  function init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const len = ctx.sampleRate * 0.6;
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  function burst({ freq, q = 1, dur, gain, type = 'bandpass', at = 0 }) {
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t, Math.random() * 0.4);
    src.stop(t + dur + 0.02);
  }

  function thump(freq, dur, gain, at = 0) {
    const t = ctx.currentTime + at;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.5, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }

  function key(kind = 'key') {
    init();
    if (ctx.state === 'suspended') ctx.resume();
    const v = 0.85 + Math.random() * 0.3;
    if (kind === 'space') {
      burst({ freq: 900, q: 0.8, dur: 0.05, gain: 0.18 * v });
      thump(110, 0.06, 0.12 * v);
    } else if (kind === 'back') {
      burst({ freq: 1600, q: 1.2, dur: 0.035, gain: 0.16 * v });
    } else {
      burst({ freq: 2200 + Math.random() * 1400, q: 1.6, dur: 0.035, gain: 0.32 * v });
      burst({ freq: 5200, q: 2, dur: 0.012, gain: 0.12 * v, type: 'highpass' });
      thump(150 + Math.random() * 40, 0.05, 0.16 * v);
    }
  }

  function carriageReturn() {
    init();
    if (ctx.state === 'suspended') ctx.resume();
    // deslizamiento del carro
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(700, t);
    f.frequency.linearRampToValueAtTime(1500, t + 0.22);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.04);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t); src.stop(t + 0.3);
    // golpe al final
    burst({ freq: 1800, q: 1.4, dur: 0.05, gain: 0.3, at: 0.24 });
    thump(120, 0.08, 0.2, 0.24);
  }

  function bell() {
    init();
    const t = ctx.currentTime;
    [2637, 3951].forEach((fr, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = fr;
      g.gain.setValueAtTime(i ? 0.03 : 0.07, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      o.connect(g).connect(ctx.destination);
      o.start(t); o.stop(t + 1);
    });
  }

  return { key, carriageReturn, bell };
})();
