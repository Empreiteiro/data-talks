import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { dataClient } from "@/services/dataClient";
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
  sourceId: string;
  /** Called after save (or skip). Always receives the source id back. */
  onDone: (sourceId: string) => void;
  /** Called when the user explicitly cancels — modal should close. */
  onCancel: () => void;
  /**
   * If true, skip the "this source has been onboarded before → load
   * saved" gate and always call POST /onboarding/profile to re-run
   * the LLM. Used by the "re-run setup" entry point next to the
   * Available Columns header — the user explicitly asked for fresh
   * suggestions, so even a previously-completed source goes back
   * through the wizard. Default: false (auto-detect via
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

type Step = "loading" | "clarifications" | "warmups" | "kpis" | "saving";

export function SourceOnboarding({ sourceId, onDone, onCancel, forceFresh = false }: SourceOnboardingProps) {
  const { language, t } = useLanguage();
  const [step, setStep] = useState<Step>("loading");
  const [error, setError] = useState<string | null>(null);
  const [clarifications, setClarifications] = useState<Clarification[]>([]);
  const [warmups, setWarmups] = useState<Warmup[]>([]);
  const [kpis, setKpis] = useState<Kpi[]>([]);
  // "Specific Instructions for the Agent" — mirrors the textarea on
  // the agent settings modal. Pre-filled from `agent_instructions`
  // returned by GET /onboarding (which reads `Agent.description`).
  // We also track whether the user touched it so save can omit the
  // field (= leave existing value untouched) when they didn't.
  const [agentInstructions, setAgentInstructions] = useState("");
  const [agentInstructionsTouched, setAgentInstructionsTouched] = useState(false);

  // Step 1: load profile + suggestions. We try the saved-state endpoint
  // first; if anything is already there, treat it as "edit existing"
  // and skip the LLM round-trip. Otherwise call /profile to get fresh
  // suggestions. Either way we land on the clarifications step.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setError(null);
        const saved = await dataClient.getSourceOnboarding(sourceId);
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
          setStep("clarifications");
          return;
        }
        const fresh = await dataClient.getSourceOnboardingProfile(sourceId, language);
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
        setStep("clarifications");
      } catch (e: unknown) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourceId, language, forceFresh]);

  const persist = async (markSkipped: boolean) => {
    setStep("saving");
    try {
      // When skipping we still POST so the source gets stamped as
      // onboarded — this is what stops the modal from reappearing on
      // every reopen. The empty payload is intentional.
      const payload = markSkipped
        ? { clarifications: [], warmup_questions: [], kpis: [] }
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
            // Only send `agent_instructions` when the user actually
            // touched the textarea — otherwise omitting the field
            // tells the backend to leave Agent.description untouched.
            // This avoids inadvertently nuking instructions the user
            // set elsewhere (agent settings) when they just clicked
            // through onboarding without editing this field.
            ...(agentInstructionsTouched
              ? { agent_instructions: agentInstructions }
              : {}),
          };
      await dataClient.saveSourceOnboarding(sourceId, payload);
      onDone(sourceId);
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
            <Button onClick={() => setStep("kpis")}>{t("common.next") || "Next"}</Button>
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

          <div className="flex items-center justify-between">
            <Button variant="ghost" onClick={() => setStep("warmups")}>
              {t("common.back") || "Back"}
            </Button>
            <Button onClick={() => void persist(false)}>
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
