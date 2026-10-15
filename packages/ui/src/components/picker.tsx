/**
 * Generic <Picker> compound.
 *
 * Wraps a `@base-ui/react/menu` `DropdownMenu` with picker-friendly defaults:
 *   - trigger button: chrome is fixed (icon-on-the-left, selected label,
 *     chevron); the consumer supplies only the icon component, label text,
 *     aria-label, and an optional width className.
 *   - item row: dot + flexible label slot + conditional check icon.
 *   - heading: a section label for the dropdown content (e.g. "Agent",
 *     "Persona", "Model").
 *   - default-item: a special first row whose id="" maps to "use the server
 *     default"; the parent interprets an empty-string id as "clear my
 *     selection".
 *
 * Namespaced: `<Picker.Trigger>`, `<Picker.Content>`, `<Picker.Heading>`,
 * `<Picker.Item>`, `<Picker.DefaultItem>`. Flat exports of each subpart
 * are kept for backward compat (same convention as Card / Bubble / Empty /
 * Message / Marker / Attachment / InputGroup / MessageScroller after the
 * `9e15cbc` wrap).
 */

import { Button } from "@manobu/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@manobu/ui/components/dropdown-menu";
import { cn } from "@manobu/ui/lib/utils";
import { CheckIcon, ChevronsUpDownIcon, type LucideIcon } from "lucide-react";
import type * as React from "react";
import { useCallback } from "react";

// Shared trigger chrome — pinned here so the lib owns the picker look; if a
// future route wants tighter spacing or different borders, it should be a
// primitive-level Tailwind variable change, not free-form classNames on
// every consumer.
const pickerTriggerClassName =
  "flex h-7 items-center gap-1.5 rounded-none border border-border bg-background px-2 text-xs hover:bg-muted hover:text-foreground";

export interface PickerProps {
  children: React.ReactNode;
}

export interface PickerTriggerProps {
  /** Accessible label for the trigger button (rendered on the inner Button). */
  "aria-label": string;
  /** Label text — the currently selected value, or a fallback like "Default". */
  children: React.ReactNode;
  /** Optional extra classes for the trigger's outer wrapper. */
  className?: string;
  /**
   * lucide-react icon component for the inline-start slot (e.g.
   * `BotIcon`, `CpuIcon`, `GraduationCapIcon`). Anything matching
   * `LucideIcon` — the canonical lucide type — works; receives
   * `data-icon="inline-start"` automatically through the consumer's
   * JSX expression.
   */
  icon: LucideIcon;
  /**
   * Tailwind max-width class for the *inner* rendered Button (e.g.
   * "max-w-44"). The button is the host element that gets the visible
   * label; the outer wrapper keeps the chrome (height, padding) fixed.
   */
  maxWidthClassName?: string;
}

export interface PickerContentProps {
  /** Dropdown alignment; defaults to "end" to match the chat header layout. */
  align?: "start" | "center" | "end";
  children: React.ReactNode;
  className?: string;
}

export interface PickerHeadingProps {
  children: React.ReactNode;
}

export interface PickerItemProps {
  children: React.ReactNode;
  disabled?: boolean;
  /**
   * Tailwind class (e.g. "bg-primary", "bg-muted-foreground/40") for the
   * leading status-dot span. The dot is purely decorative; selection is
   * conveyed through `selected` (which adds the check icon). Kept as a
   * className so the consumer can encode "installed but not selected",
   * "selected", "not installed", etc.
   */
  dotClassName: string;
  /** Item id; passed to `onSelect`. Pass "" to represent "no selection" / "Default". */
  id: string;
  onSelect: (id: string) => void;
  selected: boolean;
}

export interface PickerDefaultItemProps {
  /** Visible label, e.g. "Default" or "Agent default". */
  label: string;
  /** Called with id="" when the row is clicked. */
  onSelect: (id: string) => void;
  /** True iff the parent has no actual selection. */
  selected: boolean;
}

/**
 * Top-level <Picker>. Composes <DropdownMenu> around its children; the
 * children are expected to be `<Picker.Trigger>` and `<Picker.Content>`
 * (in any order — Radix doesn't care which sibling comes first).
 */
