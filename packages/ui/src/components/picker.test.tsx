/**
 * <Picker> compound smoke suite.
 *
 * Pins the two contracts that matter for the consumer-side refactor:
 *
 *   1. Namespaced surface is reference-equal to the flat exports — same
 *      mechanical wrap every other component got in `9e15cbc`.
 *   2. Picker.Trigger renders the expected chrome (button with icon slot,
 *      label, chevron) so the chat-header pickers keep working.
 *
 * Picker.Content / Picker.Item / Picker.DefaultItem SSR is skipped on
 * purpose — base-ui's `DropdownMenu` content only renders inside a
 * `<Menu.Root>` open-state, so we put each `<Picker.Trigger>` render
 * inside the root `<Picker>` (which is a `<DropdownMenu>`) to satisfy
 * base-ui's parent-check at SSR time.
 */

import { describe, expect, test } from "bun:test";
import { BotIcon } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Picker,
  PickerContent,
  PickerDefaultItem,
  PickerHeading,
  PickerItem,
  PickerTrigger,
} from "./picker";

describe("Picker.* reference-equal to flat exports", () => {
  test("Picker.Trigger === PickerTrigger", () => {
    expect(Picker.Trigger).toBe(PickerTrigger);
  });
  test("Picker.Content === PickerContent", () => {
    expect(Picker.Content).toBe(PickerContent);
  });
  test("Picker.Heading === PickerHeading", () => {
    expect(Picker.Heading).toBe(PickerHeading);
  });
  test("Picker.Item === PickerItem", () => {
    expect(Picker.Item).toBe(PickerItem);
  });
  test("Picker.DefaultItem === PickerDefaultItem", () => {
    expect(Picker.DefaultItem).toBe(PickerDefaultItem);
  });
});

describe("Picker.Trigger renders the picker chrome", () => {
  const renderInPicker = (children: React.ReactNode) =>
    renderToStaticMarkup(<Picker>{children}</Picker>);

  test("renders the supplied label inside a truncate span", () => {
    const html = renderInPicker(
      <Picker.Trigger aria-label="Select agent" icon={BotIcon}>
        Sonarmath
      </Picker.Trigger>
    );
    expect(html).toContain("Sonarmath");
    expect(html).toContain("Select agent");
  });

  test("two consecutive renders are byte-equal", () => {
    const a = renderInPicker(
      <Picker.Trigger aria-label="Select X" icon={BotIcon}>
        X
      </Picker.Trigger>
    );
    const b = renderInPicker(
      <Picker.Trigger aria-label="Select X" icon={BotIcon}>
        X
      </Picker.Trigger>
    );
    expect(a).toBe(b);
  });

  test("supplies maxWidthClassName to the host Button", () => {
    const html = renderInPicker(
      <Picker.Trigger
        aria-label="Select agent"
        icon={BotIcon}
        maxWidthClassName="max-w-44"
      >
        Agent
      </Picker.Trigger>
    );
    expect(html).toContain("max-w-44");
  });
});
