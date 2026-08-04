"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  resolveDropdownPlacement,
  type DropdownPlacement,
} from "@/components/ui/dropdown-placement";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export default function CustomSelect({
  value,
  options,
  onChange,
  ariaLabel,
  disabled = false,
  required = false,
}: {
  value: string;
  options: readonly SelectOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [placement, setPlacement] = useState<DropdownPlacement>({
    vertical: "bottom",
    horizontal: "left",
    maxHeight: 256,
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listId = useId();
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const selected = options.find((option) => option.value === value);

  const updatePlacement = useCallback(() => {
    const trigger = rootRef.current?.getBoundingClientRect();
    if (!trigger) return;
    const requestedHeight = listRef.current?.scrollHeight ?? options.length * 44 + 8;
    setPlacement(resolveDropdownPlacement(
      trigger,
      { width: window.innerWidth, height: window.innerHeight },
      requestedHeight,
    ));
  }, [options.length]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePlacement();
    window.addEventListener("resize", updatePlacement);
    window.addEventListener("scroll", updatePlacement, true);
    return () => {
      window.removeEventListener("resize", updatePlacement);
      window.removeEventListener("scroll", updatePlacement, true);
    };
  }, [open, updatePlacement]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[selectedIndex]?.focus();
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open, selectedIndex]);

  function move(step: number) {
    if (!options.length) return;
    let next = activeIndex;
    do {
      next = (next + step + options.length) % options.length;
    } while (options[next]?.disabled && next !== activeIndex);
    setActiveIndex(next);
    optionRefs.current[next]?.focus();
  }

  function choose(option: SelectOption) {
    if (option.disabled) return;
    onChange(option.value);
    setOpen(false);
  }

  return (
    <div
      className={`custom-select opens-${placement.vertical} aligns-${placement.horizontal}${open ? " is-open" : ""}`}
      ref={rootRef}
      style={{ "--dropdown-max-height": `${placement.maxHeight}px` } as CSSProperties}
    >
      <button
        type="button"
        className="custom-select__trigger"
        role="combobox"
        aria-label={ariaLabel}
        aria-controls={listId}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-required={required}
        disabled={disabled}
        onClick={() => {
          setActiveIndex(selectedIndex);
          setOpen((current) => !current);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex(selectedIndex);
            setOpen(true);
          }
        }}
      >
        <span>{selected?.label ?? "Select"}</span>
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="m5 7.5 5 5 5-5" />
        </svg>
      </button>
      {open && (
        <div ref={listRef} className="custom-select__list" id={listId} role="listbox" aria-label={ariaLabel}>
          {options.map((option, index) => (
            <button
              type="button"
              role="option"
              aria-selected={option.value === value}
              className={option.value === value ? "is-selected" : ""}
              disabled={option.disabled}
              key={option.value}
              ref={(node) => { optionRefs.current[index] = node; }}
              onClick={() => choose(option)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  move(1);
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  move(-1);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setOpen(false);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  setActiveIndex(0);
                  optionRefs.current[0]?.focus();
                } else if (event.key === "End") {
                  event.preventDefault();
                  const last = options.length - 1;
                  setActiveIndex(last);
                  optionRefs.current[last]?.focus();
                }
              }}
            >
              <span aria-hidden="true">{option.value === value ? "✓" : ""}</span>
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
