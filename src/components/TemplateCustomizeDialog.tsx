import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLanguage } from "@/contexts/LanguageContext";

interface TemplateQuery {
  id: string;
  title: string;
}

interface TemplateCustomizeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  queries: TemplateQuery[];
  disabledQueries: string[];
  dateRange: { start: string; end: string };
  onSave: (disabledQueries: string[], dateRange: { start: string; end: string }) => void;
}

export function TemplateCustomizeDialog({
  open,
  onOpenChange,
  queries,
  disabledQueries: initialDisabled,
  dateRange: initialDateRange,
  onSave,
}: TemplateCustomizeDialogProps) {
  const { t } = useLanguage();
  const [disabled, setDisabled] = useState<string[]>(initialDisabled);
  const [dateStart, setDateStart] = useState(initialDateRange.start);
  const [dateEnd, setDateEnd] = useState(initialDateRange.end);

  const toggleQuery = (queryId: string) => {
    setDisabled((prev) =>
      prev.includes(queryId)
        ? prev.filter((id) => id !== queryId)
        : [...prev, queryId]
    );
  };

  const handleSave = () => {
    onSave(disabled, { start: dateStart, end: dateEnd });
    onOpenChange(false);
  };

  const handleReset = () => {
    setDisabled([]);
    setDateStart("");
    setDateEnd("");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("studio.templateCustomize")}</DialogTitle>
          <DialogDescription>
            {t("studio.templateFilters")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Date Range */}
          <div className="space-y-2">
            <Label>{t("studio.templateDateRange")}</Label>
            <div className="flex gap-2">
              <Input
                type="date"
                value={dateStart}
                onChange={(e) => setDateStart(e.target.value)}
                placeholder="Start"
              />
              <Input
                type="date"
                value={dateEnd}
                onChange={(e) => setDateEnd(e.target.value)}
                placeholder="End"
              />
            </div>
          </div>

          {/* Query toggles */}
          <div className="space-y-2">
            <Label>Queries</Label>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {queries.map((q) => (
                <label
                  key={q.id}
                  className="flex items-center gap-2 p-2 rounded hover:bg-muted cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={!disabled.includes(q.id)}
                    onChange={() => toggleQuery(q.id)}
                    className="rounded"
                  />
                  <span className="text-sm">{q.title}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter className="flex gap-2">
          <Button variant="outline" onClick={handleReset}>
            {t("studio.templateResetCustomization")}
          </Button>
          <Button onClick={handleSave}>
            {t("save") || "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
