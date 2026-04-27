import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeftRight,
  Check,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { dataClient } from "@/services/dataClient";
import type {
  SqlSourceRelationship,
  SqlSourceRelationshipSuggestion,
} from "@/services/apiClient";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/contexts/LanguageContext";

/**
 * Guided onboarding flow for a freshly-connected data source.
 *
 * Four steps, all in one component because they share a lot of state
 * (the suggestions returned in step 1 feed every later step):
 *   1. Inspect — backend builds a profile + LLM suggests
 *      clarifications / warm-ups / KPIs. Synchronous LLM call;
 *      user sits on a spinner until done.
 *   2. Clarifications — user answers the LLM's questions inline.
 *   3. Warm-up questions — user picks the ones to keep (saved into
 *      `Agent.suggested_questions`, the same list the agent UI
 *      already surfaces).
 *   4. KPIs — user confirms / edits / discards.
 *
 * The whole thing is skippable from the header; skipping still POSTs
 * an empty save so we mark the source as onboarded and don't keep
 * prompting on every reopen.
 *
 * Re-opens after the first run pre-fill via GET /onboarding (handled
 * by `existingMode`) so the user can edit what was saved before.
 */
export interface SourceOnboardingProps {
  /**
   * Onboarding target. Provide EITHER `sourceId` (legacy
   * single-source path) OR `groupId` (multi-source path). The group
   * path is preferred when available — it routes through the
   * group-aware endpoints that build a combined profile and pin
   * assets to the group's source_ids set instead of a single source.
   */
  sourceId?: string;
  groupId?: string;
  /** Called after save (or skip). Always receives an id back (group
   *  id when in group mode, source id otherwise). */
  onDone: (id: string) => void;
  /** Called when the user explicitly cancels — modal should close. */
  onCancel: () => void;
  /**
   * If true, skip the "this has been onboarded before → load saved"
   * gate and always call POST /onboarding/profile to re-run the
   * LLM. Used by the "re-run setup" entry point next to the
   * Available Columns header. Default: false (auto-detect via
   * `onboarding_completed_at`).
   */
  forceFresh?: boolean;
}

interface Clarification {
  id?: string;
  question: string;
  answer: string;
}
interface Warmup {
  text: string;
  selected: boolean;
}
interface Kpi {
  id?: string;
  name: string;
  definition: string;
  dependencies: Record<string, unknown>;
  source_ids: string[];
  keep: boolean;
}
interface Filter {
  id?: string;
  name: string;
  column: string;
  kind: "date" | "category";
  values: string[]; // category only — empty for date filters
  source_ids: string[];
  keep: boolean;
}

type Step =
  | "loading"
  | "clarifications"
  | "warmups"
  | "filters"
  | "kpis"
  | "relationships"
  | "saving";

/** Side metadata for an LLM relationship suggestion in the onboarding
 * step. We keep a stable client-side key (the canonical relationship
 * key) so accept/dismiss state survives across re-renders without
 * reaching back into the suggestion list by index. */
interface RelationshipChoice {
  key: string;
  suggestion: SqlSourceRelationshipSuggestion;
  status: "pending" | "accepted" | "dismissed";
}

function relationshipKey(rel: SqlSourceRelationship): string {
  return [
    rel.leftSourceId,
    rel.leftTable,
    rel.leftColumn,
    rel.rightSourceId,
    rel.rightTable,
    rel.rightColumn,
  ].join("|");
}

