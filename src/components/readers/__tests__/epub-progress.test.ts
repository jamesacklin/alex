import {
  doesViewportMatchSaved,
  getPendingScrollRestore,
} from "../epub-progress";

describe("epub progress restore guards", () => {
  it("returns pending restore only when fraction and viewport are valid", () => {
    expect(
      getPendingScrollRestore({
        epubLocation: "epubcfi(/6/4!/4/2/2/4:0)",
        scrollFraction: 0.42,
        viewportWidth: 1280,
        viewportHeight: 720,
      }),
    ).toEqual({
      fraction: 0.42,
      viewportWidth: 1280,
      viewportHeight: 720,
    });

    expect(
      getPendingScrollRestore({
        scrollFraction: 0.42,
      }),
    ).toBeNull();

    expect(
      getPendingScrollRestore({
        scrollFraction: 1.5,
        viewportWidth: 1280,
        viewportHeight: 720,
      }),
    ).toBeNull();
  });

  it("matches viewport within tolerance", () => {
    const pending = {
      fraction: 0.42,
      viewportWidth: 1280,
      viewportHeight: 720,
    };

    expect(doesViewportMatchSaved(pending, 1280, 720)).toBe(true);
    expect(doesViewportMatchSaved(pending, 1281, 719)).toBe(true);
    expect(doesViewportMatchSaved(pending, 1283, 720)).toBe(false);
  });
});
