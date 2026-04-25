import { useEffect, useState } from "react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { dataClient } from "@/services/dataClient";
import { useLanguage } from "@/contexts/LanguageContext";
import { SourceOnboarding } from "@/components/SourceOnboarding";

/**
 * Source-scoped settings modal.
 *
 * Two entry points share this modal:
 *   1. Refresh icon next to "Available Columns" — passes
 *      `mode="fresh"`. The user explicitly asked to re-run the LLM
 *      setup; we open the wizard and force a fresh suggestion call
 *      even on previously-onboarded sources.
 *   2. Source-settings icon next to the agent-settings button —
 *      passes `mode="edit"`. Loads whatever was saved (clarifications
 *      + warm-ups + KPIs + agent instructions) into the same flow so
 *      the user can review and tweak. Falls back to fresh if the
 *      source has never been onboarded.
 *
 * Why we wrap SourceOnboarding instead of building a flat editor:
 * the four-step wizard already supports edit-existing mode (loads
 * saved values into each step) and is the canonical write path to
 * `POST /onboarding/save`. Building a parallel flat editor would
 * duplicate the same form state and the same save logic — a second
 * place to keep in sync. The wizard works as-is; we just open it
 * from new entry points.
 *
 * Active source picker: if the workspace has more than one active
 * source, we show a Select at the top so the user picks which one
 * to configure. Single-source workspaces skip the picker.
 */
export interface SourceSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Workspace/agent the modal was opened from. Used to list its active sources. */
  agentId: string | undefined;
  /** "fresh" forces a re-run of the LLM suggestions. "edit" loads saved values. */
  mode: "fresh" | "edit";
  /** Called after save so the parent can refresh derived UI (warm-up chips, etc). */
  onSaved?: () => void;
}

interface SourceLite {
  id: string;
  name: string;
  type: string;
}

export function SourceSettingsModal({
  open,
  onOpenChange,
  agentId,
  mode,
  onSaved,
}: SourceSettingsModalProps) {
  const { t } = useLanguage();
  const [sources, setSources] = useState<SourceLite[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // Load active sources for this agent on every open. We refresh on
  // each open instead of caching — the user might have added/removed
  // sources since the last time the modal closed.
  useEffect(() => {
    if (!open || !agentId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = (await dataClient.listSources(agentId, true)) as SourceLite[];
        if (cancelled) return;
        const filtered = (list || []).filter((s) => s && s.id);
        setSources(filtered);
        // Auto-select the only/first source so the user doesn't have
        // to click the picker for the common single-source case.
        setSelectedSourceId((prev) =>
          prev && filtered.some((s) => s.id === prev) ? prev : filtered[0]?.id || "",
        );
      } catch {
        if (!cancelled) setSources([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, agentId]);

  const handleDone = () => {
    // SourceOnboarding's own "Finish"/"Skip" buttons trigger this.
    // The wizard saves before invoking onDone, so by the time we get
    // here the persistence is committed; we just notify the parent.
    onSaved?.();
    onOpenChange(false);
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] h-[780px] flex flex-col overflow-hidden">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle>
            {mode === "fresh"
              ? t("sourceSettings.titleFresh") || "Re-run source setup"
              : t("sourceSettings.titleEdit") || "Source settings"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-1 space-y-4">
          {/* Source picker: only when there's more than one active
              source. Single-source case auto-selects and hides the
              control to avoid clutter. */}
          {sources.length > 1 && (
            <div className="space-y-2">
              <Label className="text-sm">
                {t("sourceSettings.pickSource") || "Source"}
              </Label>
              <Select
                value={selectedSourceId}
                onValueChange={setSelectedSourceId}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {sources.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}{" "}
                      <span className="text-muted-foreground">({s.type})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {selectedSourceId ? (
            // `key` forces SourceOnboarding to remount on source
            // change — its load effect runs on mount, and we want
            // a clean reload (with the right `forceFresh`) every
            // time the user picks a different source.
            <SourceOnboarding
              key={`${selectedSourceId}:${mode}`}
              sourceId={selectedSourceId}
              onDone={handleDone}
              onCancel={handleCancel}
              forceFresh={mode === "fresh"}
            />
          ) : (
            <p className="text-sm text-muted-foreground py-12 text-center">
              {loading
                ? t("sourceSettings.loading") || "Loading sources…"
                : t("sourceSettings.noSources") ||
                  "No active sources in this workspace."}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
