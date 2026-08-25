/**
 * Event panel (P2, ADR-006 §feature 3): edit a placed event's properties,
 * pages (conditions) and command lists. Commands come from the visual catalog
 * (COMMAND_CATALOG) and are saved as schema-valid `EventCommand` lines the
 * core interpreter runs verbatim in the preview and the shipped game.
 */
import type { EventCommand, EventPage, MapEvent } from "@agenticrpg/core";
import type { EditorStore } from "../state/editor-store.js";
import { currentMapOf } from "../state/editor-store.js";
import { useStoreSelector } from "../use-editor-store.js";
import { updateEventCommand, removeEventCommand } from "../state/commands.js";
import {
  addCommandToPage,
  moveCommandInPage,
  removeCommandFromPage,
  setPageCondition,
  updateCommandInPage,
} from "../model/map-ops.js";
import {
  COMMAND_CATALOG,
  commandSummary,
  createCommand,
  createPage,
  commandDefFor,
} from "../model/event-model.js";
import { useState } from "react";

export function EventPanel({ store }: { store: EditorStore }): React.JSX.Element {
  const snapshot = useStoreSelector(store, (s) => s);
  const map = currentMapOf(snapshot);
  const event = map.events.find((e) => e.id === snapshot.selectedEventId);

  if (event === undefined) {
    return (
      <div className="panel" data-testid="event-panel">
        <h3>Event</h3>
        <div className="empty" data-testid="event-none">
          No event selected. Switch to the Event tool and click a tile.
        </div>
      </div>
    );
  }

  const updateEvent = (next: MapEvent): void => {
    store.execute(updateEventCommand(map.id, event.id, next));
  };

  const updatePage = (index: number, page: EventPage): void => {
    const pages = event.pages.map((p, i) => (i === index ? page : p));
    updateEvent({ ...event, pages });
  };

  const addPage = (): void => {
    updateEvent({ ...event, pages: [...event.pages, createPage()] });
  };

  const removePage = (index: number): void => {
    if (event.pages.length <= 1) {
      return;
    }
    updateEvent({ ...event, pages: event.pages.filter((_, i) => i !== index) });
  };

  return (
    <div className="panel" data-testid="event-panel">
      <h3>Event</h3>
      <div className="row">
        <label>Name</label>
        <input
          type="text"
          defaultValue={event.name}
          data-testid="event-name"
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name !== "" && name !== event.name) {
              updateEvent({ ...event, name });
            }
          }}
        />
      </div>
      <div className="row">
        <label>Position</label>
        <span data-testid="event-position">
          ({event.x}, {event.y})
        </span>
      </div>
      <div className="row">
        <label>Sprite</label>
        <input
          type="text"
          defaultValue={event.sprite ?? ""}
          placeholder="(none)"
          data-testid="event-sprite"
          onBlur={(e) => {
            const value = e.target.value.trim();
            if (value !== (event.sprite ?? "")) {
              updateEvent({ ...event, sprite: value === "" ? undefined : value });
            }
          }}
        />
      </div>

      <h3>Pages</h3>
      {event.pages.map((page, index) => (
        <div className="page-card" key={index} data-testid={`event-page-${index}`}>
          <div className="row">
            <strong>Page {index + 1}</strong>
            <span className="spacer" style={{ flex: 1 }} />
            {event.pages.length > 1 && (
              <button
                type="button"
                className="icon-btn"
                data-testid={`page-remove-${index}`}
                onClick={() => removePage(index)}
                title="Remove page"
              >
                ✕
              </button>
            )}
          </div>
          <PageConditionEditor
            page={page}
            switches={Object.keys(map.switches)}
            onChange={(condition) => updatePage(index, setPageCondition(page, condition))}
          />
          <PageCommandEditor page={page} onChange={(next) => updatePage(index, next)} />
        </div>
      ))}
      <button type="button" className="btn" data-testid="page-add" onClick={addPage}>
        + Add Page
      </button>

      <div className="row" style={{ marginTop: "0.75rem" }}>
        <button
          type="button"
          className="btn danger"
          data-testid="event-remove"
          onClick={() => {
            store.execute(removeEventCommand(map.id, event.id));
          }}
        >
          Remove Event
        </button>
      </div>
    </div>
  );
}

