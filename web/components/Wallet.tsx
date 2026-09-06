import { useState } from "react";
import WalletButton from "./WalletButton";
import Recharge from "./Recharge";

// The wallet chip count in the top-right. Tapping it opens the recharge
// (free chips) dialog.
export default function Wallet() {
  const [showRecharge, setShowRecharge] = useState(false);

  return (
    <div className="flex flex-col items-end">
      <WalletButton onOpen={() => setShowRecharge(true)} />
      {showRecharge && <Recharge onClose={() => setShowRecharge(false)} />}
    </div>
  );
}
