"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  resolveDropdownPlacement,
  type DropdownPlacement,
} from "@/components/ui/dropdown-placement";

export type CreatableOption = {
  value: string;
  label: string;
  detail?: string;
};

export default function CreatableCombobox({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder,
  allowCreate = true,
}: {
  value: string;
  options: readonly CreatableOption[];
  onChange: (value: string, option?: CreatableOption) => void;
  ariaLabel: string;
  placeholder?: string;
  allowCreate?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [placement, setPlacement] = useState<DropdownPlacement>({
    vertical: "bottom",
    horizontal: "left",
    maxHeight: 256,
  });
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const normalizedValue = value.trim().toLocaleLowerCase("en-IN");
  const filtered = useMemo(() => {
    if (!normalizedValue) return options.slice(0, 8);
    return options
      .filter((option) =>
        `${option.label} ${option.detail ?? ""}`
          .toLocaleLowerCase("en-IN")
          .includes(normalizedValue),
      )
      .slice(0, 8);
  }, [normalizedValue, options]);
  const exactMatch = options.some(
    (option) => option.label.trim().toLocaleLowerCase("en-IN") === normalizedValue,
  );
  const canCreate = allowCreate && value.trim().length > 1 && !exactMatch;
  const rowCount = filtered.length + (canCreate ? 1 : 0);

  const updatePlacement = useCallback(() => {
    const trigger = rootRef.current?.getBoundingClientRect();
    if (!trigger) return;
    const requestedHeight = listRef.current?.scrollHeight ?? rowCount * 44 + 8;
    setPlacement(resolveDropdownPlacement(
      trigger,
      { width: window.innerWidth, height: window.innerHeight },
      requestedHeight,
    ));
  }, [rowCount]);

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
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  function choose(option: CreatableOption) {
    onChange(option.label, option);
    setOpen(false);
    setActiveIndex(0);
  }

  return (
    <div
      className={`creatable-combobox opens-${placement.vertical} aligns-${placement.horizontal}`}
      ref={rootRef}
      style={{ "--dropdown-max-height": `${placement.maxHeight}px` } as CSSProperties}
    >
      <input
        ref={inputRef}
        value={value}
        role="combobox"
        aria-label={ariaLabel}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-expanded={open}
        autoComplete="off"
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActiveIndex((current) => Math.min(current + 1, Math.max(0, rowCount - 1)));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((current) => Math.max(0, current - 1));
          } else if (event.key === "Enter" && open && rowCount > 0) {
            event.preventDefault();
            if (activeIndex < filtered.length) choose(filtered[activeIndex]);
            else {
              onChange(value.trim());
              setOpen(false);
            }
          } else if (event.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      <button
        type="button"
        className="creatable-combobox__toggle"
        aria-label={`Open ${ariaLabel} options`}
        aria-expanded={open}
        onClick={() => {
          inputRef.current?.focus();
          setOpen((current) => !current);
        }}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 7.5 5 5 5-5" /></svg>
      </button>
      {open && rowCount > 0 && (
        <div ref={listRef} className="creatable-combobox__list" id={listId} role="listbox">
          {filtered.map((option, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={index === activeIndex ? "is-active" : ""}
              key={`${option.value}:${option.label}`}
              onPointerMove={() => setActiveIndex(index)}
              onClick={() => choose(option)}
            >
              <span>{option.label}</span>
              {option.detail && <small>{option.detail}</small>}
            </button>
          ))}
          {canCreate && (
            <button
              type="button"
              role="option"
              aria-selected={activeIndex === filtered.length}
              className={`is-create${activeIndex === filtered.length ? " is-active" : ""}`}
              onPointerMove={() => setActiveIndex(filtered.length)}
              onClick={() => {
                onChange(value.trim());
                setOpen(false);
              }}
            >
              <span>＋ Create “{value.trim()}”</span>
              <small>Available for future products</small>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
