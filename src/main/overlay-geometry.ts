import type {
  OverlayAnchor,
  OverlayMode
} from "../shared/contracts";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const MARGIN = 16;
const COLLAPSED_SIZE = 60;
const BUBBLE_WIDTH = 440;
const DRAWER_WIDTH = 520;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function collapsedOverlayShape(size = COLLAPSED_SIZE): Rect[] {
  const safeSize = Math.max(1, Math.floor(size));
  const center = safeSize / 2;
  const radius = Math.max(0.5, center - 1);
  const rows: Rect[] = [];

  for (let y = 0; y < safeSize; y += 1) {
    const distanceY = y + 0.5 - center;
    const halfWidth = Math.sqrt(
      Math.max(0, radius * radius - distanceY * distanceY)
    );
    const x = Math.max(0, Math.floor(center - halfWidth));
    const right = Math.min(safeSize, Math.ceil(center + halfWidth));
    if (right > x) {
      rows.push({ x, y, width: right - x, height: 1 });
    }
  }

  return rows;
}

export function normalizeOverlayAnchor(value: unknown): OverlayAnchor {
  if (!value || typeof value !== "object") {
    return { side: "right", yRatio: 0.82 };
  }
  const input = value as Partial<OverlayAnchor>;
  return {
    side: input.side === "left" ? "left" : "right",
    yRatio: clamp(
      typeof input.yRatio === "number" && Number.isFinite(input.yRatio)
        ? input.yRatio
        : 0.82,
      0,
      1
    )
  };
}

export function overlaySize(
  content: Rect,
  mode: OverlayMode,
  contentHeight: number
): Pick<Rect, "width" | "height"> {
  if (mode === "collapsed") {
    return { width: COLLAPSED_SIZE, height: COLLAPSED_SIZE };
  }
  const maximumWidth = Math.max(280, content.width - MARGIN * 2);
  const maximumHeight = Math.max(220, content.height - MARGIN * 2);
  if (mode === "drawer") {
    return {
      width: Math.min(DRAWER_WIDTH, maximumWidth),
      height: maximumHeight
    };
  }
  const minimumHeight = mode === "settings" ? 600 : 240;
  return {
    width: Math.min(BUBBLE_WIDTH, maximumWidth),
    height: Math.min(
      maximumHeight,
      Math.max(minimumHeight, Math.ceil(contentHeight))
    )
  };
}

export function boundsForOverlay(
  content: Rect,
  anchorInput: OverlayAnchor,
  mode: OverlayMode,
  contentHeight: number
): Rect {
  const anchor = normalizeOverlayAnchor(anchorInput);
  const size = overlaySize(content, mode, contentHeight);
  const x =
    anchor.side === "left"
      ? content.x + MARGIN
      : content.x + content.width - size.width - MARGIN;
  const desiredCenterY = content.y + content.height * anchor.yRatio;
  const minimumY = content.y + MARGIN;
  const maximumY = content.y + content.height - size.height - MARGIN;
  return {
    x,
    y: clamp(
      Math.round(desiredCenterY - size.height / 2),
      minimumY,
      Math.max(minimumY, maximumY)
    ),
    ...size
  };
}

export function clampDraggedBounds(content: Rect, bounds: Rect): Rect {
  const minimumX = content.x + MARGIN;
  const maximumX = content.x + content.width - bounds.width - MARGIN;
  const minimumY = content.y + MARGIN;
  const maximumY = content.y + content.height - bounds.height - MARGIN;
  return {
    ...bounds,
    x: clamp(bounds.x, minimumX, Math.max(minimumX, maximumX)),
    y: clamp(bounds.y, minimumY, Math.max(minimumY, maximumY))
  };
}

export function snapOverlayAnchor(
  content: Rect,
  bounds: Rect
): OverlayAnchor {
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return {
    side: centerX < content.x + content.width / 2 ? "left" : "right",
    yRatio: clamp((centerY - content.y) / Math.max(1, content.height), 0, 1)
  };
}
