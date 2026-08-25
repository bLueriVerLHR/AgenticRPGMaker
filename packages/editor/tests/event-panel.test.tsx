/**
 * Event panel component test (P2, ADR-006 §feature 3) — @testing-library/react
 * over the command editor: adding a command, editing its arguments, and
 * observing that the core model (via the store) reflects the change.
 */
import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { EditorStore, createInitialSnapshot } from "../src/state/editor-store.js";
import { createDefaultProject } from "../src/model/project.js";
import { EventPanel } from "../src/ui/EventPanel.js";
import { addEventCommand } from "../src/state/commands.js";
import { createEvent } from "../src/model/event-model.js";

function makeStoreWithEvent(): EditorStore {
  const created = createDefaultProject("Component Test");
  const store = new EditorStore(
    createInitialSnapshot({
      projectId: "proj_component",
      projectName: created.name,
      project: created.project,
      maps: created.maps,
      tilesets: created.tilesets,
    }),
  );
  const mapId = store.getSnapshot().currentMapId;
  const event = createEvent({ id: "evt_comp", name: "Guard", x: 2, y: 2 });
  store.execute(addEventCommand(mapId, event));
  return store;
}

describe("EventPanel command editor", () => {
  it("adds a showText command and updates its text via the store", () => {
    const store = makeStoreWithEvent();
    const { unmount } = render(<EventPanel store={store} />);

    // The event should be visible.
    expect(screen.getByTestId("event-name")).toBeTruthy();

    // No commands yet.
    expect(screen.getByTestId("commands-empty")).toBeTruthy();

    // Add a Show Text command.
    fireEvent.click(screen.getByTestId("cmd-add-showText"));
    const map = store.getSnapshot().maps[0]!;
    expect(map.events[0]!.pages[0]!.commands).toEqual([{ cmd: "showText", args: [""] }]);

    // The command summary appears.
    expect(screen.getByTestId("command-summary-0").textContent).toContain("Show Text");

    // Edit its arguments: open the editor, change the text.
    fireEvent.click(screen.getByTestId("command-edit-0"));
    const textInput = screen.getByTestId("command-arg-text") as HTMLInputElement;
    fireEvent.change(textInput, { target: { value: "Hello, traveler!" } });

    const updated = store.getSnapshot().maps[0]!;
    expect(updated.events[0]!.pages[0]!.commands[0]!.args).toEqual(["Hello, traveler!"]);

    unmount();
  });

  it("removes a command from the page", () => {
    const store = makeStoreWithEvent();
    const { unmount } = render(<EventPanel store={store} />);
    fireEvent.click(screen.getByTestId("cmd-add-showText"));
    fireEvent.click(screen.getByTestId("cmd-add-playSound"));
    expect(store.getSnapshot().maps[0]!.events[0]!.pages[0]!.commands).toHaveLength(2);

    fireEvent.click(screen.getByTestId("command-remove-0"));
    const commands = store.getSnapshot().maps[0]!.events[0]!.pages[0]!.commands;
    expect(commands).toHaveLength(1);
    expect(commands[0]!.cmd).toBe("playSound");

    unmount();
  });

  it("sets a page condition to a switch", () => {
    const store = makeStoreWithEvent();
    const { unmount } = render(<EventPanel store={store} />);

    const modeSelect = screen.getByTestId("page-condition-mode");
    fireEvent.change(modeSelect, { target: { value: "switch" } });

    const condition = store.getSnapshot().maps[0]!.events[0]!.pages[0]!.condition;
    expect(condition).not.toBeNull();
    expect(condition!.value).toBe(true);

    unmount();
  });

  it("adds and removes pages", () => {
    const store = makeStoreWithEvent();
    const { unmount } = render(<EventPanel store={store} />);

    fireEvent.click(screen.getByTestId("page-add"));
    expect(store.getSnapshot().maps[0]!.events[0]!.pages).toHaveLength(2);

    // Page remove button is only shown when > 1 page.
    const pageCard = screen.getByTestId("event-page-1");
    fireEvent.click(within(pageCard).getByTestId("page-remove-1"));
    expect(store.getSnapshot().maps[0]!.events[0]!.pages).toHaveLength(1);

    unmount();
  });

  it("edits the event name and position is displayed", () => {
    const store = makeStoreWithEvent();
    const { unmount } = render(<EventPanel store={store} />);

    expect(screen.getByTestId("event-position").textContent).toContain("2, 2");

    const nameInput = screen.getByTestId("event-name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "Innkeeper" } });
    fireEvent.blur(nameInput);
    expect(store.getSnapshot().maps[0]!.events[0]!.name).toBe("Innkeeper");

    unmount();
  });

  it("shows an empty state when no event is selected", () => {
    const created = createDefaultProject("Component Test");
    const store = new EditorStore(
      createInitialSnapshot({
        projectId: "proj_component",
        projectName: created.name,
        project: created.project,
        maps: created.maps,
        tilesets: created.tilesets,
      }),
    );
    const { unmount } = render(<EventPanel store={store} />);
    expect(screen.getByTestId("event-none")).toBeTruthy();
    unmount();
  });
});
