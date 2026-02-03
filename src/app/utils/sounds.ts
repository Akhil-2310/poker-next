// Sound effects for poker actions using Web Audio API

class SoundEffects {
  private audioContext: AudioContext | null = null
  private isMuted = false

  constructor() {
    // Initialize AudioContext on first user interaction
    if (typeof window !== 'undefined') {
      document.addEventListener('click', () => this.initAudioContext(), { once: true })
    }
  }

  private initAudioContext() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
    }
  }

  private play(frequency: number, duration: number, type: 'sine' | 'square' = 'sine') {
    if (!this.audioContext || this.isMuted) return

    const osc = this.audioContext.createOscillator()
    const gain = this.audioContext.createGain()

    osc.connect(gain)
    gain.connect(this.audioContext.destination)

    osc.type = type
    osc.frequency.value = frequency
    gain.gain.setValueAtTime(0.3, this.audioContext.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + duration)

    osc.start(this.audioContext.currentTime)
    osc.stop(this.audioContext.currentTime + duration)
  }

  playCall() {
    // Two ascending beeps - "call" sound
    this.play(400, 0.15, 'sine')
    setTimeout(() => this.play(520, 0.15, 'sine'), 100)
  }

  playBet() {
    // Rising pitch - "bet" sound
    if (!this.audioContext || this.isMuted) return
    const osc = this.audioContext.createOscillator()
    const gain = this.audioContext.createGain()

    osc.connect(gain)
    gain.connect(this.audioContext.destination)

    osc.type = 'square'
    osc.frequency.setValueAtTime(300, this.audioContext.currentTime)
    osc.frequency.exponentialRampToValueAtTime(800, this.audioContext.currentTime + 0.4)

    gain.gain.setValueAtTime(0.3, this.audioContext.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.4)

    osc.start(this.audioContext.currentTime)
    osc.stop(this.audioContext.currentTime + 0.4)
  }

  playFold() {
    // Descending pitch - "fold" sound
    if (!this.audioContext || this.isMuted) return
    const osc = this.audioContext.createOscillator()
    const gain = this.audioContext.createGain()

    osc.connect(gain)
    gain.connect(this.audioContext.destination)

    osc.type = 'sine'
    osc.frequency.setValueAtTime(600, this.audioContext.currentTime)
    osc.frequency.exponentialRampToValueAtTime(200, this.audioContext.currentTime + 0.3)

    gain.gain.setValueAtTime(0.3, this.audioContext.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.3)

    osc.start(this.audioContext.currentTime)
    osc.stop(this.audioContext.currentTime + 0.3)
  }

  playCheck() {
    // Soft single beep - "check" sound
    this.play(440, 0.2, 'sine')
  }

  playWin() {
    // Victory fanfare
    if (!this.audioContext || this.isMuted) return
    const notes = [523.25, 659.25, 783.99] // C, E, G
    notes.forEach((freq, i) => {
      setTimeout(() => this.play(freq, 0.3, 'sine'), i * 150)
    })
  }

  toggleMute() {
    this.isMuted = !this.isMuted
    return this.isMuted
  }

  getMuteState() {
    return this.isMuted
  }
}

export const soundEffects = new SoundEffects()
