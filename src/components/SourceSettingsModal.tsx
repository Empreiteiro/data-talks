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
  // Selection format:
  //   "src:<sourceId>"  → onboard a single source
  //   "group:all"       → onboard the GROUP of all active sources;
  //                       resolves to a SourceGroup id at render time
  //                       (created lazily via apiClient.upsertSourceGroup).
  const [selection, setSelection] = useState<string>("");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [creatingGroup, setCreatingGroup] = useState(false);
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
        // Auto-select sensibly: multi-source workspaces default to
        // the GROUP option (the user's primary intent here is "show
        // me what's saved for this combination"); single-source
        // workspaces auto-pick the lone source.
        if (filtered.length > 1) {
          setSelection("group:all");
        } else if (filtered[0]) {
          setSelection(`src:${filtered[0].id}`);
        } else {
          setSelection("");
        }
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

  // When the user picks "All active sources", upsert (or fetch) the
  // SourceGroup for that exact set so SourceOnboarding can mount in
  // group mode. Runs whenever the selection changes to "group:all"
  // or the active-sources list changes (e.g. user added a source
  // via another tab).
  useEffect(() => {
    if (!open || selection !== "group:all" || !agentId) {
      setGroupId(null);
      return;
    }
    const ids = sources.map((s) => s.id);
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      setCreatingGroup(true);
      try {
        const g = await dataClient.upsertSourceGroup(agentId, ids);
        if (!cancelled) setGroupId(g.id);
      } catch (e) {
        console.error("Failed to upsert source group:", e);
        if (!cancelled) setGroupId(null);
      } finally {
        if (!cancelled) setCreatingGroup(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, selection, agentId, sources]);

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
              <Select value={selection} onValueChange={setSelection}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/*
                    "Group" option first — that's the primary path
                    in multi-source workspaces. Picking it onboards
                    the SET of sources together, which is where
                    cross-source clarifications and KPIs live.
                  */}
                  <SelectItem value="group:all">
                    {(t("sourceSettings.allSources") || "All active sources")}
                    {" "}({sources.length})
                  </SelectItem>
                  {sources.map((s) => (
                    <SelectItem key={s.id} value={`src:${s.id}`}>
                      {s.name}{" "}
                      <span className="text-muted-foreground">({s.type})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {(() => {
            // Decide what to render based on selection. Group mode
            // waits for `groupId` to resolve (lazy upsert). Source
            // mode runs immediately. Empty state covers both
            // "no sources at all" and "still loading".
            if (selection === "group:all") {
              if (creatingGroup || !groupId) {
                return (
                  <p className="text-sm text-muted-foreground py-12 text-center">
                    {t("sourceSettings.loading") || "Loading sources…"}
                  </p>
                );
              }
              return (
                <SourceOnboarding
                  key={`group:${groupId}:${mode}`}
                  groupId={groupId}
                  onDone={handleDone}
                  onCancel={handleCancel}
                  forceFresh={mode === "fresh"}
                />
              );
            }
            if (selection.startsWith("src:")) {
              const sid = selection.slice("src:".length);
              if (!sid) return null;
              return (
                <SourceOnboarding
                  key={`src:${sid}:${mode}`}
                  sourceId={sid}
                  onDone={handleDone}
                  onCancel={handleCancel}
                  forceFresh={mode === "fresh"}
                />
              );
            }
            return (
              <p className="text-sm text-muted-foreground py-12 text-center">
                {loading
                  ? t("sourceSettings.loading") || "Loading sources…"
                  : t("sourceSettings.noSources") ||
                    "No active sources in this workspace."}
              </p>
            );
          })()}
        </div>
      </DialogContent>
    </Dialog>
  );
}
