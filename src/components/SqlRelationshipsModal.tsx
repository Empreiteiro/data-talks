import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import type { SqlSourceRelationship } from "@/services/apiClient";
import { Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface SqlSourceMetadata {
  id: string;
  name: string;
  is_active?: boolean;
  table_infos?: Array<{
    table: string;
    columns?: string[];
    preview_rows?: Record<string, unknown>[];
  }>;
}

interface RelationshipDraft extends SqlSourceRelationship {
  clientId: string;
}

interface SqlRelationshipsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  onSaved?: () => void;
}

function createDraft(
  initial?: Partial<SqlSourceRelationship>,
): RelationshipDraft {
  return {
    clientId: crypto.randomUUID(),
    leftSourceId: initial?.leftSourceId || "",
    leftTable: initial?.leftTable || "",
    leftColumn: initial?.leftColumn || "",
    rightSourceId: initial?.rightSourceId || "",
    rightTable: initial?.rightTable || "",
    rightColumn: initial?.rightColumn || "",
  };
}

function relationshipKey(relationship: SqlSourceRelationship): string {
  return [
    relationship.leftSourceId,
    relationship.leftTable,
    relationship.leftColumn,
    relationship.rightSourceId,
    relationship.rightTable,
    relationship.rightColumn,
  ].join("|");
}

