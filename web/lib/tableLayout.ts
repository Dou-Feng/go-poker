// Shared geometry for seats, the pot and flying chips. Coordinates are
// percentages of the measured scene, including its reserved seat margins.
export type TablePoint = { x: number; y: number };
export type TableLayout = ReturnType<typeof createTableLayout>;

export function createTableLayout(
  width: number,
  height: number,
  large: boolean
) {
  const portrait = height >= width * 0.85;
  const baseWidth = large ? 224 : 128;
  const baseHeight = large ? 148 : 100;
  const seatWidth = Math.min(
    width * (portrait ? 0.3 : 0.19),
    height * (portrait ? 0.24 : height < 300 ? 0.38 : 0.32),
    180
  );
  const scale = seatWidth / baseWidth;
  // Include the 1.1x all-in pop, the bet pill above and ready/show below.
  const insetX = ((seatWidth * 0.56 + 6) / width) * 100;
  const top = (((baseHeight * 0.55 + 26) * scale) / height) * 100;
  const bottom = 100 - (((baseHeight * 0.55 + 48) * scale) / height) * 100;
  const centerY = (top + bottom) / 2;
  const radiusY = (bottom - top) / 2;
  const compact = !portrait && height < 300;
  const pot = {
    x: compact ? 72 : 50,
    y: compact ? centerY : centerY - (portrait ? 24 : 18),
  };
  const board = {
    x: compact ? 45 : 50,
    y: centerY + (portrait ? -11 : compact ? 0 : 7),
  };
  return {
    width,
    height,
    large,
    portrait,
    scale,
    insetX,
    centerY,
    radiusY,
    pot,
    board,
  };
}

export function tableSeatPoint(
  layout: TableLayout,
  index: number,
  total: number
): TablePoint {
  const angle = Math.PI / 2 + (index * 2 * Math.PI) / total;
  const cosine = Math.cos(angle);
  // A slightly squarer orbit moves diagonal seats away from the end seats
  // on tall tables. Preserve the outer bounds and clockwise seat order.
  const horizontal = layout.portrait
    ? Math.sign(cosine) * Math.sqrt(Math.abs(cosine))
    : cosine;
  return {
    x: 50 + (50 - layout.insetX) * (Math.abs(cosine) < 1e-10 ? 0 : horizontal),
    y: layout.centerY + layout.radiusY * Math.sin(angle),
  };
}
