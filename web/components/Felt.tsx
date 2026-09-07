import CommunityCards from "./CommunityCards";
import Pot from "./Pot";
import { TableLayout } from "../lib/tableLayout";

type FeltContentsProps = { layout: TableLayout; waiting?: boolean };

export function FeltContents({ layout, waiting = false }: FeltContentsProps) {
  const large = layout.large;
  const boardScale = Math.min(
    (layout.width * (layout.portrait ? 0.52 : 0.38)) / (large ? 356 : 216),
    (layout.height * 0.2) / (large ? 100 : 60),
    1.15
  );
  return (
    <>
      {!waiting && <div
        className="poker-table-pot"
        style={{ left: `${layout.pot.x}%`, top: `${layout.pot.y}%` }}
      >
        <Pot />
      </div>}
      {/* The community cards and the GoPoker brand travel together; on
          desktop the whole group is nudged up (styles/game.css). */}
      <div className="poker-table-board-group" aria-hidden="true">
        {!waiting && <div
          className="poker-table-board"
          style={{
            left: `${layout.board.x}%`,
            top: `${layout.board.y}%`,
            transform: `translate(-50%, -50%) scale(${boardScale})`,
          }}
        >
          <CommunityCards />
        </div>}
        <div className="poker-table-brand">
          <strong>GoPoker</strong>
          <svg
            className="poker-table-motto"
            viewBox="0 0 240 56"
            focusable="false"
          >
            <defs>
              <path id="poker-motto-arc" d="M 12 10 Q 120 66 228 10" />
            </defs>
            <text>
              <textPath
                href="#poker-motto-arc"
                startOffset="50%"
                textAnchor="middle"
              >
                GOOD CARD &amp; GOOD FRIEND
              </textPath>
            </text>
          </svg>
        </div>
      </div>
    </>
  );
}

export default function Felt() {
  return (
    <div className="rail-material">
      <div className="felt-material" />
    </div>
  );
}
