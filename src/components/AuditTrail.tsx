import { useState, useEffect, useCallback } from "react";
import { useLanguage } from "@/contexts/LanguageContext";
import { apiClient } from "@/services/apiClient";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Search,
  Download,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Settings2,
  Trash2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";

const CATEGORIES = ["query", "source", "agent", "config", "user", "auth"];
const PAGE_SIZE = 50;

const categoryColors: Record<string, string> = {
  query: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  source: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
  agent: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  config: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200",
  user: "bg-pink-100 text-pink-800 dark:bg-pink-900 dark:text-pink-200",
  auth: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200",
};

type AuditItem = {
  id: string;
  user_id?: string;
  user_email?: string;
  action: string;
  category: string;
  resource_type?: string;
  resource_id?: string;
  detail?: string;
  ip_address?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
};

export default function AuditTrail() {
  const { t, language } = useLanguage();
  const [items, setItems] = useState<AuditItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);

  // Filters
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Retention
  const [retentionOpen, setRetentionOpen] = useState(false);
  const [retentionDays, setRetentionDays] = useState(90);
  const [retentionLoading, setRetentionLoading] = useState(false);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiClient.listAuditLogs({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        category: category || undefined,
        search: search || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      setItems(result.items);
      setTotal(result.total);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [page, category, search, dateFrom, dateTo]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const handleSearch = () => {
    setPage(0);
    fetchLogs();
  };

  const handleExport = async () => {
    try {
      const blob = await apiClient.exportAuditCsv({
        category: category || undefined,
        search: search || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "audit_logs.csv";
      a.click();
      URL.revokeObjectURL(url);
      toast.success(t("audit.exportSuccess"));
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const openRetention = async () => {
    try {
      const config = await apiClient.getAuditRetention();
      setRetentionDays(config.retention_days);
    } catch {}
    setRetentionOpen(true);
  };

  const saveRetention = async () => {
    setRetentionLoading(true);
    try {
      await apiClient.updateAuditRetention(retentionDays);
      toast.success(t("audit.retentionSaved"));
      setRetentionOpen(false);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRetentionLoading(false);
    }
  };

  const applyRetention = async () => {
    setRetentionLoading(true);
    try {
      const result = await apiClient.applyAuditRetention();
      toast.success(
        `${t("audit.retentionApplied")}: ${result.deleted} ${t("audit.recordsDeleted")}`
      );
      fetchLogs();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setRetentionLoading(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const formatDate = (iso: string) => {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString(language === "pt" ? "pt-BR" : language === "es" ? "es-ES" : "en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">{t("audit.title")}</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={openRetention}>
            <Settings2 className="h-4 w-4 mr-1" />
            {t("audit.retention")}
          </Button>
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="h-4 w-4 mr-1" />
            CSV
          </Button>
          <Button variant="outline" size="sm" onClick={fetchLogs}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label className="text-xs text-muted-foreground mb-1 block">
            {t("audit.search")}
          </label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder={t("audit.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            />
          </div>
        </div>
        <div className="w-[160px]">
          <label className="text-xs text-muted-foreground mb-1 block">
            {t("audit.category")}
          </label>
          <Select
            value={category}
            onValueChange={(v) => {
              setCategory(v === "all" ? "" : v);
              setPage(0);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("audit.allCategories")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("audit.allCategories")}</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-[160px]">
          <label className="text-xs text-muted-foreground mb-1 block">
            {t("audit.dateFrom")}
          </label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <div className="w-[160px]">
          <label className="text-xs text-muted-foreground mb-1 block">
            {t("audit.dateTo")}
          </label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(0);
            }}
          />
        </div>
        <Button size="sm" onClick={handleSearch}>
          <Search className="h-4 w-4 mr-1" />
          {t("audit.filter")}
        </Button>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="text-left px-3 py-2 font-medium">{t("audit.col.timestamp")}</th>
                <th className="text-left px-3 py-2 font-medium">{t("audit.col.action")}</th>
                <th className="text-left px-3 py-2 font-medium">{t("audit.col.category")}</th>
                <th className="text-left px-3 py-2 font-medium">{t("audit.col.user")}</th>
                <th className="text-left px-3 py-2 font-medium">{t("audit.col.resource")}</th>
                <th className="text-left px-3 py-2 font-medium">{t("audit.col.detail")}</th>
                <th className="text-left px-3 py-2 font-medium">IP</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-muted-foreground">
                    {t("common.loading")}
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-muted-foreground">
                    {t("audit.noResults")}
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="border-b hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(item.created_at)}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{item.action}</td>
                    <td className="px-3 py-2">
                      <Badge
                        variant="secondary"
                        className={categoryColors[item.category] || ""}
                      >
                        {item.category}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-xs">{item.user_email || "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      {item.resource_type && (
                        <span className="text-muted-foreground">
                          {item.resource_type}
                          {item.resource_id && (
                            <span className="ml-1 font-mono">
                              {item.resource_id.slice(0, 8)}
                            </span>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs max-w-[300px] truncate" title={item.detail || ""}>
                      {item.detail || ""}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground font-mono">
                      {item.ip_address || ""}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          {total} {t("audit.totalRecords")} — {t("audit.page")} {page + 1}/{totalPages}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Retention Policy Dialog */}
      <Dialog open={retentionOpen} onOpenChange={setRetentionOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("audit.retentionTitle")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              {t("audit.retentionDescription")}
            </p>
            <div>
              <label className="text-sm font-medium block mb-1">
                {t("audit.retentionDays")}
              </label>
              <Select
                value={String(retentionDays)}
                onValueChange={(v) => setRetentionDays(Number(v))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30">30 {t("audit.days")}</SelectItem>
                  <SelectItem value="60">60 {t("audit.days")}</SelectItem>
                  <SelectItem value="90">90 {t("audit.days")}</SelectItem>
                  <SelectItem value="180">180 {t("audit.days")}</SelectItem>
                  <SelectItem value="365">365 {t("audit.days")}</SelectItem>
                  <SelectItem value="0">{t("audit.forever")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="destructive"
              size="sm"
              onClick={applyRetention}
              disabled={retentionLoading}
            >
              <Trash2 className="h-4 w-4 mr-1" />
              {t("audit.applyNow")}
            </Button>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRetentionOpen(false)}>
              {t("audit.cancel")}
            </Button>
            <Button onClick={saveRetention} disabled={retentionLoading}>
              {t("audit.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
