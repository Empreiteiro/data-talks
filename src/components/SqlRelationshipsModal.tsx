import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";
import type { SqlSourceRelationship } from "@/services/apiClient";
import { cn } from "@/lib/utils";
import { ArrowLeftRight, GitBranch, Hand, Loader2, Plus, Sparkles, Trash2, X } from "lucide-react";
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

interface DiagramNode {
  id: string;
  sourceName: string;
  tableName: string;
  columns: string[];
  sourceId: string;
}

function diagramNodeId(sourceId: string, tableName: string): string {
  return `${sourceId}::${tableName}`;
}

function RelationshipEditorFields({
  relationship,
  index,
  sources,
  getColumns,
  onUpdate,
  onRemove,
  onSwap,
  title,
  description,
  compact = false,
}: {
  relationship: RelationshipDraft;
  index?: number;
  sources: SqlSourceMetadata[];
  getColumns: (sourceId: string, tableName: string) => string[];
  onUpdate: (clientId: string, updater: (current: RelationshipDraft) => RelationshipDraft) => void;
  onRemove: (clientId: string) => void;
  onSwap: (clientId: string) => void;
  title: string;
  description?: string;
  compact?: boolean;
}) {
  const { t } = useLanguage();
  const leftColumns = getColumns(relationship.leftSourceId, relationship.leftTable);
  const rightColumns = getColumns(relationship.rightSourceId, relationship.rightTable);
  const tableOptions = useMemo(
    () =>
      sources.flatMap((source) =>
        (source.table_infos || []).map((table) => ({
          value: diagramNodeId(source.id, table.table),
          sourceId: source.id,
          tableName: table.table,
          label: `${source.name} - ${table.table}`,
          firstColumn: table.columns?.[0] || "",
        })),
      ),
    [sources],
  );

  return (
    <div className={cn("rounded-lg border p-4 space-y-4", compact && "space-y-3")}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm font-medium">
            {title}
          </span>
          {description ? (
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onSwap(relationship.clientId)}
            title={t("sqlRelationships.swapSides")}
          >
            <ArrowLeftRight className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onRemove(relationship.clientId)}
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3">
          <Label>{t("sqlRelationships.leftSide")}</Label>
          <Select
            value={relationship.leftSourceId && relationship.leftTable ? diagramNodeId(relationship.leftSourceId, relationship.leftTable) : undefined}
            onValueChange={(value) =>
              onUpdate(relationship.clientId, (current) => {
                const selectedTable = tableOptions.find((option) => option.value === value);
                return {
                  ...current,
                  leftSourceId: selectedTable?.sourceId || "",
                  leftTable: selectedTable?.tableName || "",
                  leftColumn: selectedTable?.firstColumn || "",
                };
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder={t("sqlRelationships.selectTable")} />
            </SelectTrigger>
            <SelectContent>
              {tableOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={relationship.leftColumn || undefined}
            onValueChange={(value) =>
              onUpdate(relationship.clientId, (current) => ({ ...current, leftColumn: value }))
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
            value={relationship.rightSourceId && relationship.rightTable ? diagramNodeId(relationship.rightSourceId, relationship.rightTable) : undefined}
            onValueChange={(value) =>
              onUpdate(relationship.clientId, (current) => {
                const selectedTable = tableOptions.find((option) => option.value === value);
                return {
                  ...current,
                  rightSourceId: selectedTable?.sourceId || "",
                  rightTable: selectedTable?.tableName || "",
                  rightColumn: selectedTable?.firstColumn || "",
                };
              })
            }
          >
            <SelectTrigger>
              <SelectValue placeholder={t("sqlRelationships.selectTable")} />
            </SelectTrigger>
            <SelectContent>
              {tableOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={relationship.rightColumn || undefined}
            onValueChange={(value) =>
              onUpdate(relationship.clientId, (current) => ({ ...current, rightColumn: value }))
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
}

function SqlRelationshipsDiagram({
  sources,
  relationships,
  emptyText,
  selectedRelationshipId,
  onSelectRelationship,
  selectedRelationship,
  onUpdateRelationship,
  onRemoveRelationship,
  onSwapRelationship,
  onAddRelationship,
  getTables,
  getColumns,
}: {
  sources: SqlSourceMetadata[];
  relationships: RelationshipDraft[];
  emptyText: string;
  selectedRelationshipId: string | null;
  onSelectRelationship: (clientId: string) => void;
  selectedRelationship: RelationshipDraft | null;
  onUpdateRelationship: (clientId: string, updater: (current: RelationshipDraft) => RelationshipDraft) => void;
  onRemoveRelationship: (clientId: string) => void;
  onSwapRelationship: (clientId: string) => void;
  onAddRelationship: () => void;
  getTables: (sourceId: string) => Array<{ table: string; columns?: string[]; preview_rows?: Record<string, unknown>[] }>;
  getColumns: (sourceId: string, tableName: string) => string[];
}) {
  const { t } = useLanguage();
  const [pan, setPan] = useState({ x: 80, y: 50 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ x: number; y: number } | null>(null);

  const nodes = useMemo<DiagramNode[]>(() => {
    const map = new Map<string, DiagramNode>();
    relationships.forEach((relationship) => {
      const leftSource = sources.find((source) => source.id === relationship.leftSourceId);
      const rightSource = sources.find((source) => source.id === relationship.rightSourceId);
      const leftTable = leftSource?.table_infos?.find((table) => table.table === relationship.leftTable);
      const rightTable = rightSource?.table_infos?.find((table) => table.table === relationship.rightTable);

      if (leftSource && leftTable) {
        map.set(diagramNodeId(leftSource.id, leftTable.table), {
          id: diagramNodeId(leftSource.id, leftTable.table),
          sourceName: leftSource.name,
          tableName: leftTable.table,
          columns: leftTable.columns || [],
          sourceId: leftSource.id,
        });
      }
      if (rightSource && rightTable) {
        map.set(diagramNodeId(rightSource.id, rightTable.table), {
          id: diagramNodeId(rightSource.id, rightTable.table),
          sourceName: rightSource.name,
          tableName: rightTable.table,
          columns: rightTable.columns || [],
          sourceId: rightSource.id,
        });
      }
    });
    return Array.from(map.values());
  }, [relationships, sources]);

  const cardWidth = 250;
  const cardHeight = 182;
  const cardGapX = 90;
  const cardGapY = 80;
  const columnsCount = Math.max(1, Math.min(3, nodes.length || 1));

  const positionedNodes = useMemo(
    () =>
      nodes.map((node, index) => {
        const column = index % columnsCount;
        const row = Math.floor(index / columnsCount);
        const x = 24 + column * (cardWidth + cardGapX);
        const y = 24 + row * (cardHeight + cardGapY);
        return { ...node, x, y };
      }),
    [nodes, columnsCount],
  );

  const nodeMap = useMemo(
    () => new Map(positionedNodes.map((node) => [node.id, node])),
    [positionedNodes],
  );

  const svgWidth = Math.max(
    640,
    columnsCount * cardWidth + Math.max(0, columnsCount - 1) * cardGapX + 48,
  );
  const rowsCount = Math.max(1, Math.ceil((positionedNodes.length || 1) / columnsCount));
  const svgHeight = Math.max(
    320,
    rowsCount * cardHeight + Math.max(0, rowsCount - 1) * cardGapY + 48,
  );

  if (relationships.length === 0 || positionedNodes.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-10 text-sm text-muted-foreground text-center">
        {emptyText}
      </div>
    );
  }

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragRef.current = { x: event.clientX, y: event.clientY };
    setIsDragging(true);
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const deltaX = event.clientX - dragRef.current.x;
    const deltaY = event.clientY - dragRef.current.y;
    dragRef.current = { x: event.clientX, y: event.clientY };
    setPan((current) => ({ x: current.x + deltaX, y: current.y + deltaY }));
  };

  const stopDragging = () => {
    dragRef.current = null;
    setIsDragging(false);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div
        className={cn(
          "relative rounded-lg border bg-muted/10 overflow-hidden h-[68vh]",
          isDragging ? "cursor-grabbing" : "cursor-grab",
        )}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={stopDragging}
        onMouseLeave={stopDragging}
      >
        <div className="absolute left-3 top-3 z-10 rounded-md border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur">
          <div className="flex items-center gap-2">
            <Hand className="h-3.5 w-3.5" />
            {t("sqlRelationships.diagramPanHint")}
          </div>
        </div>
        <div
          className="absolute inset-0"
          style={{ transform: `translate(${pan.x}px, ${pan.y}px)` }}
        >
          <div className="relative" style={{ width: svgWidth, height: svgHeight }}>
        <svg className="absolute inset-0" width={svgWidth} height={svgHeight}>
          {relationships.map((relationship, index) => {
            const leftNode = nodeMap.get(diagramNodeId(relationship.leftSourceId, relationship.leftTable));
            const rightNode = nodeMap.get(diagramNodeId(relationship.rightSourceId, relationship.rightTable));
            if (!leftNode || !rightNode) return null;
            const isSelected = selectedRelationshipId === relationship.clientId;

            const startX = leftNode.x + cardWidth;
            const startY = leftNode.y + cardHeight / 2;
            const endX = rightNode.x;
            const endY = rightNode.y + cardHeight / 2;
            const midX = (startX + endX) / 2;

            return (
              <g key={`${relationshipKey(relationship)}-${index}`}>
                <path
                  d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
                  fill="none"
                  stroke="transparent"
                  strokeWidth="18"
                  className="cursor-pointer"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectRelationship(relationship.clientId);
                  }}
                />
                <path
                  d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
                  fill="none"
                  stroke={isSelected ? "hsl(var(--primary))" : "currentColor"}
                  strokeOpacity={isSelected ? 0.95 : 0.35}
                  strokeWidth={isSelected ? "3" : "2"}
                />
                <text
                  x={midX}
                  y={(startY + endY) / 2 - 8}
                  textAnchor="middle"
                  fontSize="11"
                  fill={isSelected ? "hsl(var(--primary))" : "currentColor"}
                  opacity={isSelected ? "1" : "0.8"}
                >
                  {`${relationship.leftColumn} = ${relationship.rightColumn}`}
                </text>
              </g>
            );
          })}
        </svg>

        {positionedNodes.map((node) => (
          <div
            key={node.id}
            className={cn(
              "absolute rounded-xl border bg-background shadow-sm",
              selectedRelationship &&
                (node.id === diagramNodeId(selectedRelationship.leftSourceId, selectedRelationship.leftTable) ||
                  node.id === diagramNodeId(selectedRelationship.rightSourceId, selectedRelationship.rightTable))
                ? "border-primary shadow-[0_0_0_1px_hsl(var(--primary))]"
                : "",
            )}
            style={{ left: node.x, top: node.y, width: cardWidth, minHeight: cardHeight }}
          >
            <div className="border-b px-4 py-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground truncate">
                {node.sourceName}
              </p>
              <p className="text-sm font-semibold truncate">{node.tableName}</p>
            </div>
            <div className="px-4 py-3 space-y-1">
              {node.columns.slice(0, 6).map((column) => (
                <div key={column} className="text-xs font-mono rounded bg-muted/40 px-2 py-1">
                  {column}
                </div>
              ))}
              {node.columns.length > 6 && (
                <p className="text-xs text-muted-foreground">
                  +{node.columns.length - 6}
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-medium">{t("sqlRelationships.diagramEditorTitle")}</h3>
            <p className="text-xs text-muted-foreground">{t("sqlRelationships.diagramEditorDescription")}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onAddRelationship}>
            <Plus className="h-4 w-4 mr-2" />
            {t("sqlRelationships.addManual")}
          </Button>
        </div>

        <div className="rounded-lg border p-3 space-y-2 max-h-[60vh] overflow-y-auto">
          {relationships.map((relationship, index) => (
            <button
              key={relationship.clientId}
              type="button"
              onClick={() => onSelectRelationship(relationship.clientId)}
              className={cn(
                "w-full rounded-md border px-3 py-2 text-left transition-colors",
                selectedRelationshipId === relationship.clientId
                  ? "border-primary bg-primary/10"
                  : "hover:bg-muted/50",
              )}
            >
              <div className="text-sm font-medium">
                {t("sqlRelationships.relationshipLabel", { index: index + 1 })}
              </div>
              <div className="text-xs text-muted-foreground truncate">
                {relationship.leftTable}.{relationship.leftColumn} = {relationship.rightTable}.{relationship.rightColumn}
              </div>
            </button>
          ))}
        </div>

        {selectedRelationship ? (
          <RelationshipEditorFields
            relationship={selectedRelationship}
            sources={sources}
            getColumns={getColumns}
            onUpdate={onUpdateRelationship}
            onRemove={onRemoveRelationship}
            onSwap={onSwapRelationship}
            title={t("sqlRelationships.diagramSelectedTitle")}
            description={t("sqlRelationships.diagramSelectedDescription")}
            compact
          />
        ) : (
          <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground text-center">
            {t("sqlRelationships.diagramSelectRelationship")}
          </div>
        )}
      </div>
    </div>
  );
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
  const [selectedRelationshipId, setSelectedRelationshipId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !agentId) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    dataClient.listAgentSqlRelationshipSuggestions(agentId)
      .then((data) => {
        if (cancelled) return;
        const nextRelationships = (data.relationships || []).map((relationship) => createDraft(relationship));
        setSources(data.sources || []);
        setRelationships(nextRelationships);
        setSelectedRelationshipId(nextRelationships[0]?.clientId || null);
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
    const draft = createDraft(relationship);
    setRelationships((current) => [...current, draft]);
    setSelectedRelationshipId(draft.clientId);
  };

  const dismissSuggestion = async (suggestion: SqlSourceRelationship) => {
    const key = relationshipKey(suggestion);
    try {
      await dataClient.dismissRelationshipSuggestion(agentId, key);
      setSuggestions((prev) => prev.filter((s) => relationshipKey(s) !== key));
    } catch (error) {
      toast.error(t("sqlRelationships.loadError"), {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const addEmptyRelationship = () => {
    const leftSource = sources[0];
    const rightSource = sources[1];
    const leftTable = leftSource?.table_infos?.[0];
    const rightTable = rightSource?.table_infos?.[0];
    const draft = createDraft({
      leftSourceId: leftSource?.id || "",
      leftTable: leftTable?.table || "",
      leftColumn: leftTable?.columns?.[0] || "",
      rightSourceId: rightSource?.id || "",
      rightTable: rightTable?.table || "",
      rightColumn: rightTable?.columns?.[0] || "",
    });
    setRelationships((current) => [
      ...current,
      draft,
    ]);
    setSelectedRelationshipId(draft.clientId);
  };

  const removeRelationship = (clientId: string) => {
    setRelationships((current) => current.filter((item) => item.clientId !== clientId));
    setSelectedRelationshipId((current) => (current === clientId ? null : current));
  };

  const swapRelationshipSides = (clientId: string) => {
    updateRelationship(clientId, (current) => ({
      ...current,
      leftSourceId: current.rightSourceId,
      leftTable: current.rightTable,
      leftColumn: current.rightColumn,
      rightSourceId: current.leftSourceId,
      rightTable: current.leftTable,
      rightColumn: current.leftColumn,
    }));
  };

  useEffect(() => {
    if (relationships.length === 0) {
      setSelectedRelationshipId(null);
      return;
    }
    if (!selectedRelationshipId || !relationships.some((relationship) => relationship.clientId === selectedRelationshipId)) {
      setSelectedRelationshipId(relationships[0].clientId);
    }
  }, [relationships, selectedRelationshipId]);

  const selectedRelationship = relationships.find((relationship) => relationship.clientId === selectedRelationshipId) || null;

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
      <DialogContent className="w-[96vw] max-w-[96vw] h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("sqlRelationships.title")}</DialogTitle>
          <DialogDescription>{t("sqlRelationships.description")}</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="connections" className="flex-1 flex flex-col overflow-hidden">
          <TabsList className="w-fit">
            <TabsTrigger value="connections">{t("sqlRelationships.connectionsTab")}</TabsTrigger>
            <TabsTrigger value="diagram">
              <GitBranch className="h-4 w-4 mr-2" />
              {t("sqlRelationships.diagramTab")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="diagram" className="flex-1 overflow-y-auto pr-1">
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
              <div className="space-y-3">
                <div>
                  <h3 className="text-sm font-medium">{t("sqlRelationships.diagramTitle")}</h3>
                  <p className="text-xs text-muted-foreground">{t("sqlRelationships.diagramDescription")}</p>
                </div>
                <SqlRelationshipsDiagram
                  sources={sources}
                  relationships={relationships}
                  emptyText={t("sqlRelationships.diagramEmpty")}
                  selectedRelationshipId={selectedRelationshipId}
                  onSelectRelationship={setSelectedRelationshipId}
                  selectedRelationship={selectedRelationship}
                  onUpdateRelationship={updateRelationship}
                  onRemoveRelationship={removeRelationship}
                  onSwapRelationship={swapRelationshipSides}
                  onAddRelationship={addEmptyRelationship}
                  getTables={getTables}
                  getColumns={getColumns}
                />
              </div>
            )}
          </TabsContent>

          <TabsContent value="connections" className="flex-1 overflow-y-auto pr-1">
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
            <div className="flex flex-col gap-6">
              <div className="space-y-3">
                <div className="flex items-center justify-end gap-3">
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
                          <div className="flex items-center gap-1 shrink-0">
                            <Button type="button" variant="secondary" size="sm" onClick={() => addSuggestion(suggestion)}>
                              {t("sqlRelationships.useSuggestion")}
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              title={t("sqlRelationships.dismissSuggestion")}
                              onClick={() => dismissSuggestion(suggestion)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <Separator />

              <div className="space-y-4">
                {relationships.length > 0 && (
                  <>
                <h3 className="text-sm font-medium">{t("sqlRelationships.relationshipsTitle")}</h3>
                  <div className="space-y-4">
                    {relationships.map((relationship, index) => {
                      return (
                        <RelationshipEditorFields
                          key={relationship.clientId}
                          relationship={relationship}
                          index={index}
                          sources={sources}
                          getColumns={getColumns}
                          onUpdate={updateRelationship}
                          onRemove={removeRelationship}
                          onSwap={swapRelationshipSides}
                          title={t("sqlRelationships.relationshipLabel", { index: index + 1 })}
                        />
                      );
                    })}
                  </div>
                  </>
                )}
              </div>
            </div>
          )}
          </TabsContent>
        </Tabs>

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
