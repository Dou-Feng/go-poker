import CommunityCards from "./CommunityCards";
import Pot from "./Pot";
import { TableLayout } from "../lib/tableLayout";

type FeltContentsProps = { layout: TableLayout; onClick: () => void };

export function FeltContents({ layout, onClick }: FeltContentsProps) {
  const large = layout.large;
  const boardScale = Math.min(
    (layout.width * (layout.portrait ? 0.52 : 0.38)) / (large ? 356 : 216),
    (layout.height * 0.2) / (large ? 100 : 60),
    1.15
  );
  return (
    <>
      <div
        className="poker-table-pot"
        style={{ left: `${layout.pot.x}%`, top: `${layout.pot.y}%` }}
        onClick={onClick}
      >
        <Pot />
      </div>
      <div
        className="poker-table-board"
        style={{
          left: `${layout.board.x}%`,
          top: `${layout.board.y}%`,
          transform: `translate(-50%, -50%) scale(${boardScale})`,
        }}
        onClick={onClick}
      >
        <CommunityCards />
      </div>
      <div className="poker-table-brand" aria-hidden="true">
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
