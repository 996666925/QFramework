/****************************************************************************
 * QFramework AudioKit - LayaAir adapter
 * Original QFramework (C#): Copyright (c) 2015 - 2025 liangxiegame, MIT License
 ****************************************************************************/

import {
  AbstractModel,
  BindableProperty,
  EasyEvent1,
  IUnRegister,
} from '@qframework/core';

type AudioKind = 'music' | 'voice' | 'sound';

function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}

function normalizeFrameCount(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/** Controls how repeated sound effects are filtered. */
export enum PlaySoundModes {
  EveryOne,
  IgnoreSameSoundInGlobalFrames,
  IgnoreSameSoundInSoundFrames,
}

/** Optional controls shared by music and voice playback. */
export interface PlayAudioOptions {
  loop?: boolean;
  onStart?: () => void;
  onFinish?: () => void;
  volume?: number;
}

/** Optional controls for a single sound-effect playback. */
export interface PlaySoundOptions {
  loop?: boolean;
  onFinish?: (player: AudioPlayer) => void;
  volume?: number;
  pitch?: number;
  mode?: PlaySoundModes;
}

/** Resource lookup data passed to an AudioKit loader. */
export class AudioSearchKeys {
  private static readonly pool: AudioSearchKeys[] = [];

  assetBundleName: string | null = null;
  assetName: string | null = null;
  isRecycled = false;

  static allocate(): AudioSearchKeys {
    const keys = this.pool.pop() ?? new AudioSearchKeys();
    keys.isRecycled = false;
    return keys;
  }

  onRecycled(): void {
    this.assetBundleName = null;
    this.assetName = null;
  }

  recycle2Cache(): void {
    if (this.isRecycled) return;
    this.isRecycled = true;
    this.onRecycled();
    AudioSearchKeys.pool.push(this);
  }

  toString(): string {
    return `AudioSearchKeys AssetName:${this.assetName} AssetBundleName:${this.assetBundleName}`;
  }
}

export type AudioLoadCallback = (success: boolean, url: string | null) => void;

/** Resolves logical audio names to URLs understood by Laya.SoundManager. */
export interface IAudioLoader {
  readonly clip: string | null;
  loadClip(keys: AudioSearchKeys): string | null;
  loadClipAsync(keys: AudioSearchKeys, onLoad: AudioLoadCallback): void;
  unload(): void;
}

export interface IAudioLoaderPool {
  allocateLoader(): IAudioLoader;
  recycleLoader(loader: IAudioLoader): void;
}

export abstract class AbstractAudioLoaderPool implements IAudioLoaderPool {
  private readonly pool: IAudioLoader[] = [];

  allocateLoader(): IAudioLoader {
    return this.pool.pop() ?? this.createLoader();
  }

  recycleLoader(loader: IAudioLoader): void {
    this.pool.push(loader);
  }

  protected abstract createLoader(): IAudioLoader;
}

/** Default loader: a logical name is already a Laya resource URL. */
export class DefaultAudioLoader implements IAudioLoader {
  private loadedClip: string | null = null;

  get clip(): string | null {
    return this.loadedClip;
  }

  loadClip(keys: AudioSearchKeys): string | null {
    this.loadedClip = keys.assetName;
    return this.loadedClip;
  }

  loadClipAsync(keys: AudioSearchKeys, onLoad: AudioLoadCallback): void {
    const url = this.loadClip(keys);
    onLoad(url !== null && url.length > 0, url);
  }

  unload(): void {
    this.loadedClip = null;
  }
}

export class DefaultAudioLoaderPool extends AbstractAudioLoaderPool {
  protected createLoader(): IAudioLoader {
    return new DefaultAudioLoader();
  }
}

export class AudioLoaderPoolModel extends AbstractModel {
  audioLoaderPool: IAudioLoaderPool = new DefaultAudioLoaderPool();

  protected onInit(): void {}
}

class StoredBindableProperty<T> extends BindableProperty<T> {
  constructor(
    private readonly storageKey: string,
    defaultValue: T,
    private readonly parse: (value: string) => T,
  ) {
    super(StoredBindableProperty.read(storageKey, defaultValue, parse));
  }

  protected override setValue(newValue: T): void {
    super.setValue(newValue);
    try {
      Laya.LocalStorage.setItem(this.storageKey, String(newValue));
    } catch {
      // Storage can be unavailable in privacy mode or non-browser test runtimes.
    }
  }

  private static read<T>(key: string, fallback: T, parse: (value: string) => T): T {
    try {
      const value = Laya.LocalStorage.getItem(key);
      return value === null || value === undefined ? fallback : parse(value);
    } catch {
      return fallback;
    }
  }
}

/** A single switch backed by the three category switches. */
export class AudioKitAllSwitch {
  private readonly changed = new EasyEvent1<boolean>();
  private lastValue: boolean;

  constructor(private readonly settings: AudioKitSettingsModel) {
    this.lastValue = this.value;
    const refresh = () => {
      const value = this.value;
      if (value === this.lastValue) return;
      this.lastValue = value;
      this.changed.trigger(value);
    };
    settings.isSoundOn.register(refresh);
    settings.isMusicOn.register(refresh);
    settings.isVoiceOn.register(refresh);
  }

  get value(): boolean {
    return this.settings.isSoundOn.value &&
      this.settings.isMusicOn.value &&
      this.settings.isVoiceOn.value;
  }

  set value(value: boolean) {
    this.settings.isSoundOn.value = value;
    this.settings.isMusicOn.value = value;
    this.settings.isVoiceOn.value = value;
  }

  register(onValueChanged: (value: boolean) => void): IUnRegister {
    return this.changed.register(onValueChanged);
  }

  registerWithInitValue(onValueChanged: (value: boolean) => void): IUnRegister {
    onValueChanged(this.value);
    return this.register(onValueChanged);
  }

  unRegister(onValueChanged: (value: boolean) => void): void {
    this.changed.unRegister(onValueChanged);
  }
}

export class AudioKitSettingsModel extends AbstractModel {
  readonly isSoundOn: BindableProperty<boolean> =
    new StoredBindableProperty('KEY_AUDIO_MANAGER_SOUND_ON', true, (value) => value !== 'false');
  readonly isMusicOn: BindableProperty<boolean> =
    new StoredBindableProperty('KEY_AUDIO_MANAGER_MUSIC_ON', true, (value) => value !== 'false');
  readonly isVoiceOn: BindableProperty<boolean> =
    new StoredBindableProperty('KEY_AUDIO_MANAGER_VOICE_ON', true, (value) => value !== 'false');
  readonly soundVolume: BindableProperty<number> =
    new StoredBindableProperty('KEY_AUDIO_MANAGER_SOUND_VOLUME', 1, Number);
  readonly musicVolume: BindableProperty<number> =
    new StoredBindableProperty('KEY_AUDIO_MANAGER_MUSIC_VOLUME', 1, Number);
  readonly voiceVolume: BindableProperty<number> =
    new StoredBindableProperty('KEY_AUDIO_MANAGER_VOICE_VOLUME', 1, Number);
  readonly isOn = new AudioKitAllSwitch(this);

  protected onInit(): void {}
}

export { AudioKitSettingsModel as AudioKitSettings };

class AudioPlayerLifeCycle {
  private readonly starts: Array<() => void> = [];
  private readonly finishes: Array<() => void> = [];

  onStart(callback?: (() => void) | null): void {
    if (callback) this.starts.push(callback);
  }

  onFinish(callback?: (() => void) | null): void {
    if (callback) this.finishes.push(callback);
  }

  callStart(): void {
    for (const callback of this.starts.splice(0)) callback();
  }

  callFinish(): void {
    for (const callback of this.finishes.splice(0)) callback();
  }

  clear(): void {
    this.starts.length = 0;
    this.finishes.length = 0;
  }
}

class PlaySoundChannelSystem {
  defaultMode = PlaySoundModes.EveryOne;
  soundFrameCountForIgnoreSameSound = 10;
  globalFrameCountForIgnoreSameSound = 10;

  private readonly soundFrames = new Map<string, number>();
  private readonly globalFrameNames = new Set<string>();
  private globalFrame = Number.NEGATIVE_INFINITY;

  canPlay(name: string, mode: PlaySoundModes): boolean {
    const frame = Laya.timer.currFrame;
    if (mode === PlaySoundModes.EveryOne) return true;

    if (mode === PlaySoundModes.IgnoreSameSoundInSoundFrames) {
      const previous = this.soundFrames.get(name);
      if (previous !== undefined && frame - previous <= this.soundFrameCountForIgnoreSameSound) return false;
      this.soundFrames.set(name, frame);
      return true;
    }

    if (frame - this.globalFrame > this.globalFrameCountForIgnoreSameSound) {
      this.globalFrame = frame;
      this.globalFrameNames.clear();
    }
    if (this.globalFrameNames.has(name)) return false;
    this.globalFrameNames.add(name);
    return true;
  }

  finish(name: string, mode: PlaySoundModes): void {
    if (mode === PlaySoundModes.IgnoreSameSoundInSoundFrames) this.soundFrames.delete(name);
  }

  clear(): void {
    this.soundFrames.clear();
    this.globalFrameNames.clear();
    this.globalFrame = Number.NEGATIVE_INFINITY;
  }
}

const playSoundChannelSystem = new PlaySoundChannelSystem();

export abstract class AbstractAudioPlayer {
  volume: BindableProperty<number>;
  audioName: string | null = null;

  protected channel: Laya.SoundChannel | null = null;
  protected volumeScaleValue = 1;
  protected pitchValue = 1;
  protected loopValue: boolean;

  private readonly lifeCycle = new AudioPlayerLifeCycle();
  private loader: IAudioLoader | null = null;
  private loaderPool: IAudioLoaderPool | null = null;
  private operationId = 0;
  private volumeUnRegister: IUnRegister | null;

  protected constructor(
    volume: BindableProperty<number>,
    loop: boolean,
    protected kind: AudioKind,
  ) {
    this.volume = volume;
    this.loopValue = loop;
    this.volumeUnRegister = volume.registerWithInitValue(() => this.applyVolume());
  }

  get isPaused(): boolean {
    return this.channel?.paused ?? false;
  }

  get isPlaying(): boolean {
    return this.channel !== null && !this.channel.isStopped;
  }

  get isLoop(): boolean {
    return this.loopValue;
  }

  set isLoop(value: boolean) {
    this.loopValue = value;
    if (this.channel) this.channel.loops = value ? 0 : 1;
  }

  get soundChannel(): Laya.SoundChannel | null {
    return this.channel;
  }

  onStart(callback?: (() => void) | null): this {
    this.lifeCycle.onStart(callback);
    return this;
  }

  onFinish(callback?: (() => void) | null): this {
    this.lifeCycle.onFinish(callback);
    return this;
  }

  volumeScale(value: number): this {
    this.volumeScaleValue = clampVolume(value);
    this.applyVolume();
    return this;
  }

  pitch(value: number): this {
    this.pitchValue = Number.isFinite(value) && value > 0 ? value : 1;
    if (this.channel) this.channel.playbackRate = this.pitchValue;
    return this;
  }

  pause(): void {
    this.channel?.pause();
  }

  resume(): void {
    this.channel?.resume();
  }

  stop(): void {
    this.operationId++;
    const channel = this.channel;
    this.channel = null;
    channel?.stop();
    this.releaseLoader();
    this.audioName = null;
    this.onStopped(false, true);
    this.lifeCycle.clear();
  }

  /** Releases playback state and settings subscriptions. */
  deinit(): void {
    this.stop();
    this.releaseVolumeBinding();
  }

  protected playByName(name: string, loop: boolean): this {
    this.ensureVolumeBinding();
    this.prepare(name, loop, true);
    return this;
  }

  protected playByUrl(url: string, name: string, loop: boolean): this {
    this.ensureVolumeBinding();
    this.prepare(url, loop, false, name);
    return this;
  }

  protected canPlay(): boolean {
    return true;
  }

  protected onStarted(): void {}

  protected onFinished(): void {}

  protected onStopped(_finished: boolean, _terminal: boolean): void {}

  protected releaseVolumeBinding(): void {
    this.volumeUnRegister?.unRegister();
    this.volumeUnRegister = null;
  }

  protected rebindVolume(volume: BindableProperty<number>): void {
    this.releaseVolumeBinding();
    this.volume = volume;
    this.ensureVolumeBinding();
  }

  private ensureVolumeBinding(): void {
    this.volumeUnRegister ??= this.volume.registerWithInitValue(() => this.applyVolume());
  }

  private prepare(value: string, loop: boolean, useLoader: boolean, audioName = value): void {
    this.operationId++;
    const operationId = this.operationId;
    const oldChannel = this.channel;
    this.channel = null;
    oldChannel?.stop();
    this.releaseLoader();
    this.onStopped(false, false);

    this.audioName = audioName;
    this.loopValue = loop;

    if (!value) {
      this.audioName = null;
      this.onStopped(false, true);
      this.lifeCycle.clear();
      return;
    }

    if (!useLoader) {
      this.startChannel(value, operationId);
      return;
    }

    const loaderPool = AudioKit.config.audioLoaderPool;
    const loader = loaderPool.allocateLoader();
    this.loaderPool = loaderPool;
    this.loader = loader;
    const keys = AudioSearchKeys.allocate();
    keys.assetName = value;
    loader.loadClipAsync(keys, (success, url) => {
      if (operationId !== this.operationId) return;
      if (!success || !url) {
        this.releaseLoader();
        this.audioName = null;
        this.onStopped(false, true);
        this.lifeCycle.clear();
        return;
      }
      this.startChannel(url, operationId);
    });
    keys.recycle2Cache();
  }

  private startChannel(url: string, operationId: number): void {
    if (!this.canPlay()) {
      this.releaseLoader();
      this.audioName = null;
      this.onStopped(false, true);
      this.lifeCycle.clear();
      return;
    }

    this.lifeCycle.callStart();
    if (operationId !== this.operationId) return;
    const complete = () => this.handleComplete(operationId);
    const soundManager = Laya.SoundManager;
    this.channel = this.kind === 'music'
      ? soundManager.playMusic(url, this.loopValue ? 0 : 1, () => complete())
      : soundManager.playSound(url, this.loopValue ? 0 : 1, complete);
    this.applyVolume();
    this.channel.playbackRate = this.pitchValue;
    this.onStarted();
  }

  private handleComplete(operationId: number): void {
    if (operationId !== this.operationId || this.loopValue) return;
    this.onFinished();
    this.lifeCycle.callFinish();
    if (operationId !== this.operationId) return;
    this.channel = null;
    this.releaseLoader();
    this.audioName = null;
    this.onStopped(true, true);
  }

  private applyVolume(): void {
    if (this.channel) this.channel.volume = clampVolume(this.volume.value * this.volumeScaleValue);
  }

  private releaseLoader(): void {
    if (!this.loader) return;
    const loader = this.loader;
    const loaderPool = this.loaderPool;
    this.loader = null;
    this.loaderPool = null;
    loader.unload();
    loaderPool?.recycleLoader(loader);
  }
}

export class MusicPlayer extends AbstractAudioPlayer {
  constructor(volume: BindableProperty<number>, loop = true) {
    super(volume, loop, 'music');
  }

  play(name: string, loop = this.isLoop): this {
    return this.playByName(name, loop);
  }

  playUrl(url: string, name = url, loop = this.isLoop): this {
    return this.playByUrl(url, name, loop);
  }

  deinit(): void {
    super.deinit();
  }
}

class VoicePlayer extends MusicPlayer {
  constructor(volume: BindableProperty<number>) {
    super(volume, false);
    this.kind = 'voice';
  }
}

export class AudioPlayer extends AbstractAudioPlayer {
  private static readonly pool: AudioPlayer[] = [];

  playSoundMode: PlaySoundModes;
  isRecycled = false;

  constructor(
    volume: BindableProperty<number> = AudioKit.settings.soundVolume,
    playSoundMode = AudioKit.playSoundMode,
  ) {
    super(volume, false, 'sound');
    this.playSoundMode = playSoundMode;
  }

  static allocate(
    volume: BindableProperty<number> = AudioKit.settings.soundVolume,
    playSoundMode = AudioKit.playSoundMode,
  ): AudioPlayer {
    const player = this.pool.pop() ?? new AudioPlayer(volume, playSoundMode);
    player.isRecycled = false;
    player.playSoundMode = playSoundMode;
    player.rebindVolume(volume);
    return player;
  }

  play(name: string, loop = false): this {
    this.reactivate();
    return this.playByName(name, loop);
  }

  playUrl(url: string, name = url, loop = false): this {
    this.reactivate();
    return this.playByUrl(url, name, loop);
  }

  onRecycled(): void {
    this.releaseVolumeBinding();
  }

  recycle2Cache(): void {
    if (this.isRecycled) return;
    if (this.isPlaying || this.audioName !== null) {
      this.stop();
      return;
    }
    this.isRecycled = true;
    this.onRecycled();
    AudioPlayer.pool.push(this);
  }

  private reactivate(): void {
    if (!this.isRecycled) return;
    const index = AudioPlayer.pool.indexOf(this);
    if (index >= 0) AudioPlayer.pool.splice(index, 1);
    this.isRecycled = false;
  }

  protected override canPlay(): boolean {
    return AudioKit.settings.isSoundOn.value &&
      playSoundChannelSystem.canPlay(this.audioName ?? '', this.playSoundMode);
  }

  protected override onStarted(): void {
    playingSounds.add(this);
  }

  protected override onFinished(): void {
    if (this.audioName)
      playSoundChannelSystem.finish(this.audioName, this.playSoundMode);
  }

  protected override onStopped(_finished: boolean, terminal: boolean): void {
    playingSounds.delete(this);
    if (terminal) this.recycle2Cache();
  }
}

const playingSounds = new Set<AudioPlayer>();

interface AudioPlaybackRequest {
  readonly source: string;
  readonly directUrl: boolean;
  readonly loop: boolean;
  readonly volume: number;
}

class AudioManager {
  readonly musicPlayer = new MusicPlayer(AudioKit.settings.musicVolume, true);
  readonly voicePlayer = new VoicePlayer(AudioKit.settings.voiceVolume);
  currentMusic: AudioPlaybackRequest | null = null;
  currentVoice: AudioPlaybackRequest | null = null;
  private readonly unRegisters: IUnRegister[] = [];

  constructor() {
    this.unRegisters.push(AudioKit.settings.isMusicOn.register((isOn) => {
      if (!isOn) this.musicPlayer.stop();
      else if (this.currentMusic) this.replay(this.musicPlayer, this.currentMusic);
    }));
    this.unRegisters.push(AudioKit.settings.isVoiceOn.register((isOn) => {
      if (!isOn) this.voicePlayer.stop();
      else if (this.currentVoice) this.replay(this.voicePlayer, this.currentVoice);
    }));
    this.unRegisters.push(AudioKit.settings.isSoundOn.register((isOn) => {
      if (!isOn) AudioKit.stopAllSound();
    }));
  }

  dispose(): void {
    this.musicPlayer.deinit();
    this.voicePlayer.deinit();
    for (const unRegister of this.unRegisters) unRegister.unRegister();
    this.unRegisters.length = 0;
  }

  private replay(player: MusicPlayer, request: AudioPlaybackRequest): void {
    player.volumeScale(request.volume);
    if (request.directUrl) player.playUrl(request.source, request.source, request.loop);
    else player.play(request.source, request.loop);
  }
}

export class FluentMusicAPI {
  private static readonly pool: FluentMusicAPI[] = [];

  private name: string | null = null;
  private directUrl = false;
  private loopValue = true;
  private volumeScaleValue = 1;
  isRecycled = false;

  static allocate(): FluentMusicAPI {
    const api = this.pool.pop() ?? new FluentMusicAPI();
    api.isRecycled = false;
    return api;
  }

  withName(name: string): this {
    this.name = name;
    this.directUrl = false;
    return this;
  }

  /** Uses an already resolved Laya audio URL and bypasses IAudioLoader. */
  withAudioClip(url: string): this {
    this.name = url;
    this.directUrl = true;
    return this;
  }

  loop(loop: boolean): this {
    this.loopValue = loop;
    return this;
  }

  volumeScale(volume: number): this {
    this.volumeScaleValue = volume;
    return this;
  }

  play(): void {
    if (!this.name) return;
    const recycle = () => this.recycle2Cache();
    const options: PlayAudioOptions = {
      loop: this.loopValue,
      onFinish: recycle,
      volume: this.volumeScaleValue,
    };
    if (this.directUrl)
      AudioKit.playMusicUrl(this.name, options);
    else
      AudioKit.playMusic(this.name, options);
  }

  onRecycled(): void {
    this.name = null;
    this.directUrl = false;
    this.loopValue = true;
    this.volumeScaleValue = 1;
  }

  recycle2Cache(): void {
    if (this.isRecycled) return;
    this.isRecycled = true;
    this.onRecycled();
    FluentMusicAPI.pool.push(this);
  }
}

export class FluentSoundAPI {
  private static readonly pool: FluentSoundAPI[] = [];

  private name: string | null = null;
  private directUrl = false;
  private loopValue = false;
  private volumeScaleValue = 1;
  private pitchValue = 1;
  private mode: PlaySoundModes | undefined;
  isRecycled = false;

  static allocate(): FluentSoundAPI {
    const api = this.pool.pop() ?? new FluentSoundAPI();
    api.isRecycled = false;
    return api;
  }

  withName(name: string): this {
    this.name = name;
    this.directUrl = false;
    return this;
  }

  /** Uses an already resolved Laya audio URL and bypasses IAudioLoader. */
  withAudioClip(url: string): this {
    this.name = url;
    this.directUrl = true;
    return this;
  }

  loop(loop: boolean): this {
    this.loopValue = loop;
    return this;
  }

  volumeScale(volume: number): this {
    this.volumeScaleValue = volume;
    return this;
  }

  pitch(pitch: number): this {
    this.pitchValue = pitch;
    return this;
  }

  playSoundMode(mode: PlaySoundModes): this {
    this.mode = mode;
    return this;
  }

  play(): AudioPlayer | null {
    if (!this.name) return null;
    const recycle = () => this.recycle2Cache();
    const options: PlaySoundOptions = {
      loop: this.loopValue,
      onFinish: recycle,
      volume: this.volumeScaleValue,
      pitch: this.pitchValue,
      mode: this.mode,
    };
    return this.directUrl
      ? AudioKit.playSoundUrl(this.name, options)
      : AudioKit.playSound(this.name, options);
  }

  onRecycled(): void {
    this.name = null;
    this.directUrl = false;
    this.loopValue = false;
    this.volumeScaleValue = 1;
    this.pitchValue = 1;
    this.mode = undefined;
  }

  recycle2Cache(): void {
    if (this.isRecycled) return;
    this.isRecycled = true;
    this.onRecycled();
    FluentSoundAPI.pool.push(this);
  }
}

export enum AudioActionStatus {
  NotStart,
  Started,
  Finished,
}

/** Minimal ActionKit-compatible contract used by PlaySoundAction. */
export interface IAudioAction {
  status: AudioActionStatus;
  paused: boolean;
  onStart(): void;
  onExecute(deltaTime: number): void;
  onFinish(): void;
  execute(deltaTime: number): boolean;
  reset(): void;
  deinit(): void;
}

/** Structural sequence contract; compatible sequences only need append(). */
export interface IAudioSequence {
  append(action: IAudioAction): this;
}

export class PlaySoundAction implements IAudioAction {
  private static readonly pool: PlaySoundAction[] = [];

  status = AudioActionStatus.NotStart;
  paused = false;

  private source: string | null = null;
  private directUrl = false;
  private finishCallback: (() => void) | null = null;
  private player: AudioPlayer | null = null;
  private isRecycled = false;

  static allocate(soundName: string, onFinish?: () => void): PlaySoundAction {
    return this.allocateInternal(soundName, false, onFinish);
  }

  static allocateUrl(url: string, onFinish?: () => void): PlaySoundAction {
    return this.allocateInternal(url, true, onFinish);
  }

  private static allocateInternal(
    source: string,
    directUrl: boolean,
    onFinish?: () => void,
  ): PlaySoundAction {
    const action = this.pool.pop() ?? new PlaySoundAction();
    action.source = source;
    action.directUrl = directUrl;
    action.finishCallback = onFinish ?? null;
    action.isRecycled = false;
    action.reset();
    return action;
  }

  onStart(): void {
    if (!this.source) {
      this.finish();
      return;
    }
    const complete = () => {
      this.player = null;
      this.finish();
    };
    const player = this.directUrl
      ? AudioKit.playSoundUrl(this.source, { onFinish: complete })
      : AudioKit.playSound(this.source, { onFinish: complete });
    this.player = this.status === AudioActionStatus.Finished ? null : player;
  }

  onExecute(_deltaTime: number): void {}

  onFinish(): void {
    this.finishCallback?.();
  }

  execute(deltaTime: number): boolean {
    if (this.paused || this.status === AudioActionStatus.Finished) {
      return this.status === AudioActionStatus.Finished;
    }
    if (this.status === AudioActionStatus.NotStart) {
      this.status = AudioActionStatus.Started;
      this.onStart();
    }
    if (this.status === AudioActionStatus.Started) this.onExecute(deltaTime);
    return (this.status as AudioActionStatus) === AudioActionStatus.Finished;
  }

  reset(): void {
    this.status = AudioActionStatus.NotStart;
    this.paused = false;
  }

  deinit(): void {
    if (this.isRecycled) return;
    this.player?.stop();
    this.player = null;
    this.source = null;
    this.directUrl = false;
    this.finishCallback = null;
    this.isRecycled = true;
    PlaySoundAction.pool.push(this);
  }

  private finish(): void {
    if (this.status === AudioActionStatus.Finished) return;
    this.status = AudioActionStatus.Finished;
    this.onFinish();
  }
}

export function playSound<TSequence extends IAudioSequence>(
  sequence: TSequence,
  soundName: string,
): TSequence {
  sequence.append(PlaySoundAction.allocate(soundName));
  return sequence;
}

export function playSoundUrl<TSequence extends IAudioSequence>(
  sequence: TSequence,
  url: string,
): TSequence {
  sequence.append(PlaySoundAction.allocateUrl(url));
  return sequence;
}

/** LayaAir implementation of QFramework AudioKit. */
export class AudioKit {
  static readonly settings = new AudioKitSettingsModel();
  static readonly config = new AudioLoaderPoolModel();

  private static managerValue: AudioManager | null = null;

  private static get manager(): AudioManager {
    return this.managerValue ?? (this.managerValue = new AudioManager());
  }

  static get musicPlayer(): MusicPlayer {
    return this.manager.musicPlayer;
  }

  static get voicePlayer(): MusicPlayer {
    return this.manager.voicePlayer;
  }

  static get playSoundMode(): PlaySoundModes {
    return playSoundChannelSystem.defaultMode;
  }

  static set playSoundMode(value: PlaySoundModes) {
    playSoundChannelSystem.defaultMode = value;
  }

  static get soundFrameCountForIgnoreSameSound(): number {
    return playSoundChannelSystem.soundFrameCountForIgnoreSameSound;
  }

  static set soundFrameCountForIgnoreSameSound(value: number) {
    playSoundChannelSystem.soundFrameCountForIgnoreSameSound = normalizeFrameCount(value);
  }

  static get globalFrameCountForIgnoreSameSound(): number {
    return playSoundChannelSystem.globalFrameCountForIgnoreSameSound;
  }

  static set globalFrameCountForIgnoreSameSound(value: number) {
    playSoundChannelSystem.globalFrameCountForIgnoreSameSound = normalizeFrameCount(value);
  }

  static playMusic(
    musicName: string,
    options: PlayAudioOptions = {},
  ): void {
    this.playMusicInternal(musicName, false, options);
  }

  static playMusicUrl(
    url: string,
    options: PlayAudioOptions = {},
  ): void {
    this.playMusicInternal(url, true, options);
  }

  private static playMusicInternal(
    source: string,
    directUrl: boolean,
    options: PlayAudioOptions,
  ): void {
    const { loop = true, onStart, onFinish, volume = 1 } = options;
    const manager = this.manager;
    manager.currentMusic = { source, directUrl, loop, volume };
    if (!this.settings.isMusicOn.value) return;
    const player = manager.musicPlayer
      .volumeScale(volume)
      .onStart(onStart)
      .onFinish(onFinish);
    if (directUrl) player.playUrl(source, source, loop);
    else player.play(source, loop);
  }

  static stopMusic(): void {
    this.manager.musicPlayer.stop();
  }

  static pauseMusic(): void {
    this.manager.musicPlayer.pause();
  }

  static resumeMusic(): void {
    this.manager.musicPlayer.resume();
  }

  static playVoice(
    voiceName: string,
    options: PlayAudioOptions = {},
  ): void {
    this.playVoiceInternal(voiceName, false, options);
  }

  static playVoiceUrl(
    url: string,
    options: PlayAudioOptions = {},
  ): void {
    this.playVoiceInternal(url, true, options);
  }

  private static playVoiceInternal(
    source: string,
    directUrl: boolean,
    options: PlayAudioOptions,
  ): void {
    const { loop = false, onStart, onFinish, volume = 1 } = options;
    const manager = this.manager;
    manager.currentVoice = { source, directUrl, loop, volume };
    if (!this.settings.isVoiceOn.value) return;
    const player = manager.voicePlayer
      .volumeScale(volume)
      .onStart(onStart)
      .onFinish(onFinish);
    if (directUrl) player.playUrl(source, source, loop);
    else player.play(source, loop);
  }

  static stopVoice(): void {
    this.manager.voicePlayer.stop();
  }

  static pauseVoice(): void {
    this.manager.voicePlayer.pause();
  }

  static resumeVoice(): void {
    this.manager.voicePlayer.resume();
  }

  static playSound(
    soundName: string,
    options: PlaySoundOptions = {},
  ): AudioPlayer {
    return this.playSoundInternal(soundName, false, options);
  }

  static playSoundUrl(
    url: string,
    options: PlaySoundOptions = {},
  ): AudioPlayer {
    return this.playSoundInternal(url, true, options);
  }

  private static playSoundInternal(
    source: string,
    directUrl: boolean,
    options: PlaySoundOptions,
  ): AudioPlayer {
    const {
      loop = false,
      onFinish,
      volume = 1,
      pitch = 1,
      mode = this.playSoundMode,
    } = options;
    const player = AudioPlayer.allocate(this.settings.soundVolume, mode)
      .volumeScale(volume)
      .pitch(pitch);
    player.onFinish(() => onFinish?.(player));
    if (directUrl) player.playUrl(source, source, loop);
    else player.play(source, loop);
    return player;
  }

  static stopAllSound(): void {
    for (const player of Array.from(playingSounds)) player.stop();
    playingSounds.clear();
  }

  static music(): FluentMusicAPI {
    return FluentMusicAPI.allocate();
  }

  static sound(): FluentSoundAPI {
    return FluentSoundAPI.allocate();
  }

  /** Stops AudioKit-owned channels and clears transient sound filtering state. */
  static dispose(): void {
    this.stopAllSound();
    this.managerValue?.dispose();
    this.managerValue = null;
    playSoundChannelSystem.clear();
  }

}