export function SourceOnboarding({ sourceId, groupId, onDone, onCancel, forceFresh = false }: SourceOnboardingProps) {
  // The component runs against a group when given groupId; otherwise
  // it falls back to the legacy single-source endpoints. We pick the
  // pair of read/profile/save calls up front so the rest of the
  // logic doesn't have to branch.
  const isGroup = Boolean(groupId);
  const targetId = (groupId || sourceId || "") as string;
  const apiGet = isGroup ? dataClient.getSourceGroupOnboarding : dataClient.getSourceOnboarding;
  const apiProfile = isGroup ? dataClient.getSourceGroupOnboardingProfile : dataClient.getSourceOnboardingProfile;
  const apiSave = isGroup ? dataClient.saveSourceGroupOnboarding : dataClient.saveSourceOnboarding;
  const { language, t } = useLanguage();
  const [step, setStep] = useState<Step>("loading");
  const [error, setError] = useState<string | null>(null);
  const [clarifications, setClarifications] = useState<Clarification[]>([]);
  const [warmups, setWarmups] = useState<Warmup[]>([]);
  const [kpis, setKpis] = useState<Kpi[]>([]);
  const [filters, setFilters] = useState<Filter[]>([]);
  // "Specific Instructions for the Agent" — mirrors the textarea on
  // the agent settings modal. Pre-filled from `agent_instructions`
  // returned by GET /onboarding (which reads `Agent.description`).
  // We also track whether the user touched it so save can omit the
  // field (= leave existing value untouched) when they didn't.
  const [agentInstructions, setAgentInstructions] = useState("");
  const [agentInstructionsTouched, setAgentInstructionsTouched] = useState(false);
  // Source-scoped instructions: an additional prompt that ONLY
  // applies when this source is in the active workspace. Layered on
  // top of `agent_instructions` (which is workspace-wide). Same
  // touched-tracking pattern: only sent on save when the user
  // actually edited the field.
  const [sourceInstructions, setSourceInstructions] = useState("");
  const [sourceInstructionsTouched, setSourceInstructionsTouched] = useState(false);
  // Relationships step (only used when at least one SQL source is in
  // scope). `sqlAgentId` doubles as the gate: when null, the step is
  // skipped entirely and KPIs goes straight to persist().
  const [sqlAgentId, setSqlAgentId] = useState<string | null>(null);
  // Captured at load time so the relationships step is only auto-shown
  // for genuinely fresh onboardings (or explicit re-runs via
  // `forceFresh`). Re-opening an already-onboarded source to tweak
  // KPIs shouldn't re-prompt for relationships every time — that lives
  // in the dedicated Relationships modal.
  const [isFreshOnboarding, setIsFreshOnboarding] = useState(false);
  const [sqlSources, setSqlSources] = useState<
    Array<{
      id: string;
      name: string;
      table_infos?: Array<{ table: string; columns?: string[] }>;
    }>
  >([]);
  const [existingRelationships, setExistingRelationships] = useState<
    SqlSourceRelationship[]
  >([]);
  const [relationshipChoices, setRelationshipChoices] = useState<
    RelationshipChoice[]
  >([]);
  const [relationshipsLoading, setRelationshipsLoading] = useState(false);
  const [relationshipsError, setRelationshipsError] = useState<string | null>(
    null,
  );

  // Step 1: load profile + suggestions. We try the saved-state endpoint
  // first; if anything is already there, treat it as "edit existing"
  // and skip the LLM round-trip. Otherwise call /profile to get fresh
  // suggestions. Either way we land on the clarifications step.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const saved = await apiGet(targetId);
        if (cancelled) return;
        // The right signal for "this source has been onboarded before"
        // is the per-source `onboarding_completed_at` timestamp on the
        // source's metadata — NOT the count of items in the saved
        // payload. Warm-up questions are stored on `Agent.suggested_
        // questions` (agent-wide), and `_load_saved` returns them as
        // part of the response. If we used .length to gate, the second
        // source added to a workspace would inherit warm-ups from the
        // first and we'd skip the fresh LLM call — which is exactly
        // the bug "warm-ups are about the previous source, no
        // clarifications/KPIs generated, returned too fast".
        // Even on the fresh path we pre-fill `agentInstructions` from
        // the existing agent description, so users don't lose what
        // they previously typed in agent settings.
        setAgentInstructions(saved.agent_instructions || "");
        setSourceInstructions(saved.source_instructions || "");
        // Surfaces from the backend: non-null when the source / group
        // includes a SQL source with an agent. Drives the
        // relationships step entirely — when null, the new step is a
        // no-op and we behave exactly like before.
        setSqlAgentId(saved.sql_agent_id || null);
        // Track whether this is a fresh onboarding (no completion
        // timestamp, or user explicitly hit "re-run"). Drives whether
        // the SQL relationships step gets auto-prompted at the end.
        const isFresh = !saved.onboarding_completed_at || forceFresh;
        setIsFreshOnboarding(isFresh);
        // `forceFresh` is the explicit "re-run setup" entry point —
        // user clicked the refresh icon to ask for new LLM
        // suggestions, so we skip the edit-existing branch even when
        // `onboarding_completed_at` is set.
        if (!forceFresh && saved.onboarding_completed_at) {
          setClarifications(saved.clarifications.map((c) => ({ ...c })));
          setWarmups(
            (saved.warmup_questions || []).map((w) => ({ text: w.text, selected: true })),
          );
          setKpis(
            (saved.kpis || []).map((k) => ({
              id: k.id,
              name: k.name,
              definition: k.definition,
              dependencies: k.dependencies || {},
              source_ids: k.source_ids || [],
              keep: true,
            })),
          );
          setFilters(
            (saved.filters || []).map((f) => ({
              id: f.id,
              name: f.name,
              column: f.column,
              kind: f.kind,
              values:
                f.kind === "category"
                  ? ((f.config as { values?: unknown })?.values as string[]) || []
                  : [],
              source_ids: f.source_ids || [],
              keep: true,
            })),
          );
          setStep("clarifications");
          return;
        }
        const fresh = await apiProfile(targetId, language);
        if (cancelled) return;
        setClarifications(
          fresh.clarifications.map((c) => ({ question: c.question, answer: "" })),
        );
        setWarmups(fresh.warmup_questions.map((w) => ({ text: w.text, selected: true })));
        setKpis(
          fresh.kpis.map((k) => ({
            name: k.name,
            definition: k.definition,
            dependencies: k.dependencies || {},
            source_ids: [],
            keep: true,
          })),
        );
        setFilters(
          (fresh.filters || []).map((f) => ({
            name: f.name,
            column: f.column,
            kind: f.kind,
            values:
              f.kind === "category"
                ? ((f.config as { values?: unknown })?.values as string[]) || []
                : [],
            source_ids: [],
            keep: true,
          })),
        );
        setStep("clarifications");
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetId, language, forceFresh]);

  // Fetches LLM relationship suggestions plus the current saved
  // relationships from the agent. Idempotent — safe to call again on
  // retry. We replace state wholesale so a retry never leaves stale
  // entries behind.
  const loadRelationshipSuggestions = async (agentId: string) => {
    setRelationshipsLoading(true);
    setRelationshipsError(null);
    try {
      const data = await dataClient.suggestAgentSqlRelationshipsLlm(agentId);
      setSqlSources(data.sources || []);
      setExistingRelationships(data.relationships || []);
      setRelationshipChoices(
        (data.suggestions || []).map((s) => ({
          key: relationshipKey(s),
          suggestion: s,
          status: "pending" as const,
        })),
      );
    } catch (e: unknown) {
      setRelationshipsError(e instanceof Error ? e.message : String(e));
    } finally {
      setRelationshipsLoading(false);
    }
  };

  // Advance past the KPIs step. SQL fresh-onboarding gets the extra
  // relationships step; everything else (non-SQL, or re-edit of an
  // already-onboarded SQL source) goes straight to save. The
  // re-edit case keeps the existing flow because relationships have
  // their own dedicated modal — re-running setup just to edit a KPI
  // shouldn't re-prompt for joins.
  const handleKpisNext = () => {
    if (sqlAgentId && isFreshOnboarding) {
      setStep("relationships");
      void loadRelationshipSuggestions(sqlAgentId);
      return;
    }
    void persist(false);
  };

  // Persist accepted relationships, then run the regular onboarding
  // save. We save relationships FIRST: if the PUT fails the user
  // hasn't lost their work — they're still on the relationships step
  // and can retry or skip. Persisting first would mean a second
  // failure path where onboarding is "done" but joins were never
  // saved, which is harder to reason about.
  const finishRelationshipsStep = async () => {
    if (!sqlAgentId) {
      void persist(false);
      return;
    }
    const accepted = relationshipChoices
      .filter((c) => c.status === "accepted")
      .map((c) => ({
        leftSourceId: c.suggestion.leftSourceId,
        leftTable: c.suggestion.leftTable,
        leftColumn: c.suggestion.leftColumn,
        rightSourceId: c.suggestion.rightSourceId,
        rightTable: c.suggestion.rightTable,
        rightColumn: c.suggestion.rightColumn,
      }));
    if (accepted.length > 0) {
      try {
        // Merge with existing — the backend dedupes (forward + reverse
        // pairs) so sending duplicates is safe, but it's still nicer
        // to keep the payload minimal.
        const existingKeys = new Set(existingRelationships.map(relationshipKey));
        const merged = [
          ...existingRelationships,
          ...accepted.filter((rel) => !existingKeys.has(relationshipKey(rel))),
        ];
        await dataClient.saveAgentSqlRelationships(sqlAgentId, merged);
        toast.success(
          `${accepted.length} ${t("onboarding.relationshipsAcceptedCount") || "accepted"}`,
        );
      } catch (e: unknown) {
        setRelationshipsError(e instanceof Error ? e.message : String(e));
        return; // stay on the step; user can retry or skip
      }
    }
    // Fire-and-forget the dismiss endpoint for explicitly rejected
    // suggestions so the user doesn't see them again next time.
    // Errors here are non-fatal — they're a UX nicety, not data loss.
    const dismissed = relationshipChoices.filter(
      (c) => c.status === "dismissed",
    );
    if (dismissed.length > 0) {
      void Promise.all(
        dismissed.map((c) =>
          dataClient
            .dismissRelationshipSuggestion(sqlAgentId, c.key)
            .catch(() => {}),
        ),
      );
    }
    void persist(false);
  };

  const persist = async (markSkipped: boolean) => {
    setStep("saving");
    try {
      // When skipping we still POST so the source gets stamped as
      // onboarded — this is what stops the modal from reappearing on
      // every reopen. The empty payload is intentional.
      const payload = markSkipped
        ? { clarifications: [], warmup_questions: [], kpis: [], filters: [] }
        : {
            clarifications: clarifications
              .filter((c) => c.question.trim() && c.answer.trim())
              .map((c) => ({ id: c.id, question: c.question, answer: c.answer })),
            warmup_questions: warmups
              .filter((w) => w.selected && w.text.trim())
              .map((w) => ({ text: w.text })),
            kpis: kpis
              .filter((k) => k.keep && k.name.trim() && k.definition.trim())
              .map((k) => ({
                id: k.id,
                name: k.name,
                definition: k.definition,
                dependencies: k.dependencies,
                source_ids: k.source_ids,
              })),
            filters: filters
              .filter((f) => f.keep && f.name.trim() && f.column.trim())
              .map((f) => ({
                id: f.id,
                name: f.name,
                column: f.column,
                kind: f.kind,
                config:
                  f.kind === "category"
                    ? { values: f.values.filter((v) => v.trim()) }
                    : {},
                source_ids: f.source_ids,
              })),
            // Only send `agent_instructions` when the user actually
            // touched the textarea — otherwise omitting the field
            // tells the backend to leave Agent.description untouched.
            // This avoids inadvertently nuking instructions the user
            // set elsewhere (agent settings) when they just clicked
            // through onboarding without editing this field.
            ...(agentInstructionsTouched
              ? { agent_instructions: agentInstructions }
              : {}),
            // Source-scoped instructions follow the same touched
            // semantics. Persisted to Source.metadata_; layered on
            // top of agent_instructions in dispatch_question.
            ...(sourceInstructionsTouched
              ? { source_instructions: sourceInstructions }
              : {}),
          };
      await apiSave(targetId, payload);
      onDone(targetId);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
      setStep("kpis");
    }
  };

  const totalAnswered = useMemo(
    () => clarifications.filter((c) => c.answer.trim()).length,
    [clarifications],
  );
  const totalSelectedWarmups = useMemo(
    () => warmups.filter((w) => w.selected).length,
    [warmups],
  );
  const totalKeptKpis = useMemo(() => kpis.filter((k) => k.keep).length, [kpis]);

  if (step === "loading") {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {t("onboarding.profiling") || "Profiling source and generating suggestions…"}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">{error}</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onCancel}>
            {t("common.close") || "Close"}
          </Button>
          <Button onClick={() => void persist(true)}>
            {t("onboarding.skip") || "Skip onboarding"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold">
            {t("onboarding.title") || "Set up this data source"}
          </h3>
          <p className="text-xs text-muted-foreground">
            {t("onboarding.subtitle") ||
              "Three quick steps so future questions about this source are accurate."}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={() => void persist(true)}>
          {t("onboarding.skip") || "Skip"}
        </Button>
      </header>

      {/* Step 2 — Clarifications */}
      {step === "clarifications" && (
        <Card className="p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">
              {t("onboarding.clarificationsTitle") || "Clarifying questions"}
            </h4>
            <Badge variant="secondary">
              {totalAnswered}/{clarifications.length}
            </Badge>
          </div>
          {clarifications.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("onboarding.noClarifications") ||
                "No clarifying questions for this source — feel free to add one."}
            </p>
          ) : (
            <ul className="space-y-3">
              {clarifications.map((c, i) => (
                <li key={i} className="space-y-2">
                  <Label className="text-sm font-normal">{c.question}</Label>
                  <Textarea
                    value={c.answer}
                    onChange={(e) =>
                      setClarifications((prev) =>
                        prev.map((p, j) => (i === j ? { ...p, answer: e.target.value } : p)),
                      )
                    }
                    rows={2}
                    placeholder={
                      t("onboarding.answerPlaceholder") || "Type your answer…"
                    }
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setClarifications((prev) => [...prev, { question: "", answer: "" }])
              }
            >
              <Plus className="mr-1 h-3 w-3" />
              {t("onboarding.addClarification") || "Add clarification"}
            </Button>
            <Button onClick={() => setStep("warmups")}>
              {t("common.next") || "Next"}
            </Button>
          </div>
        </Card>
      )}

      {/* Step 3 — Warm-up questions */}
      {step === "warmups" && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">
              {t("onboarding.warmupTitle") || "Suggested starter questions"}
            </h4>
            <Badge variant="secondary">{totalSelectedWarmups} selected</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("onboarding.warmupHint") ||
              "Selected questions become quick-start chips on the agent."}
          </p>
          <ul className="space-y-2">
            {warmups.map((w, i) => (
              <li key={i} className="flex items-start gap-2">
                <Checkbox
                  checked={w.selected}
                  onCheckedChange={(v) =>
                    setWarmups((prev) =>
                      prev.map((p, j) => (j === i ? { ...p, selected: !!v } : p)),
                    )
                  }
                />
                <Input
                  value={w.text}
                  onChange={(e) =>
                    setWarmups((prev) =>
                      prev.map((p, j) => (j === i ? { ...p, text: e.target.value } : p)),
                    )
                  }
                  className="flex-1"
                />
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => setStep("clarifications")}>
              {t("common.back") || "Back"}
            </Button>
            <Button onClick={() => setStep("filters")}>{t("common.next") || "Next"}</Button>
          </div>
        </Card>
      )}

      {/* Step 3.5 — Filters
        *
        * Date filters: just `name` + `column`. The user picks the
        * actual range later, in the workspace's filter menu. We
        * don't capture defaults here; if the LLM provided any, we
        * already discarded them on save (kept config = {}).
        *
        * Category filters: `name` + `column` + an editable list of
        * candidate values. We render values as a textarea (one per
        * line) — the simplest UX that lets the user add/remove/edit
        * without forcing us to build chip pickers. Trim and dedupe
        * happens at save time. */}
      {step === "filters" && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">
              {t("onboarding.filtersTitle") || "Suggested filters"}
            </h4>
            <Badge variant="secondary">
              {filters.filter((f) => f.keep).length} kept
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("onboarding.filtersHint") ||
              "Date and category filters become a workspace-level menu next to the logs button."}
          </p>
          <ul className="space-y-3">
            {filters.map((f, i) => (
              <li
                key={i}
                className="space-y-2 rounded-md border border-border/60 p-3 bg-card"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="text-[10px] uppercase tracking-wide"
                  >
                    {f.kind}
                  </Badge>
                  <Input
                    value={f.name}
                    placeholder="Filter name"
                    onChange={(e) =>
                      setFilters((prev) =>
                        prev.map((p, j) => (j === i ? { ...p, name: e.target.value } : p)),
                      )
                    }
                    className="font-medium flex-1"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setFilters((prev) =>
                        prev.map((p, j) => (j === i ? { ...p, keep: !p.keep } : p)),
                      )
                    }
                    title={f.keep ? "Discard" : "Keep"}
                    className={f.keep ? "" : "opacity-40"}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <Input
                  value={f.column}
                  placeholder="Column"
                  onChange={(e) =>
                    setFilters((prev) =>
                      prev.map((p, j) => (j === i ? { ...p, column: e.target.value } : p)),
                    )
                  }
                  className="font-mono text-xs"
                />
                {f.kind === "category" && (
                  <Textarea
                    rows={3}
                    placeholder="One value per line"
                    value={f.values.join("\n")}
                    onChange={(e) =>
                      setFilters((prev) =>
                        prev.map((p, j) =>
                          j === i
                            ? {
                                ...p,
                                values: e.target.value
                                  .split("\n")
                                  .map((v) => v.trim())
                                  .filter(Boolean),
                              }
                            : p,
                        ),
                      )
                    }
                    className="font-mono text-xs"
                  />
                )}
              </li>
            ))}
            {filters.length === 0 && (
              <p className="text-xs text-muted-foreground italic">
                {t("onboarding.filtersEmpty") ||
                  "No filters suggested. You can add them later in the source settings."}
              </p>
            )}
          </ul>
          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => setStep("warmups")}>
              {t("common.back") || "Back"}
            </Button>
            <Button onClick={() => setStep("kpis")}>
              {t("common.next") || "Next"}
            </Button>
          </div>
        </Card>
      )}

      {/* Step 4 — KPIs */}
      {step === "kpis" && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">
              {t("onboarding.kpisTitle") || "Candidate KPIs"}
            </h4>
            <Badge variant="secondary">{totalKeptKpis} kept</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("onboarding.kpisHint") ||
              "KPIs are stored per workspace and can be reused across sources later."}
          </p>
          <ul className="space-y-3">
            {kpis.map((k, i) => (
              <li
                key={i}
                className="space-y-2 rounded-md border border-border/60 p-3 bg-card"
              >
                <div className="flex items-center justify-between gap-2">
                  <Input
                    value={k.name}
                    placeholder={t("onboarding.kpiNamePlaceholder") || "KPI name"}
                    onChange={(e) =>
                      setKpis((prev) =>
                        prev.map((p, j) => (j === i ? { ...p, name: e.target.value } : p)),
                      )
                    }
                    className="font-medium"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setKpis((prev) =>
                        prev.map((p, j) => (j === i ? { ...p, keep: !p.keep } : p)),
                      )
                    }
                    title={k.keep ? "Discard" : "Keep"}
                    className={k.keep ? "" : "opacity-40"}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <Textarea
                  value={k.definition}
                  rows={2}
                  placeholder={t("onboarding.kpiDefPlaceholder") || "Definition"}
                  onChange={(e) =>
                    setKpis((prev) =>
                      prev.map((p, j) =>
                        j === i ? { ...p, definition: e.target.value } : p,
                      ),
                    )
                  }
                />
              </li>
            ))}
          </ul>

          {/*
            Final-step extra: "Specific Instructions for the Agent".
            Same content as the agent-settings textarea (mirrors
            Agent.description). Pre-filled from the current value so
            re-opening doesn't clear it. Reuses the agentSettings.*
            i18n keys instead of inventing new ones — same field, same
            copy across the app.
          */}
          <div className="space-y-2 pt-2 border-t">
            <Label htmlFor="agent-instructions" className="text-sm font-medium">
              {t("agentSettings.instructions") ||
                "Specific Instructions for the Agent"}
            </Label>
            <Textarea
              id="agent-instructions"
              value={agentInstructions}
              onChange={(e) => {
                setAgentInstructions(e.target.value);
                if (!agentInstructionsTouched) setAgentInstructionsTouched(true);
              }}
              placeholder={t("agentSettings.instructionsPlaceholder") || ""}
              className="min-h-[100px]"
            />
            <p className="text-xs text-muted-foreground">
              {t("agentSettings.instructionsHelp") || ""}
            </p>
          </div>

          {/*
            Source-scoped instructions. Mirrors the agent-level
            textarea above but applies ONLY when this source is in
            the active workspace. Use case: a workspace shared
            between two sources where each has its own quirks
            (different timezones, different "active" definitions,
            different naming conventions). The agent-level prompt
            stays small and generic; the source-level prompt carries
            source-specific context.
          */}
          <div className="space-y-2">
            <Label htmlFor="source-instructions" className="text-sm font-medium">
              {t("onboarding.sourceInstructions") ||
                "Source-specific instructions"}
            </Label>
            <Textarea
              id="source-instructions"
              value={sourceInstructions}
              onChange={(e) => {
                setSourceInstructions(e.target.value);
                if (!sourceInstructionsTouched) setSourceInstructionsTouched(true);
              }}
              placeholder={
                t("onboarding.sourceInstructionsPlaceholder") ||
                "Notes that only apply when this source is in the workspace…"
              }
              className="min-h-[80px]"
            />
            <p className="text-xs text-muted-foreground">
              {t("onboarding.sourceInstructionsHelp") ||
                "Layered on top of the agent-level instructions, only when this source is active."}
            </p>
          </div>

          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => setStep("filters")}>
              {t("common.back") || "Back"}
            </Button>
            <Button onClick={handleKpisNext}>
              {sqlAgentId && isFreshOnboarding
                ? t("common.next") || "Next"
                : t("onboarding.finish") || "Finish"}
            </Button>
          </div>
        </Card>
      )}

      {/* Step 5 — SQL Relationships (only for fresh SQL onboarding).
        *
        * The LLM is asked to propose foreign-key style joins between
        * tables across the agent's SQL sources. The user picks which
        * to accept; accepted ones are persisted to
        * `Agent.source_relationships` and become editable from the
        * "Relacionamentos SQL" modal afterwards. Dismissed ones are
        * remembered server-side so the heuristic suggestions modal
        * doesn't re-surface them on every reopen. */}
      {step === "relationships" && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              {t("onboarding.relationshipsTitle") || "Suggested table relationships"}
            </h4>
            <Badge variant="secondary">
              {relationshipChoices.filter((c) => c.status === "accepted").length}{" "}
              {t("onboarding.relationshipsAcceptedCount") || "accepted"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("onboarding.relationshipsHint") ||
              "AI-detected joins between your SQL tables."}
          </p>

          {relationshipsLoading && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("onboarding.relationshipsLoading") || "Looking for relationships…"}
            </div>
          )}

          {!relationshipsLoading && relationshipsError && (
            <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
              <p className="text-sm text-destructive">
                {t("onboarding.relationshipsError") ||
                  "Could not generate suggestions."}
              </p>
              <p className="text-xs text-muted-foreground break-words">
                {relationshipsError}
              </p>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    sqlAgentId && void loadRelationshipSuggestions(sqlAgentId)
                  }
                >
                  {t("onboarding.relationshipsRetry") || "Retry"}
                </Button>
              </div>
            </div>
          )}

          {!relationshipsLoading &&
            !relationshipsError &&
            relationshipChoices.length === 0 && (
              <p className="text-sm text-muted-foreground italic py-2">
                {t("onboarding.relationshipsEmpty") ||
                  "No relationships were suggested."}
              </p>
            )}

          {!relationshipsLoading && relationshipChoices.length > 0 && (
            <ul className="space-y-2">
              {relationshipChoices.map((choice) => {
                const leftSource = sqlSources.find(
                  (s) => s.id === choice.suggestion.leftSourceId,
                );
                const rightSource = sqlSources.find(
                  (s) => s.id === choice.suggestion.rightSourceId,
                );
                const dimmed = choice.status === "dismissed";
                const accepted = choice.status === "accepted";
                return (
                  <li
                    key={choice.key}
                    className={cn(
                      "rounded-md border p-3 space-y-2 transition-opacity",
                      dimmed && "opacity-40",
                      accepted && "border-primary/50 bg-primary/5",
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-sm font-mono min-w-0">
                        <span className="truncate">
                          {leftSource?.name || choice.suggestion.leftSourceId}.
                          {choice.suggestion.leftTable}.
                          <span className="text-primary">
                            {choice.suggestion.leftColumn}
                          </span>
                        </span>
                        <ArrowLeftRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                        <span className="truncate">
                          {rightSource?.name || choice.suggestion.rightSourceId}.
                          {choice.suggestion.rightTable}.
                          <span className="text-primary">
                            {choice.suggestion.rightColumn}
                          </span>
                        </span>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button
                          variant={accepted ? "default" : "outline"}
                          size="sm"
                          className="h-7 px-2"
                          onClick={() =>
                            setRelationshipChoices((prev) =>
                              prev.map((c) =>
                                c.key === choice.key
                                  ? {
                                      ...c,
                                      status:
                                        c.status === "accepted"
                                          ? "pending"
                                          : "accepted",
                                    }
                                  : c,
                              ),
                            )
                          }
                          title={
                            t("onboarding.relationshipsAccept") || "Accept"
                          }
                        >
                          <Check className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() =>
                            setRelationshipChoices((prev) =>
                              prev.map((c) =>
                                c.key === choice.key
                                  ? {
                                      ...c,
                                      status:
                                        c.status === "dismissed"
                                          ? "pending"
                                          : "dismissed",
                                    }
                                  : c,
                              ),
                            )
                          }
                          title={
                            t("onboarding.relationshipsDismiss") || "Dismiss"
                          }
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    {choice.suggestion.reason && (
                      <p className="text-xs text-muted-foreground">
                        {choice.suggestion.reason}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex items-center justify-between pt-2">
            <Button variant="ghost" onClick={() => setStep("kpis")}>
              {t("common.back") || "Back"}
            </Button>
            <Button
              onClick={() => void finishRelationshipsStep()}
              disabled={relationshipsLoading}
            >
              {t("onboarding.finish") || "Finish"}
            </Button>
          </div>
        </Card>
      )}

      {step === "saving" && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("onboarding.saving") || "Saving…"}
        </div>
      )}
    </div>
  );
}

/* eslint-disable react-refresh/only-export-components */
export const __SourceOnboardingDevHelpers = { /* exported for tests later */ };
/* eslint-enable react-refresh/only-export-components */
