import { t } from "@manobu/ui/lib/copy";
import { useForm } from "@tanstack/react-form";
import { useCallback, useState } from "react";
import { useSettings } from "@/features/settings/settings-scope";
import {
  confirmResetFormOptions,
  confirmResetSchema,
} from "@/lib/form-options";
import { DEFAULT_SETTINGS } from "@/lib/settings";

const submitStateSelector = (state: {
  canSubmit: boolean;
  isSubmitting: boolean;
}) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting });

export const PrivacyTab = () => {
  const { settings, update } = useSettings();
  const [resetOpen, setResetOpen] = useState(false);
  const onExport = useCallback(() => {
    if (typeof window !== "undefined") {
      window.console.info(
        "[Settings] Export .json · would download user data bundle"
      );
    }
  }, []);
  const onTelemetryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      update({ telemetry: e.target.checked });
    },
    [update]
  );
  const form = useForm({
    ...confirmResetFormOptions,
    onSubmit: ({ value }) => {
      if (value.confirm === "RESET") {
        update({ retention: DEFAULT_SETTINGS.retention, telemetry: false });
        setResetOpen(false);
        form.reset();
      }
    },
  });
  const openReset = useCallback(() => {
    setResetOpen(true);
  }, []);
  const cancelReset = useCallback(() => {
    setResetOpen(false);
    form.reset();
  }, [form]);
  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      e.stopPropagation();
      form.handleSubmit();
    },
    [form]
  );
  return (
    <section
      aria-label="Data & Privacy"
      className="flex flex-col gap-3"
      data-testid="settings-privacy-tab"
    >
      <h2 className="font-semibold text-lg">Data & Privacy</h2>
      <p className="text-muted-foreground text-sm">{t("set.privacy")}</p>
      <label className="flex items-center gap-2 text-sm">
        <input
          checked={settings.telemetry}
          data-testid="settings-telemetry"
          onChange={onTelemetryChange}
          type="checkbox"
        />
        <span>Telemetry</span>
        <span aria-live="polite" className="text-muted-foreground text-xs">
          ({settings.telemetry ? "ON" : "OFF default"})
        </span>
      </label>
      <div className="flex gap-2">
        <button
          className="rounded-card border-2 border-border px-3 py-1 text-sm"
          data-testid="settings-export"
          onClick={onExport}
          type="button"
        >
          Export .json
        </button>
        <button
          className="rounded-card border-2 border-destructive px-3 py-1 text-sm"
          data-testid="settings-reset"
          onClick={openReset}
          type="button"
        >
          Reset progress
        </button>
      </div>
      {resetOpen ? (
        <form
          aria-label="Confirm reset"
          className="rounded-card border-2 border-destructive p-3"
          data-testid="settings-reset-confirm"
          onSubmit={handleSubmit}
        >
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm">Type RESET to confirm</legend>
            <form.Field
              name="confirm"
              validators={{
                onChange: ({ value }) => {
                  const parsed = confirmResetSchema.safeParse(value);
                  return parsed.success ? undefined : "Type RESET to confirm";
                },
              }}
            >
              {(field) => {
                const handleChange = (
                  e: React.ChangeEvent<HTMLInputElement>
                ): void => {
                  field.handleChange(e.target.value);
                };
                return (
                  <div className="flex flex-col gap-1">
                    <label className="sr-only" htmlFor={field.name}>
                      RESET confirmation
                    </label>
                    <input
                      aria-invalid={
                        field.state.meta.isTouched &&
                        field.state.meta.errors.length > 0
                      }
                      aria-label="RESET confirmation"
                      className="w-full rounded border-2 border-border px-2 py-1 font-mono text-sm"
                      data-testid="settings-reset-input"
                      id={field.name}
                      name={field.name}
                      onBlur={field.handleBlur}
                      onChange={handleChange}
                      value={field.state.value}
                    />
                    {field.state.meta.isTouched &&
                    field.state.meta.errors.length > 0 ? (
                      <p
                        aria-live="polite"
                        className="text-destructive text-xs"
                        role="alert"
                      >
                        {field.state.meta.errors.join(", ")}
                      </p>
                    ) : null}
                  </div>
                );
              }}
            </form.Field>
            <div className="flex gap-2">
              <button
                className="rounded-card border-2 border-border px-3 py-1 text-sm"
                data-testid="settings-reset-cancel"
                onClick={cancelReset}
                type="button"
              >
                Cancel
              </button>
              <form.Subscribe selector={submitStateSelector}>
                {({ canSubmit }) => (
                  <button
                    className="rounded-card border-2 border-destructive px-3 py-1 text-sm"
                    data-testid="settings-reset-delete"
                    disabled={!canSubmit}
                    type="submit"
                  >
                    Delete
                  </button>
                )}
              </form.Subscribe>
            </div>
          </fieldset>
        </form>
      ) : null}
    </section>
  );
};
