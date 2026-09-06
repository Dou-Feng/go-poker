import React, { useState } from "react";
import PokerRaisePanel from "./components/PokerRaisePanel/PokerRaisePanel";

export default function PokerTableExample() {
  const [raiseOpen, setRaiseOpen] = useState(false);

  return (
    <div>
      {raiseOpen && (
        <PokerRaisePanel
          pot={20}
          minRaise={20}
          maxRaise={400}
          initialAmount={40}
          onClose={() => setRaiseOpen(false)}
          onConfirm={(amount) => {
            console.log("RAISE:", amount);
            setRaiseOpen(false);
          }}
        />
      )}

      <button onClick={() => setRaiseOpen(true)}>
        加注
      </button>
    </div>
  );
}
