import { useEffect, useRef, useState } from "react";
import { createTableLayout } from "../lib/tableLayout";

export default function useTableLayout() {
  const ref = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState(() =>
    createTableLayout(390, 560, false)
  );
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const breakpoint = window.matchMedia("(min-width: 640px)");
    const measure = () => {
      const { width, height } = element.getBoundingClientRect();
      if (width > 0 && height > 0)
        setLayout(createTableLayout(width, height, breakpoint.matches));
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    breakpoint.addEventListener("change", measure);
    measure();
    return () => {
      observer.disconnect();
      breakpoint.removeEventListener("change", measure);
    };
  }, []);
  return { ref, layout };
}
