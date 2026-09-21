# qframework-fairygui-babylon

[QFramework.ts](https://github.com/996666925/QFramework) 的 **FairyGUI-Babylon 适配层**：把 `@qframework/core` 的 MVC 分层架构接到 [FairyGUI-babylon](https://github.com/996666925/FairyGUI-babylon) 的 `GObject` / `GComponent` 生命周期上。

> 完整文档：[项目总览](https://github.com/996666925/QFramework#readme) ·
> [入门指南](https://github.com/996666925/QFramework/blob/main/docs/GETTING-STARTED.md) ·
> [API 参考](https://github.com/996666925/QFramework/blob/main/docs/API.md#fairygui-babylon-适配层) ·
> [C# 迁移对照](https://github.com/996666925/QFramework/blob/main/docs/MIGRATION.md)

## 安装

```bash
pnpm add qframework-fairygui-babylon fairygui-babylon @babylonjs/core
```

本包已执行 `export * from '@qframework/core'`，**核心 API（`Architecture` / `Command` / `Query` / `Model` / `System` / `Utility` / `BindableProperty` 等）可以直接从这里导入**，不需要再单独安装 `@qframework/core`。

适配层通过**结构化的对象契约**（`dispose()` / `on()` / `off()` / `disposed`）接入 FairyGUI，不直接 `import` `fairygui-babylon` 或 `@babylonjs/core`，因此本包不把它们声明为运行时依赖，你可以自行选择 Babylon.js 版本。

## 快速开始

```ts
import {
  AbstractFairyGUIController,
  unRegisterWhenFairyGUIUndisplayed,
} from 'qframework-fairygui-babylon';
import type { GComponent } from 'fairygui-babylon';

class HudController extends AbstractFairyGUIController<GComponent> {
  protected getArchitectureClass() {
    return CounterApp;
  }

  protected onInit(): void {
    const unregister = this.registerEvent(CountChangedEvent, () => this.refresh());

    // 视图离开显示列表时自动解绑
    unRegisterWhenFairyGUIUndisplayed(unregister, this.view);
  }

  private refresh(): void {
    // 更新 FairyGUI 组件
  }
}

// 工厂会在子类初始化完成后自动调用 onAwake()
const hud = HudController.create(ui.menu);
```

## 生命周期

| API | 触发时机 |
|---|---|
| `AbstractFairyGUIController.create(view)` | 创建控制器并在子类字段初始化完成后执行 `onAwake()` |
| `controller.destroy()` | 主动销毁：先执行 `onDestroy()`，再 `view.dispose()` |
| `unRegisterWhenFairyGUIUndisplayed(unRegister, object)` | 对象收到 `fui_undisplay`（离开显示列表）时注销 |
| `unRegisterWhenFairyGUIDisposed(unRegister, object)` | `object.dispose()` 被调用时注销 |
| `installFairyGUIBabylon(runtime)` | 可选注入，用于从 `EventType.UNDISPLAY` 读取真实事件常量 |

控制器构造时会自动监听视图 `dispose()`：视图被外部释放时控制器会一并销毁；反过来 `controller.destroy()` 也会释放视图。两者互相触发但不会重复执行。

> 未注入 `fairygui-babylon` 运行时时的默认事件常量是 `fui_display` / `fui_undisplay`。

## 主要导出

| 导出 | 说明 |
|---|---|
| `AbstractFairyGUIController<TView>` | FairyGUI 视图版 Controller，架构入口 |
| `unRegisterWhenFairyGUIDisposed` / `unRegisterWhenObjectDisposed` | 视图 `dispose()` 时自动注销 |
| `unRegisterWhenFairyGUIUndisplayed` | 视图离开显示列表时自动注销 |
| `installFairyGUIBabylon` / `getFairyGUIBabylon` | FairyGUI 运行时注入与读取 |
| `FairyGUIObjectLike` / `FairyGUIComponentLike` / `FairyGUIBabylonRuntime` | 适配层使用的结构化契约类型 |
| `@qframework/core` 的全部导出 | `Architecture`、`Command`、`Query`、`Model`、`System`、`Utility`、`BindableProperty`、`EasyEvent`、`TypeEventSystem` 等 |

## License

MIT