function Picker({ children }: PickerProps) {
  return <DropdownMenu>{children}</DropdownMenu>;
}

/**
 * Trigger button — fixed chrome (icon on the left, label in the middle,
 * chevron on the right) plus the consumer's icon/label/width.
 *
 * The `<Button>` is the host element via the `render` polymorphic prop;
 * the outer `DropdownMenuTrigger` keeps the picker-class look-and-feel.
 */
function PickerTrigger({
  "aria-label": ariaLabel,
  children,
  className,
  icon: Icon,
  maxWidthClassName,
}: PickerTriggerProps) {
  return (
    <DropdownMenuTrigger
      className={cn(pickerTriggerClassName, className)}
      render={
        <Button
          aria-label={ariaLabel}
          className={maxWidthClassName}
          size="sm"
          type="button"
          variant="outline"
        />
      }
    >
      <Icon data-icon="inline-start" />
      <span className="truncate">{children}</span>
      <ChevronsUpDownIcon className="opacity-60" />
    </DropdownMenuTrigger>
  );
}

/**
 * Dropdown content with align + width. Children are wrapped in
 * `<DropdownMenuGroup>` because Base UI (unlike the old Radix version
 * this file was written against) requires `Menu.GroupLabel` to sit
 * inside a `Menu.Group`; without it, opening any picker throws
 * "MenuGroupContext is missing" into the error boundary.
 */
function PickerContent({
  align = "end",
  children,
  className,
}: PickerContentProps) {
  return (
    <DropdownMenuContent align={align} className={className}>
      <DropdownMenuGroup>{children}</DropdownMenuGroup>
    </DropdownMenuContent>
  );
}

/** Section heading (rendered as `<DropdownMenuLabel>`, which sets `<MenuPrimitive.GroupLabel>`). */
function PickerHeading({ children }: PickerHeadingProps) {
  return <DropdownMenuLabel>{children}</DropdownMenuLabel>;
}

/**
 * Row item: dot + (label slot) + optional check-on-selected. The
 * `<Picker.Item>` resolution is mechanical — it just plumbs the id
 * into `onSelect`. The consumer styles the dot and decides the label.
 */
function PickerItem({
  children,
  dotClassName,
  id,
  onSelect,
  selected,
  disabled,
}: PickerItemProps) {
  // Stable click handler — captures `id` so the parent gets the picked item
  // id from the event without needing to expose a `data-*` attribute.
  const handleClick = useCallback(() => onSelect(id), [id, onSelect]);
  return (
    <DropdownMenuItem disabled={disabled} onClick={handleClick}>
      <span className={cn("size-1.5 shrink-0 rounded-full", dotClassName)} />
      <span className="min-w-0 flex-1">{children}</span>
      {selected ? <CheckIcon className="size-3.5 shrink-0" /> : null}
    </DropdownMenuItem>
  );
}

/**
 * Special "first row" for pickers with a server-default fallback.
 * Id="" + onSelect"")" maps to "use the server default" in the parent.
 * Provides its own dotClassName based on `selected` so the consumer
 * doesn't have to derive it.
 */
function PickerDefaultItem({
  label,
  onSelect,
  selected,
}: PickerDefaultItemProps) {
  // Forward an empty-string id (the convention for "use the server default")
  // as a stable click handler so PickerItem doesn't have to re-bind.
  const handleSelect = useCallback(() => onSelect(""), [onSelect]);
  return (
    <PickerItem
      dotClassName={selected ? "bg-primary" : "bg-muted-foreground/40"}
      id=""
      onSelect={handleSelect}
      selected={selected}
    >
      <span className="truncate">{label}</span>
    </PickerItem>
  );
}

const PickerCompound = Object.assign(Picker, {
  Content: PickerContent,
  DefaultItem: PickerDefaultItem,
  Heading: PickerHeading,
  Item: PickerItem,
  Trigger: PickerTrigger,
});

export {
  PickerCompound as Picker,
  PickerContent,
  PickerDefaultItem,
  PickerHeading,
  PickerItem,
  PickerTrigger,
};