export function SqlRelationshipsModal({
  open,
  onOpenChange,
  agentId,
  onSaved,
}: SqlRelationshipsModalProps) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sources, setSources] = useState<SqlSourceMetadata[]>([]);
  const [relationships, setRelationships] = useState<RelationshipDraft[]>([]);
  const [suggestions, setSuggestions] = useState<SqlSourceRelationship[]>([]);

  useEffect(() => {
    if (!open || !agentId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    dataClient.listAgentSqlRelationshipSuggestions(agentId)
      .then((data) => {
        if (cancelled) return;
        setSources(data.sources || []);
        setRelationships((data.relationships || []).map((relationship) => createDraft(relationship)));
        setSuggestions(data.suggestions || []);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        toast.error(t("sqlRelationships.loadError"), {
          description: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, agentId, t]);

  const suggestionKeys = useMemo(
    () => new Set(relationships.map(({ clientId: _clientId, ...relationship }) => relationshipKey(relationship))),
    [relationships],
  );

  const visibleSuggestions = useMemo(
    () => suggestions.filter((suggestion) => !suggestionKeys.has(relationshipKey(suggestion))),
    [suggestions, suggestionKeys],
  );

  const sqlSourceCount = sources.length;

  const getTables = (sourceId: string) =>
    sources.find((source) => source.id === sourceId)?.table_infos || [];

  const getColumns = (sourceId: string, tableName: string) =>
    getTables(sourceId).find((table) => table.table === tableName)?.columns || [];

  const updateRelationship = (
    clientId: string,
    updater: (current: RelationshipDraft) => RelationshipDraft,
  ) => {
    setRelationships((current) =>
      current.map((relationship) =>
        relationship.clientId === clientId ? updater(relationship) : relationship,
      ),
    );
  };

  const addSuggestion = (relationship: SqlSourceRelationship) => {
    setRelationships((current) => [...current, createDraft(relationship)]);
  };

  const addEmptyRelationship = () => {
    const leftSource = sources[0];
    const rightSource = sources[1];
    const leftTable = leftSource?.table_infos?.[0];
    const rightTable = rightSource?.table_infos?.[0];
    setRelationships((current) => [
      ...current,
      createDraft({
        leftSourceId: leftSource?.id || "",
        leftTable: leftTable?.table || "",
        leftColumn: leftTable?.columns?.[0] || "",
        rightSourceId: rightSource?.id || "",
        rightTable: rightTable?.table || "",
        rightColumn: rightTable?.columns?.[0] || "",
      }),
    ]);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await dataClient.saveAgentSqlRelationships(
        agentId,
        relationships.map(({ clientId: _clientId, ...relationship }) => relationship),
      );
      toast.success(t("sqlRelationships.saveSuccess"));
      onSaved?.();
      onOpenChange(false);
    } catch (error: unknown) {
      toast.error(t("sqlRelationships.saveError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("sqlRelationships.title")}</DialogTitle>
          <DialogDescription>{t("sqlRelationships.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 space-y-6">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : sqlSourceCount < 2 ? (
            <Alert>
              <AlertTitle>{t("sqlRelationships.needMoreSourcesTitle")}</AlertTitle>
              <AlertDescription>{t("sqlRelationships.needMoreSourcesDescription")}</AlertDescription>
            </Alert>
          ) : (
            <>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-medium">{t("sqlRelationships.suggestionsTitle")}</h3>
                    <p className="text-xs text-muted-foreground">{t("sqlRelationships.suggestionsDescription")}</p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={addEmptyRelationship}>
                    <Plus className="h-4 w-4 mr-2" />
                    {t("sqlRelationships.addManual")}
                  </Button>
                </div>
                {visibleSuggestions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("sqlRelationships.noSuggestions")}</p>
                ) : (
                  <div className="space-y-2">
                    {visibleSuggestions.map((suggestion) => {
                      const leftSource = sources.find((source) => source.id === suggestion.leftSourceId);
                      const rightSource = sources.find((source) => source.id === suggestion.rightSourceId);
                      return (
                        <div
                          key={relationshipKey(suggestion)}
                          className="flex items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium flex items-center gap-2">
                              <Sparkles className="h-4 w-4 text-primary" />
                              {leftSource?.name} - {suggestion.leftTable}.{suggestion.leftColumn}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {rightSource?.name} - {suggestion.rightTable}.{suggestion.rightColumn}
                            </p>
                          </div>
                          <Button type="button" variant="secondary" size="sm" onClick={() => addSuggestion(suggestion)}>
                            {t("sqlRelationships.useSuggestion")}
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <Separator />

              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-medium">{t("sqlRelationships.relationshipsTitle")}</h3>
                  <p className="text-xs text-muted-foreground">{t("sqlRelationships.relationshipsDescription")}</p>
                </div>
                {relationships.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("sqlRelationships.noRelationships")}</p>
                ) : (
                  <div className="space-y-4">
                    {relationships.map((relationship, index) => {
                      const leftTables = getTables(relationship.leftSourceId);
                      const rightTables = getTables(relationship.rightSourceId);
                      const leftColumns = getColumns(relationship.leftSourceId, relationship.leftTable);
                      const rightColumns = getColumns(relationship.rightSourceId, relationship.rightTable);

                      return (
                        <div key={relationship.clientId} className="rounded-lg border p-4 space-y-4">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium">
                              {t("sqlRelationships.relationshipLabel", { index: index + 1 })}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => setRelationships((current) => current.filter((item) => item.clientId !== relationship.clientId))}
                            >
                              <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                          </div>

                          <div className="grid gap-4 md:grid-cols-2">
                            <div className="space-y-3">
                              <Label>{t("sqlRelationships.leftSide")}</Label>
                              <Select
                                value={relationship.leftSourceId || undefined}
                                onValueChange={(value) =>
                                  updateRelationship(relationship.clientId, (current) => {
                                    const nextTable = getTables(value)[0];
                                    return {
                                      ...current,
                                      leftSourceId: value,
                                      leftTable: nextTable?.table || "",
                                      leftColumn: nextTable?.columns?.[0] || "",
                                    };
                                  })
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder={t("sqlRelationships.selectSource")} />
                                </SelectTrigger>
                                <SelectContent>
                                  {sources.map((source) => (
                                    <SelectItem key={source.id} value={source.id}>
                                      {source.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Select
                                value={relationship.leftTable || undefined}
                                onValueChange={(value) =>
                                  updateRelationship(relationship.clientId, (current) => ({
                                    ...current,
                                    leftTable: value,
                                    leftColumn: getColumns(current.leftSourceId, value)[0] || "",
                                  }))
                                }
                                disabled={leftTables.length === 0}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder={t("sqlRelationships.selectTable")} />
                                </SelectTrigger>
                                <SelectContent>
                                  {leftTables.map((table) => (
                                    <SelectItem key={table.table} value={table.table}>
                                      {table.table}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Select
                                value={relationship.leftColumn || undefined}
                                onValueChange={(value) =>
                                  updateRelationship(relationship.clientId, (current) => ({ ...current, leftColumn: value }))
                                }
                                disabled={leftColumns.length === 0}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder={t("sqlRelationships.selectColumn")} />
                                </SelectTrigger>
                                <SelectContent>
                                  {leftColumns.map((column) => (
                                    <SelectItem key={column} value={column}>
                                      {column}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="space-y-3">
                              <Label>{t("sqlRelationships.rightSide")}</Label>
                              <Select
                                value={relationship.rightSourceId || undefined}
                                onValueChange={(value) =>
                                  updateRelationship(relationship.clientId, (current) => {
                                    const nextTable = getTables(value)[0];
                                    return {
                                      ...current,
                                      rightSourceId: value,
                                      rightTable: nextTable?.table || "",
                                      rightColumn: nextTable?.columns?.[0] || "",
                                    };
                                  })
                                }
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder={t("sqlRelationships.selectSource")} />
                                </SelectTrigger>
                                <SelectContent>
                                  {sources.map((source) => (
                                    <SelectItem key={source.id} value={source.id}>
                                      {source.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Select
                                value={relationship.rightTable || undefined}
                                onValueChange={(value) =>
                                  updateRelationship(relationship.clientId, (current) => ({
                                    ...current,
                                    rightTable: value,
                                    rightColumn: getColumns(current.rightSourceId, value)[0] || "",
                                  }))
                                }
                                disabled={rightTables.length === 0}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder={t("sqlRelationships.selectTable")} />
                                </SelectTrigger>
                                <SelectContent>
                                  {rightTables.map((table) => (
                                    <SelectItem key={table.table} value={table.table}>
                                      {table.table}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Select
                                value={relationship.rightColumn || undefined}
                                onValueChange={(value) =>
                                  updateRelationship(relationship.clientId, (current) => ({ ...current, rightColumn: value }))
                                }
                                disabled={rightColumns.length === 0}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder={t("sqlRelationships.selectColumn")} />
                                </SelectTrigger>
                                <SelectContent>
                                  {rightColumns.map((column) => (
                                    <SelectItem key={column} value={column}>
                                      {column}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("sqlRelationships.cancel")}
          </Button>
          <Button onClick={handleSave} disabled={saving || loading || sqlSourceCount < 2}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            {t("sqlRelationships.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
