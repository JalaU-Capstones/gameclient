import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AudioService, sounds } from './sounds';

class FakeAudioBufferSource {
  buffer: AudioBuffer | null = null;
  connect = vi.fn();
  start = vi.fn();
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];

  state: AudioContextState = 'suspended';
  destination = {} as AudioNode;
  sources: FakeAudioBufferSource[] = [];
  resume = vi.fn(async () => {
    this.state = 'running';
  });
  decodeAudioData = vi.fn(
    async (data: ArrayBuffer) => ({ byteLength: data.byteLength }) as unknown as AudioBuffer
  );
  createBufferSource = vi.fn(() => {
    const source = new FakeAudioBufferSource();
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  });

  constructor() {
    FakeAudioContext.instances.push(this);
  }
}

describe('AudioService', () => {
  let service: AudioService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    FakeAudioContext.instances = [];
    service = new AudioService();
    fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8)
    }));
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('creates a context, resumes it, and unlocks', async () => {
    await service.unlock();

    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(FakeAudioContext.instances[0].resume).toHaveBeenCalledOnce();
    expect(service.isUnlocked()).toBe(true);
  });

  it('makes unlock idempotent', async () => {
    await service.unlock();
    await service.unlock();

    expect(FakeAudioContext.instances).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('shares context creation for overlapping unlock calls', async () => {
    await Promise.all([service.unlock(), service.unlock()]);

    expect(FakeAudioContext.instances).toHaveLength(1);
  });

  it('preloads and decodes all four sounds', async () => {
    await service.unlock();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(FakeAudioContext.instances[0].decodeAudioData).toHaveBeenCalledTimes(4);
  });

  it('makes preload idempotent', async () => {
    await service.unlock();
    await service.preload();

    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('plays a preloaded sound through a buffer source', async () => {
    await service.unlock();
    service.play('click');

    const context = FakeAudioContext.instances[0];
    expect(context.createBufferSource).toHaveBeenCalledOnce();
    expect(context.sources[0].buffer).not.toBeNull();
    expect(context.sources[0].connect).toHaveBeenCalledWith(context.destination);
    expect(context.sources[0].start).toHaveBeenCalledWith(0);
  });

  it('does nothing when played before unlock', () => {
    service.play('click');

    expect(FakeAudioContext.instances).toHaveLength(0);
  });

  it('does nothing when a sound fails to load', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/sounds/click.wav') throw new Error('Unavailable');
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    });
    await service.unlock();
    service.play('click');

    expect(FakeAudioContext.instances[0].createBufferSource).not.toHaveBeenCalled();
  });

  it('does nothing when muted', async () => {
    await service.unlock();
    service.setMuted(true);
    service.play('click');

    expect(FakeAudioContext.instances[0].createBufferSource).not.toHaveBeenCalled();
  });

  it('tracks the muted setting', () => {
    expect(service.isMuted()).toBe(false);
    service.setMuted(true);
    expect(service.isMuted()).toBe(true);
  });

  it('exports the AudioService singleton', () => {
    expect(sounds).toBeInstanceOf(AudioService);
  });
});
