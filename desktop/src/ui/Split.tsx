import { type ReactNode, useEffect, useState } from "react";
import {
  createResizableController,
  Resizable,
  ResizableHandle,
  ResizablePanel,
} from "@ui-sdk/react/resizable";

/**
 * A pane beside the rest, as wide as it was last made: its edge is a separator that a pointer drags and the
 * arrow keys move, a double click sets it back to `width`, and the width is kept under `pine.<id>.width`.
 * Without a `pane`, the rest takes the whole row.
 */
export function Split({
  id,
  label,
  side,
  pane,
  width,
  min,
  max,
  restMin,
  className,
  children,
}: {
  id: string;
  label: string;
  side: "start" | "end";
  pane: ReactNode;
  width: number;
  min: number;
  max: number;
  restMin: number;
  className?: string;
  children: ReactNode;
}) {
  const [controller] = useState(createResizableController);
  const key = `pine.${id}.width`;
  const save = () => {
    const el = document.getElementById(id);
    if (el) localStorage.setItem(key, String(el.getBoundingClientRect().width));
  };
  // The group keeps sizes in percent, so a wider or narrower row would scale the pane: put it back to the
  // width it was last made, in pixels, whenever the row resizes.
  useEffect(() => {
    const row = pane ? document.getElementById(id)?.parentElement : undefined;
    if (!row) return;
    let last = row.getBoundingClientRect().width;
    const observer = new ResizeObserver(() => {
      const now = row.getBoundingClientRect().width;
      if (now === last) return;
      last = now;
      // After the group measures the new row, on the next frame.
      requestAnimationFrame(() =>
        controller.resize(
          id,
          `${Number(localStorage.getItem(key)) || width}px`,
        ),
      );
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, [controller, id, key, width, pane != null]);
  const parts = [
    <ResizablePanel
      key="rest"
      id={`${id}-rest`}
      className="split-pane"
      minSize={`${restMin}px`}
    >
      {children}
    </ResizablePanel>,
  ];
  if (pane) {
    const edge = (
      <ResizableHandle
        key="edge"
        aria-label={label}
        title={`Drag to make the ${label.replace(/^Resize /, "")} wider or narrower`}
        className={`splitter${side === "start" ? " side" : ""}`}
        onDoubleClick={() => {
          controller.resize(id, `${width}px`);
          save();
        }}
      />
    );
    const own = (
      <ResizablePanel
        key="pane"
        id={id}
        className="split-pane"
        defaultSize={`${Number(localStorage.getItem(key)) || width}px`}
        minSize={`${min}px`}
        maxSize={`${max}px`}
      >
        {pane}
      </ResizablePanel>
    );
    if (side === "start") parts.unshift(own, edge);
    else parts.push(edge, own);
  }
  return (
    <Resizable
      className={className}
      controller={controller}
      onLayoutCommit={save}
    >
      {parts}
    </Resizable>
  );
}
