// Synthesised engine / impact / start-beep audio (WebAudio, no files).
const lerp = (a, b, t) => a + (b - a) * t, rand = (a, b) => a + Math.random() * (b - a);
export const audio = {
  ctx: null, master: null, noiseBuf: null, muted: false, engines: [],
  start() {
    if (this.ctx) { try { this.ctx.resume(); } catch (e) {} return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    let c; try { c = new AC(); } catch (e) { return; }
    this.ctx = c;
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.45; this.master.connect(c.destination);
    this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const nd = this.noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    this.engines = [new Engine(c, this.master, this.noiseBuf, -0.5, 1.0), new Engine(c, this.master, this.noiseBuf, 0.5, 1.09)];
  },
  burst(freq, q, vol, dur, delay = 0, pan = 0) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = c.createStereoPanner ? c.createStereoPanner() : null; if (p) p.pan.value = pan;
    s.connect(f); f.connect(g); if (p) { g.connect(p); p.connect(this.master); } else g.connect(this.master);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  },
  pops(pan) { [0, 0.08, 0.19].forEach(d => this.burst(rand(160, 320), 2, 0.4, 0.09, d, pan)); },
  thump(pan, power = 1) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(34, t + 0.3);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.8 * power, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    const p = c.createStereoPanner ? c.createStereoPanner() : null; if (p) p.pan.value = pan;
    o.connect(g); if (p) { g.connect(p); p.connect(this.master); } else g.connect(this.master);
    o.start(t); o.stop(t + 0.4); this.burst(260, 0.7, 0.5 * power, 0.22, 0, pan);
  },
  beep(freq, dur) {
    if (!this.ctx) return; const c = this.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
    o.type = 'square'; o.frequency.value = freq; g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.25, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  },
  setMuted(m) { this.muted = m; if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.45, this.ctx.currentTime, 0.03); }
};
class Engine {
  constructor(c, master, noiseBuf, pan, pitch) {
    this.c = c; this.pitch = pitch;
    const out = c.createGain(); out.gain.value = 0.7;
    if (c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = pan; out.connect(p); p.connect(master); } else out.connect(master);
    const mk = (type) => { const o = c.createOscillator(); o.type = type; return o; };
    this.a = mk('sawtooth'); this.b = mk('square'); this.lfo = mk('sine');
    const gA = c.createGain(); gA.gain.value = 0.5; const gB = c.createGain(); gB.gain.value = 0.22;
    const shaper = c.createWaveShaper(), arr = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) arr[i] = Math.tanh(3.2 * (i / 512 - 1)); shaper.curve = arr;
    this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.Q.value = 1.4; this.lp.frequency.value = 500;
    const amp = c.createGain(); amp.gain.value = 0.55;
    this.depth = c.createGain(); this.depth.gain.value = 0.45; this.lfo.connect(this.depth); this.depth.connect(amp.gain);
    this.a.connect(gA); this.b.connect(gB); gA.connect(shaper); gB.connect(shaper); shaper.connect(this.lp); this.lp.connect(amp); amp.connect(out);
    const mkN = () => { const s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s; };
    const intake = mkN(); this.bp = c.createBiquadFilter(); this.bp.type = 'bandpass'; this.bp.Q.value = 0.8;
    this.gI = c.createGain(); this.gI.gain.value = 0.02; intake.connect(this.bp); this.bp.connect(this.gI); this.gI.connect(out);
    const wind = mkN(); this.wl = c.createBiquadFilter(); this.wl.type = 'lowpass'; this.wl.frequency.value = 700;
    this.gW = c.createGain(); this.gW.gain.value = 0; wind.connect(this.wl); this.wl.connect(this.gW); this.gW.connect(out);
    [this.a, this.b, this.lfo, intake, wind].forEach(n => n.start());
  }
  update(rev, speedA) {
    const t = this.c.currentTime, tc = 0.05, rpm = lerp(1800, 9800, rev) * this.pitch, tone = lerp(95, 340, rev) * this.pitch;
    this.a.frequency.setTargetAtTime(tone, t, tc); this.b.frequency.setTargetAtTime(tone * 0.5, t, tc);
    this.lfo.frequency.setTargetAtTime(rpm / 120, t, tc); this.depth.gain.setTargetAtTime(lerp(0.45, 0.14, rev), t, tc);
    this.lp.frequency.setTargetAtTime(lerp(420, 2600, rev), t, tc); this.gI.gain.setTargetAtTime(lerp(0.02, 0.12, rev), t, tc);
    this.bp.frequency.setTargetAtTime(lerp(700, 2800, rev), t, tc);
    this.gW.gain.setTargetAtTime(0.01 + 0.2 * speedA * speedA, t, 0.1); this.wl.frequency.setTargetAtTime(500 + 1800 * speedA, t, 0.1);
  }
}

