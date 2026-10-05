import { browser } from '$app/environment';

export type SoundName = 'click' | 'win' | 'lose' | 'draw';

const SOUND_SOURCES: Record<SoundName, string> = {
  click: '/sounds/click.wav',
  win: '/sounds/win.wav',
  lose: '/sounds/lose.wav',
  draw: '/sounds/draw.wav'
};

type AudioContextConstructor = new () => AudioContext;
type ExtendedWindow = Window & { webkitAudioContext?: AudioContextConstructor };

export class AudioService {
  private context: AudioContext | null = null;
  private buffers = new Map<SoundName, AudioBuffer>();
  private loading: Promise<void> | null = null;
  private unlocking: Promise<void> | null = null;
  private pendingSounds: SoundName[] = [];
  private unlocked = false;
  private muted = false;

  async unlock(): Promise<void> {
    if (!browser || this.unlocked) return;
    if (this.unlocking) return this.unlocking;

    this.unlocking = (async () => {
      try {
        if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
        const Context = window.AudioContext ?? (window as ExtendedWindow).webkitAudioContext;
        if (!Context) return;

        this.context ??= new Context();
        if (this.context.state !== 'running') {
          await this.context.resume();
        }
        if (this.context.state !== 'running') return;

        this.unlocked = true;
        await this.preload();
        this.flushPendingSounds();
      } catch (error) {
        this.unlocked = false;
        if (
          (error instanceof DOMException || error instanceof Error) &&
          error.name === 'NotAllowedError'
        )
          return;
        throw error;
      }
    })().finally(() => {
      this.unlocking = null;
    });

    return this.unlocking;
  }

  async preload(): Promise<void> {
    if (!browser || !this.context) return;
    if (this.loading) return this.loading;

    this.loading = Promise.all(
      (Object.entries(SOUND_SOURCES) as [SoundName, string][]).map(async ([name, url]) => {
        try {
          const response = await fetch(url);
          if (!response.ok) return;
          const data = await response.arrayBuffer();
          const buffer = await this.context?.decodeAudioData(data);
          if (buffer) this.buffers.set(name, buffer);
        } catch {
          // A missing sound should not prevent the other effects from loading.
        }
      })
    ).then(() => undefined);

    return this.loading;
  }

  play(name: SoundName): void {
    if (!browser || this.muted) return;
    if (!this.unlocked) {
      if (this.pendingSounds.length < 16) this.pendingSounds.push(name);
      return;
    }
    this.playLoaded(name);
  }

  private playLoaded(name: SoundName): void {
    if (!this.context || this.context.state !== 'running' || this.muted) return;
    const buffer = this.buffers.get(name);
    if (!buffer) return;

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    source.start(0);
  }

  private flushPendingSounds(): void {
    const pending = this.pendingSounds.splice(0);
    pending.forEach((name) => this.playLoaded(name));
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  isMuted(): boolean {
    return this.muted;
  }

  isUnlocked(): boolean {
    return this.unlocked;
  }
}

export const sounds = new AudioService();
