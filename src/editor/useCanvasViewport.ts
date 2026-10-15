import { useCallback, useEffect, useState, type RefObject, type SetStateAction } from 'react';

const clampZoom = (value: number) => Math.max(.25, Math.min(1.5, value));

function fittedZoom(stage: HTMLDivElement, documentWidth: number): number | null {
  if (stage.clientWidth <= 0) return null;
  const style = getComputedStyle(stage);
  const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  // Leave room for the selected artboard's outline as well as the stage padding.
  return Math.max(.25, Math.min(1, (stage.clientWidth - padding - 4) / documentWidth));
}

/** Fit follows the available canvas; a deliberate zoom stays under the user's control. */
export function useCanvasViewport(stage: RefObject<HTMLDivElement | null>, documentWidth: number, active: boolean) {
  const [zoom, setZoom] = useState(.75);
  const [autoFit, setAutoFit] = useState(true);

  useEffect(() => { setAutoFit(true); }, [documentWidth]);

  useEffect(() => {
    const element = stage.current;
    if (!active || !autoFit || !element) return;
    const fit = () => {
      const value = fittedZoom(element, documentWidth);
      if (value !== null) setZoom(value);
    };
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    fit();
    return () => observer.disconnect();
  }, [stage, documentWidth, active, autoFit]);

  const changeZoom = useCallback((value: SetStateAction<number>) => {
    setAutoFit(false);
    setZoom(previous => clampZoom(typeof value === 'function' ? value(previous) : value));
  }, []);

  const fitCanvas = () => {
    setAutoFit(true);
    if (!stage.current) return;
    const value = fittedZoom(stage.current, documentWidth);
    if (value !== null) setZoom(value);
  };

  return { zoom, changeZoom, fitCanvas, autoFit };
}
