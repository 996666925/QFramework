import { beforeEach, describe, expect, test } from '@rstest/core';
import {
  AbstractModel,
  AudioActionStatus,
  AudioKit,
  AudioSearchKeys,
  AudioKitSettingsModel,
  DefaultAudioLoaderPool,
  IAudioLoader,
  IAudioLoaderPool,
  IAudioAction,
  PlaySoundAction,
  PlaySoundModes,
  playSound,
} from '../packages/laya/src/index';
import { StubSoundChannel, stubSoundManager, stubTimer } from './laya-stub';

function lastChannel(): StubSoundChannel {
  return stubSoundManager.channels.at(-1)!;
}

describe('AudioKit', () => {
  beforeEach(() => {
    AudioKit.dispose();
    stubSoundManager.reset();
    stubTimer.currFrame = 0;
    AudioKit.config.audioLoaderPool = new DefaultAudioLoaderPool();
    AudioKit.settings.isSoundOn.value = true;
    AudioKit.settings.isMusicOn.value = true;
    AudioKit.settings.isVoiceOn.value = true;
    AudioKit.settings.soundVolume.value = 1;
    AudioKit.settings.musicVolume.value = 1;
    AudioKit.settings.voiceVolume.value = 1;
    AudioKit.playSoundMode = PlaySoundModes.EveryOne;
  });

  test('plays music with lifecycle, loop and volume controls', () => {
    const calls: string[] = [];

    AudioKit.playMusic('audio/bgm.mp3', {
      loop: false,
      onStart: () => calls.push('start'),
      onFinish: () => calls.push('finish'),
      volume: 0.5,
    });

    expect(lastChannel().url).toBe('audio/bgm.mp3');
    expect(lastChannel().loops).toBe(1);
    expect(lastChannel().volume).toBe(0.5);
    expect(calls).toEqual(['start']);

    lastChannel().finish();
    expect(calls).toEqual(['start', 'finish']);
  });

  test('controls sound channels and invokes the completion callback', () => {
    let completed: unknown = null;
    let completedName: string | null = null;
    let completedChannel: Laya.SoundChannel | null = null;
    const player = AudioKit.playSound('audio/hit.wav', {
      onFinish: (value) => { completed = value; },
      volume: 0.4,
      pitch: 1.5,
    });
    player.onFinish(() => {
      completedName = player.audioName;
      completedChannel = player.soundChannel;
    });

    expect(player.soundChannel).toBe(lastChannel() as unknown as Laya.SoundChannel);
    expect(lastChannel().volume).toBe(0.4);
    expect(lastChannel().playbackRate).toBe(1.5);

    lastChannel().finish();
    expect(completed).toBe(player);
    expect(completedName).toBe('audio/hit.wav');
    expect(completedChannel).not.toBeNull();
    expect(player.isPlaying).toBe(false);
    expect(player.audioName).toBeNull();
  });

  test('updates active channel volume and category switches', () => {
    AudioKit.playVoice('audio/voice.mp3', { loop: true, volume: 0.5 });
    const first = lastChannel();

    AudioKit.settings.voiceVolume.value = 0.4;
    expect(first.volume).toBeCloseTo(0.2);

    AudioKit.settings.isVoiceOn.value = false;
    expect(first.isStopped).toBe(true);

    AudioKit.settings.isVoiceOn.value = true;
    expect(lastChannel().url).toBe('audio/voice.mp3');
    expect(lastChannel()).not.toBe(first);
  });

  test('pauses and resumes music', () => {
    AudioKit.playMusic('audio/bgm.mp3');
    const channel = lastChannel();

    AudioKit.pauseMusic();
    expect(channel.paused).toBe(true);
    AudioKit.resumeMusic();
    expect(channel.paused).toBe(false);
  });

  test('stops all AudioKit-owned sound effects', () => {
    AudioKit.playSound('audio/a.wav');
    const a = lastChannel();
    AudioKit.playSound('audio/b.wav');
    const b = lastChannel();

    AudioKit.stopAllSound();

    expect(a.isStopped).toBe(true);
    expect(b.isStopped).toBe(true);
  });

  test('filters the same sound by per-sound frame window', () => {
    AudioKit.playSoundMode = PlaySoundModes.IgnoreSameSoundInSoundFrames;
    AudioKit.soundFrameCountForIgnoreSameSound = 3;

    const first = AudioKit.playSound('audio/hit.wav');
    const second = AudioKit.playSound('audio/hit.wav');
    expect(first.isPlaying).toBe(true);
    expect(second.isPlaying).toBe(false);
    expect(stubSoundManager.channels).toHaveLength(1);

    stubTimer.currFrame = 4;
    expect(AudioKit.playSound('audio/hit.wav').isPlaying).toBe(true);
  });

  test('supports custom logical-name loaders', () => {
    let loadCount = 0;
    class PrefixLoader implements IAudioLoader {
      clip: string | null = null;
      loadClip(keys: AudioSearchKeys): string | null {
        loadCount++;
        return this.clip = `cdn/${keys.assetName}`;
      }
      loadClipAsync(keys: AudioSearchKeys, onLoad: (success: boolean, url: string | null) => void): void {
        onLoad(true, this.loadClip(keys));
      }
      unload(): void {
        this.clip = null;
      }
    }
    const loader = new PrefixLoader();
    const pool: IAudioLoaderPool = {
      allocateLoader: () => loader,
      recycleLoader: () => {},
    };
    AudioKit.config.audioLoaderPool = pool;

    AudioKit.playSound('hit');
    expect(lastChannel().url).toBe('cdn/hit');

    AudioKit.playSoundUrl('audio/direct.wav');
    expect(lastChannel().url).toBe('audio/direct.wav');
    expect(loadCount).toBe(1);

    AudioKit.sound().withAudioClip('audio/fluent-direct.wav').play();
    expect(lastChannel().url).toBe('audio/fluent-direct.wav');
    expect(loadCount).toBe(1);
  });

  test('provides fluent music and sound APIs', () => {
    AudioKit.music().withName('audio/bgm.mp3').loop(false).volumeScale(0.25).play();
    expect(lastChannel().volume).toBe(0.25);

    const player = AudioKit.sound()
      .withAudioClip('audio/click.wav')
      .pitch(2)
      .play();
    expect(player?.soundChannel).toBe(lastChannel() as unknown as Laya.SoundChannel);
    expect(lastChannel().playbackRate).toBe(2);
  });

  test('reuses completed AudioPlayer with a live volume binding', () => {
    const player = AudioKit.playSound('audio/first.wav');
    lastChannel().finish();
    expect(player.isRecycled).toBe(true);

    player.play('audio/second.wav');
    expect(player.isRecycled).toBe(false);
    AudioKit.settings.soundVolume.value = 0.3;
    expect(lastChannel().volume).toBe(0.3);
  });

  test('aligns model and pooling APIs', () => {
    expect(AudioKit.settings).toBeInstanceOf(AudioKitSettingsModel);
    expect(AudioKit.settings).toBeInstanceOf(AbstractModel);

    const keys = AudioSearchKeys.allocate();
    keys.assetName = 'audio/test.wav';
    keys.recycle2Cache();
    expect(keys.isRecycled).toBe(true);
    expect(AudioSearchKeys.allocate()).toBe(keys);
  });

  test('provides PlaySoundAction and sequence append integration', () => {
    let finished = 0;
    const action = PlaySoundAction.allocate('audio/action.wav', () => finished++);

    expect(action.execute(0)).toBe(false);
    expect(action.status).toBe(AudioActionStatus.Started);
    lastChannel().finish();
    expect(action.status).toBe(AudioActionStatus.Finished);
    expect(action.execute(0)).toBe(true);
    expect(finished).toBe(1);
    action.deinit();

    const actions: IAudioAction[] = [];
    const sequence = {
      append(value: IAudioAction) {
        actions.push(value);
        return this;
      },
    };
    expect(playSound(sequence, 'audio/sequence.wav')).toBe(sequence);
    expect(actions).toHaveLength(1);
    actions[0].deinit();
  });
});