function PageConditionEditor({
  page,
  switches,
  onChange,
}: {
  page: EventPage;
  switches: string[];
  onChange: (condition: EventPage["condition"]) => void;
}): React.JSX.Element {
  const mode = page.condition === null ? "always" : "switch";
  return (
    <div className="row" data-testid="page-condition">
      <label>When</label>
      <select
        value={mode}
        data-testid="page-condition-mode"
        onChange={(event) => {
          if (event.target.value === "always") {
            onChange(null);
          } else {
            onChange({ switchId: switches[0] ?? "sw_0", value: true });
          }
        }}
      >
        <option value="always">Always</option>
        <option value="switch">Switch is on</option>
      </select>
      {page.condition !== null && (
        <>
          <select
            value={page.condition.switchId}
            data-testid="page-condition-switch"
            onChange={(event) =>
              onChange({ switchId: event.target.value, value: page.condition?.value ?? true })
            }
          >
            {switches.length === 0 ? (
              <option value={page.condition.switchId}>{page.condition.switchId}</option>
            ) : (
              switches.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))
            )}
          </select>
          <input
            type="checkbox"
            checked={page.condition.value}
            data-testid="page-condition-value"
            onChange={(event) =>
              onChange({
                switchId: page.condition?.switchId ?? "sw_0",
                value: event.target.checked,
              })
            }
          />
        </>
      )}
    </div>
  );
}

function PageCommandEditor({
  page,
  onChange,
}: {
  page: EventPage;
  onChange: (page: EventPage) => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState<number | null>(null);

  return (
    <div data-testid="page-commands">
      <div className="row">
        <strong>Commands</strong>
      </div>
      {page.commands.length === 0 && (
        <div className="empty" data-testid="commands-empty">
          No commands yet.
        </div>
      )}
      {page.commands.map((command, index) => (
        <div className="command-row" key={index} data-testid={`command-row-${index}`}>
          <span className="cmd-summary" data-testid={`command-summary-${index}`}>
            {commandSummary(command)}
          </span>
          <button
            type="button"
            className="icon-btn"
            title="Edit"
            data-testid={`command-edit-${index}`}
            onClick={() => setEditing(editing === index ? null : index)}
          >
            ✎
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Move up"
            data-testid={`command-up-${index}`}
            disabled={index === 0}
            onClick={() => onChange(moveCommandInPage(page, index, index - 1))}
          >
            ↑
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Move down"
            data-testid={`command-down-${index}`}
            disabled={index === page.commands.length - 1}
            onClick={() => onChange(moveCommandInPage(page, index, index + 1))}
          >
            ↓
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Remove command"
            data-testid={`command-remove-${index}`}
            onClick={() => onChange(removeCommandFromPage(page, index))}
          >
            ✕
          </button>
          {editing === index && (
            <CommandArgsEditor
              command={command}
              onChange={(next) => onChange(updateCommandInPage(page, index, next))}
            />
          )}
        </div>
      ))}
      <div className="row" data-testid="command-add">
        {COMMAND_CATALOG.map((def) => (
          <button
            key={def.cmd}
            type="button"
            className="btn"
            data-testid={`cmd-add-${def.cmd}`}
            onClick={() => onChange(addCommandToPage(page, createCommand(def.cmd)))}
          >
            + {def.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function CommandArgsEditor({
  command,
  onChange,
}: {
  command: EventCommand;
  onChange: (command: EventCommand) => void;
}): React.JSX.Element {
  const def = commandDefFor(command.cmd);
  if (def === undefined) {
    return <div className="empty">Unknown command: {command.cmd}</div>;
  }
  const setArg = (index: number, value: string | number | boolean): void => {
    const args = [...command.args];
    args[index] = value;
    onChange({ ...command, args });
  };
  return (
    <div className="command-args" data-testid="command-args">
      {def.args.map((arg, index) => {
        const value = command.args[index];
        if (arg.type === "select") {
          return (
            <div className="row" key={arg.key}>
              <label>{arg.label}</label>
              <select
                value={String(value ?? arg.defaultValue)}
                data-testid={`command-arg-${arg.key}`}
                onChange={(event) => setArg(index, event.target.value)}
              >
                {arg.options?.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          );
        }
        if (arg.type === "boolean") {
          return (
            <div className="row" key={arg.key}>
              <label>{arg.label}</label>
              <input
                type="checkbox"
                checked={Boolean(value ?? arg.defaultValue)}
                data-testid={`command-arg-${arg.key}`}
                onChange={(event) => setArg(index, event.target.checked)}
              />
            </div>
          );
        }
        if (arg.type === "number") {
          return (
            <div className="row" key={arg.key}>
              <label>{arg.label}</label>
              <input
                type="number"
                value={Number(value ?? arg.defaultValue)}
                data-testid={`command-arg-${arg.key}`}
                onChange={(event) => setArg(index, Number(event.target.value))}
              />
            </div>
          );
        }
        return (
          <div className="row" key={arg.key}>
            <label>{arg.label}</label>
            <input
              type="text"
              value={String(value ?? arg.defaultValue)}
              data-testid={`command-arg-${arg.key}`}
              onChange={(event) => setArg(index, event.target.value)}
            />
          </div>
        );
      })}
    </div>
  );
}
