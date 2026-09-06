# GoPoker Raise Panel Pack

包含：
- React + TypeScript `PokerRaisePanel.tsx`
- 对应 `PokerRaisePanel.css`
- 可直接打开的 `demo/index.html`
- 当前 Action Bar 所需按钮素材
- 新版语义图标与 chip 图标

## React 使用

```tsx
import PokerRaisePanel from "./components/PokerRaisePanel/PokerRaisePanel";

<PokerRaisePanel
  pot={20}
  minRaise={20}
  maxRaise={400}
  initialAmount={40}
  onClose={() => setRaiseOpen(false)}
  onConfirm={(amount) => {
    console.log("raise", amount);
    setRaiseOpen(false);
  }}
/>
```

## 建议放置方式

将面板放在 Action Bar 上方，外部容器使用 `position: relative`。
面板底部自带 pointer，可对准“加注”按钮。

## 视觉逻辑

- 面板：深蓝灰 + 细金边
- 普通快捷项：冷银蓝灰
- 当前选中：暖金
- Slider：金色进度 + 深色轨道
- 金额：`#F3D99D`
- 主按钮：与 BET / 加注按钮同一套黄铜材质
- 关闭：弱化成右上角 `×`
