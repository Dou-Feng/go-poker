import { useSocket } from "../hooks/useSocket";
import { addChips } from "../actions/actions";
import ui from "../styles/Dialog.module.css";
import Portal from "./Portal";

// Diamond recharge packs, ported from tmp/recharge (designer preview). The
// price copy is display-only; tapping a card grants diamonds + bonus as chips
// through the existing mock top-up (addChips).
type Pack = {
  img: string;
  diamonds: number;
  price: string;
  desc: string;
  tag?: string;
  /** Bonus diamonds, shown as "+N BONUS" and included in the credit. */
  bonus?: number;
  legend?: boolean;
  hot?: boolean;
};

const PACKS: Pack[] = [
  {
    img: "diamond_small.png",
    diamonds: 200,
    price: "$1.99",
    desc: "少量补充，随时畅玩",
  },
  {
    img: "diamond_medium.png",
    diamonds: 500,
    price: "$4.99",
    desc: "超值选择，畅玩更久",
    tag: "最受欢迎",
    hot: true,
  },
  {
    img: "diamond_medium.png",
    diamonds: 1000,
    price: "$9.99",
    desc: "更多精彩，更多可能",
    bonus: 100,
  },
  {
    img: "diamond_large.png",
    diamonds: 2000,
    price: "$19.99",
    desc: "最佳性价比",
    bonus: 300,
    legend: true,
  },
];

const TRUST = [
  { icon: "🛡️", title: "安全支付", sub: "多重加密保障" },
  { icon: "⚡", title: "即时到账", sub: "购买后立即生效" },
  { icon: "🎁", title: "专属福利", sub: "更多活动敬请期待" },
];

type RechargeProps = {
  onClose: () => void;
};

export default function Recharge({ onClose }: RechargeProps) {
  const socket = useSocket();

  const topUp = (diamonds: number, bonus = 0) => {
    if (socket) {
      addChips(socket, diamonds + bonus);
    }
    onClose();
  };

  return (
    <Portal>
      <div className={ui.overlay}>
        <div className="recharge-modal">
          <button
            onClick={onClose}
            aria-label="关闭"
            className="recharge-close"
          >
            ×
          </button>
          <h1>💎 充值</h1>
          <p className="recharge-sub">获取钻石，解锁更多精彩内容</p>

          <div className="recharge-cards">
            {PACKS.map((pack) => (
              <div
                key={pack.diamonds}
                className={`recharge-card${
                  pack.hot ? " recharge-card--hot" : ""
                }${pack.legend ? " recharge-card--legend" : ""}`}
              >
                {pack.tag && <div className="recharge-tag">{pack.tag}</div>}
                <img
                  src={`/assets/recharge/diamond/${pack.img}`}
                  alt=""
                  aria-hidden
                />
                <h2>{pack.diamonds} 💎</h2>
                {pack.bonus ? (
                  <div className="recharge-bonus">+{pack.bonus} BONUS</div>
                ) : null}
                <p>{pack.desc}</p>
                <button onClick={() => topUp(pack.diamonds, pack.bonus ?? 0)}>
                  {pack.price}
                </button>
              </div>
            ))}
          </div>

          <div className="recharge-footer">
            {TRUST.map((item) => (
              <div key={item.title}>
                <div>
                  {item.icon} {item.title}
                </div>
                <small>{item.sub}</small>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Portal>
  );
}
