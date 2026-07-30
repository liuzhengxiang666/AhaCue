import { describe, expect, it } from "vitest";
import {
  boundsForOverlay,
  clampDraggedBounds,
  collapsedOverlayShape,
  normalizeOverlayAnchor,
  snapOverlayAnchor
} from "./overlay-geometry";

const content = { x: 100, y: 80, width: 1_920, height: 1_080 };

describe("overlay geometry", () => {
  it("uses comfortable bubble and drawer widths", () => {
    const bubble = boundsForOverlay(
      content,
      { side: "right", yRatio: 0.8 },
      "bubble",
      420
    );
    const drawer = boundsForOverlay(
      content,
      { side: "left", yRatio: 0.5 },
      "drawer",
      420
    );

    expect(bubble.width).toBe(440);
    expect(bubble.x + bubble.width).toBe(content.x + content.width - 16);
    expect(drawer.width).toBe(520);
    expect(drawer.x).toBe(content.x + 16);
  });

  it("snaps to the nearest edge and preserves vertical position", () => {
    const left = snapOverlayAnchor(content, {
      x: 300,
      y: 300,
      width: 440,
      height: 420
    });
    const right = snapOverlayAnchor(content, {
      x: 1_500,
      y: 500,
      width: 440,
      height: 420
    });

    expect(left.side).toBe("left");
    expect(right.side).toBe("right");
    expect(left.yRatio).toBeGreaterThan(0);
    expect(left.yRatio).toBeLessThan(1);
  });

  it("never allows dragged windows outside the content area", () => {
    expect(
      clampDraggedBounds(content, {
        x: -500,
        y: 5_000,
        width: 520,
        height: 1_048
      })
    ).toEqual({
      x: 116,
      y: 96,
      width: 520,
      height: 1_048
    });
  });

  it("repairs invalid persisted anchors", () => {
    expect(
      normalizeOverlayAnchor({ side: "unknown", yRatio: Number.NaN })
    ).toEqual({ side: "right", yRatio: 0.82 });
  });

  it("clips the collapsed native window to a circle", () => {
    const shape = collapsedOverlayShape(60);
    const centerRow = shape.find((rectangle) => rectangle.y === 30);

    expect(shape.length).toBeGreaterThan(50);
    expect(centerRow?.width).toBeGreaterThan(56);
    expect(
      shape.every(
        (rectangle) =>
          rectangle.x >= 0 &&
          rectangle.y >= 0 &&
          rectangle.x + rectangle.width <= 60 &&
          rectangle.y + rectangle.height <= 60
      )
    ).toBe(true);
    expect(
      shape.some(
        (rectangle) =>
          rectangle.x === 0 &&
          rectangle.y === 0 &&
          rectangle.width > 0 &&
          rectangle.height > 0
      )
    ).toBe(false);
  });
});
