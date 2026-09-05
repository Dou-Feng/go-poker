import CommunityCards from "./CommunityCards";
import Pot from "./Pot";

export default function Felt() {
  return (
    // Rail first: a rounded-full band of wood material whose thickness
    // (padding) is constant, replacing the old border-8 — same oval
    // footprint, same responsive sizing, only the surface changed. The felt
    // inside is the green material; both tile at a fixed density instead of
    // stretching (see .felt-material / .rail-material in styles/index.css).
    <div className="rail-material -z-10 h-full w-full rounded-full p-2 sm:p-3">
      <div className="felt-material flex h-full w-full flex-col items-center justify-center rounded-full">
        <Pot />
        <div className="mt-4 mb-12 flex w-full items-center justify-center">
          <CommunityCards />
        </div>
      </div>
    </div>
  );
}
