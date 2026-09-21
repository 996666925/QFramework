# qframework-laya

[QFramework.ts](https://github.com/996666925/QFramework) 的 **LayaAir 适配层**：把 `@qframework/core` 的 MVC 分层架构接到 Laya 节点与生命周期上。

> 完整文档：[项目总览](https://github.com/996666925/QFramework#readme) ·
> [入门指南](https://github.com/996666925/QFramework/blob/main/docs/GETTING-STARTED.md) ·
> [API 参考](https://github.com/996666925/QFramework/blob/main/docs/API.md) ·
> [C# 迁移对照](https://github.com/996666925/QFramework/blob/main/docs/MIGRATION.md)

## 安装

```bash
pnpm add qframework-laya
# 或 npm install qframework-laya
```

本包已执行 `export * from '@qframework/core'`，**核心 API（`Architecture` / `Command` / `Query` / `Model` / `System` / `Utility` / `BindableProperty` 等）可以直接从这里导入**，不需要再单独安装 `@qframework/core`。

## 快速开始

```ts
import {
  AbstractController,
  unRegisterWhenNodeDestroyed,
} from 'qframework-laya';

class HudController extends AbstractController {
  // 重写后，onAwake 阶段会自动完成架构绑定
  protected getArchitectureClass() {
    return CounterApp;
  }

  // 架构就绪后回调，在这里注册事件 / 绑定数据
  protected onInit(): void {
    const model = this.getModel(CounterModel)!;

    // 数据绑定，并绑定到节点生命周期：节点销毁时自动解绑
    unRegisterWhenNodeDestroyed(
      model.count.registerWithInitValue((v) => this.render(v)),
      this.node,
    );
  }

  private render(count: number): void {
    // 更新 UI
  }

  onClickAddButton(): void {
    this.sendCommand(new IncreaseCountCommand());
  }
}
```

`AbstractController` 继承自 `Laya.Script`，可以直接挂到 Laya 节点上，拥有完整的 `onAwake / onEnable / onStart / onUpdate / onDestroy` 生命周期。

## 关于 Laya 全局对象

本包直接使用全局 `Laya`，因此它必须在 `import 'qframework-laya'` **之前**就绪：

```ts
import { Laya } from 'LayaAir';                        // 先引入 Laya
import { AbstractController } from 'qframework-laya';  // 后引入本包
```

Laya 是异步加载时，等待其就绪后再动态导入业务模块：

```ts
await loadLaya();
await import('./MyController');
```

## 类型声明

本包的类型声明引用了 LayaAir 的全局 `Laya` 命名空间。若项目尚未引入 LayaAir 类型且未开启 `skipLibCheck`，`tsc` 会报 `Cannot find name 'Laya'`，在 `tsconfig.json` 中开启 `skipLibCheck` 即可。

## 主要导出

| 导出 | 说明 |
|---|---|
| `AbstractController` | Laya 脚本版 Controller，架构入口 |
| `unRegisterWhenNodeDestroyed` / `unRegisterWhenComponentDestroyed` | 节点 / 组件销毁时自动注销 |
| `registerLayaComparers` | 为 Laya 值类型注册 `BindableProperty` 比较器 |
| `AudioKit` | 音乐、人声和音效播放，支持音量/开关持久化与重复音效抑制 |
| `AudioPlayer` / `MusicPlayer` | 可暂停、恢复、停止并监听开始/结束的播放控制器 |
| `IAudioLoaderPool` | 将逻辑音频名称解析为 Laya 可播放 URL 的扩展点 |
| `PlaySoundAction` | 可独立执行或追加到结构化 Sequence 的音效动作 |
| `@qframework/core` 的全部导出 | `Architecture`、`Command`、`Query`、`Model`、`System`、`Utility`、`BindableProperty`、`EasyEvent`、`TypeEventSystem` 等 |

## AudioKit

LayaAir 以资源 URL 播放音频，因此 Unity 版的 `AudioClip` 参数在本包中对应 `string` URL：

```ts
import { AudioKit, PlaySoundModes } from 'qframework-laya';

AudioKit.playMusic('audio/bgm.mp3', { loop: true, volume: 0.8 });
AudioKit.playVoice('audio/welcome.mp3', {
  onFinish: () => console.log('语音播放完成'),
});
AudioKit.playMusicUrl(cdnMusicUrl); // 绕过自定义加载器

const player = AudioKit.playSound('audio/click.wav', {
  onFinish: () => console.log('播放完成'),
  volume: 0.8,
  pitch: 1.0,
  mode: PlaySoundModes.IgnoreSameSoundInSoundFrames,
});

player.pause();
player.resume();

AudioKit.settings.musicVolume.value = 0.6;
AudioKit.settings.isSoundOn.value = false;
```

链式 API 可用于组装播放参数：

```ts
AudioKit.music()
  .withName('audio/battle.mp3')
  .loop(true)
  .volumeScale(0.7)
  .play();

AudioKit.sound()
  .withAudioClip('audio/hit.wav') // 已解析 URL，直接播放
  .pitch(1.2)
  .playSoundMode(PlaySoundModes.IgnoreSameSoundInGlobalFrames)
  .play();
```

默认加载器把名称直接作为 URL。项目使用资源表、CDN 或版本映射时，可通过
`AudioKit.config.audioLoaderPool` 注入自定义 `IAudioLoaderPool`。`withName()` 和普通
`play*()` 会经过加载器；`withAudioClip()` 和 `play*Url()` 直接使用 URL。

## License

MIT
