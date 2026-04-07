/**
 * AlertModal — create, manage, and test scheduled alerts and reports.
 */
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Bell, Clock, Loader2, Mail, Play, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/contexts/LanguageContext";
import { dataClient } from "@/services/dataClient";

interface AlertData {
  id: string;
  agent_id: string;
  name: string;
  type: string;
  question: string;
  email: string;
  frequency: string;
  execution_time: string;
  day_of_week: number | null;
  day_of_month: number | null;
  is_active: boolean;
  next_run: string | null;
  last_run: string | null;
  last_status: string | null;
  created_at: string;
}

interface AlertExecution {
  id: string;
  status: string;
  answer: string | null;
  error_message: string | null;
  email_sent: boolean;
  webhooks_fired: number;
  duration_ms: number | null;
  created_at: string;
}

interface AlertModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
}

const DAYS_OF_WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function AlertModal({ open, onOpenChange, agentId }: AlertModalProps) {
  const { t } = useLanguage();

  const [alerts, setAlerts] = useState<AlertData[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  // Create form state
  const [name, setName] = useState("");
  const [type, setType] = useState("alert");
  const [question, setQuestion] = useState("");
  const [email, setEmail] = useState("");
  const [frequency, setFrequency] = useState("daily");
  const [executionTime, setExecutionTime] = useState("09:00");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);

  // Execution history
  const [executions, setExecutions] = useState<Record<string, AlertExecution[]>>({});

  useEffect(() => {
    if (!open) return;
    loadAlerts();
  }, [open, agentId]);

  async function loadAlerts() {
    setLoading(true);
    try {
      const data = await dataClient.listAlerts(agentId);
      setAlerts(data || []);
    } catch {
      toast.error("Failed to load alerts");
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setName("");
    setType("alert");
    setQuestion("");
    setEmail("");
    setFrequency("daily");
    setExecutionTime("09:00");
    setDayOfWeek(1);
    setDayOfMonth(1);
    setShowCreateForm(false);
  }

  async function handleCreate() {
    if (!name.trim() || !question.trim() || !email.trim()) {
      toast.error("Name, question, and email are required");
      return;
    }
    setSaving(true);
    try {
      await dataClient.createAlert(
        agentId, name.trim(), question.trim(), email.trim(),
        frequency, executionTime,
        frequency === "weekly" ? dayOfWeek : undefined,
        frequency === "monthly" ? dayOfMonth : undefined,
        type,
      );
      toast.success("Alert created");
      resetForm();
      await loadAlerts();
    } catch (err: unknown) {
      toast.error("Failed to create alert", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(alert: AlertData) {
    try {
      await dataClient.updateAlert(alert.id, { is_active: !alert.is_active });
      setAlerts((prev) => prev.map((a) => a.id === alert.id ? { ...a, is_active: !a.is_active } : a));
    } catch {
      toast.error("Failed to update alert");
    }
  }

  async function handleDelete(alertId: string) {
    try {
      await dataClient.deleteAlert(alertId);
      setAlerts((prev) => prev.filter((a) => a.id !== alertId));
      toast.success("Alert deleted");
    } catch {
      toast.error("Failed to delete alert");
    }
  }

  async function handleTest(alertId: string) {
    setTesting(alertId);
    try {
      await dataClient.testAlert(alertId);
      toast.success("Alert executed! Check your email.");
      await loadAlerts();
    } catch (err: unknown) {
      toast.error("Test failed", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setTesting(null);
    }
  }

  async function loadExecutions(alertId: string) {
    try {
      const data = await dataClient.listAlertExecutions(alertId);
      setExecutions((prev) => ({ ...prev, [alertId]: data || [] }));
    } catch { /* silent */ }
  }

  function formatNextRun(dateStr: string | null) {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return d.toLocaleString();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Alerts & Scheduled Reports
          </DialogTitle>
          <DialogDescription>
            Schedule questions to run automatically and receive results by email.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-3">
          {/* Create CTA */}
          {!showCreateForm ? (
            <Button variant="outline" className="w-full" onClick={() => setShowCreateForm(true)}>
              <Plus className="h-4 w-4 mr-2" />Create Alert
            </Button>
          ) : (
            <div className="border rounded-md p-4 space-y-3">
              <Label className="text-sm font-medium">New Alert</Label>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Name</Label>
                  <Input placeholder="Daily revenue check" value={name} onChange={(e) => setName(e.target.value)} disabled={saving} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Type</Label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger className="focus:ring-0 focus:ring-offset-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="alert">Alert</SelectItem>
                      <SelectItem value="report">Report</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Question</Label>
                <Textarea placeholder="What was the total revenue yesterday?" value={question} onChange={(e) => setQuestion(e.target.value)} disabled={saving} className="min-h-[60px]" />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Email (recipient)</Label>
                <Input type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} disabled={saving} />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Frequency</Label>
                  <Select value={frequency} onValueChange={setFrequency}>
                    <SelectTrigger className="focus:ring-0 focus:ring-offset-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly</SelectItem>
                      <SelectItem value="monthly">Monthly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Time (UTC)</Label>
                  <Input type="time" value={executionTime} onChange={(e) => setExecutionTime(e.target.value)} disabled={saving} />
                </div>
                {frequency === "weekly" && (
                  <div className="space-y-1">
                    <Label className="text-xs">Day</Label>
                    <Select value={String(dayOfWeek)} onValueChange={(v) => setDayOfWeek(Number(v))}>
                      <SelectTrigger className="focus:ring-0 focus:ring-offset-0"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {DAYS_OF_WEEK.map((d, i) => <SelectItem key={i} value={String(i + 1)}>{d}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                {frequency === "monthly" && (
                  <div className="space-y-1">
                    <Label className="text-xs">Day of month</Label>
                    <Input type="number" min={1} max={28} value={dayOfMonth} onChange={(e) => setDayOfMonth(Number(e.target.value))} disabled={saving} />
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button onClick={handleCreate} disabled={saving || !name.trim() || !question.trim() || !email.trim()}>
                  {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Creating...</> : <><Bell className="h-4 w-4 mr-2" />Create</>}
                </Button>
                <Button variant="ghost" onClick={resetForm} disabled={saving}>Cancel</Button>
              </div>
            </div>
          )}

          {/* Alerts list */}
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : alerts.length === 0 && !showCreateForm ? (
            <div className="text-center py-8">
              <Bell className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
              <p className="text-sm text-muted-foreground">No alerts configured yet.</p>
            </div>
          ) : (
            alerts.map((alert) => (
              <div key={alert.id} className={`border rounded-md transition-opacity ${alert.is_active ? "" : "opacity-50"}`}>
                <div className="flex items-center gap-3 px-4 py-3">
                  <Switch checked={alert.is_active} onCheckedChange={() => handleToggleActive(alert)} className="shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{alert.name}</span>
                      <Badge variant={alert.type === "report" ? "default" : "secondary"} className="text-[10px] shrink-0">{alert.type}</Badge>
                      <Badge variant="outline" className="text-[10px] shrink-0">{alert.frequency}</Badge>
                      {alert.last_status && (
                        <Badge variant={alert.last_status === "success" ? "default" : "destructive"} className="text-[10px] shrink-0">
                          {alert.last_status}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{alert.execution_time} UTC</span>
                      <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{alert.email}</span>
                      {alert.next_run && <span>Next: {formatNextRun(alert.next_run)}</span>}
                    </div>
                  </div>
                  <Button variant="outline" size="sm" className="h-7 shrink-0" onClick={() => handleTest(alert.id)} disabled={testing === alert.id}>
                    {testing === alert.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <><Play className="h-3 w-3 mr-1" /><span className="text-xs">Test</span></>}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive hover:text-destructive" onClick={() => handleDelete(alert.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>

                <div className="px-4 pb-2">
                  <Accordion type="single" collapsible>
                    <AccordionItem value="details" className="border-0">
                      <AccordionTrigger className="text-xs py-1">Details & History</AccordionTrigger>
                      <AccordionContent>
                        <div className="space-y-2">
                          <div className="bg-muted rounded p-2">
                            <span className="text-[10px] text-muted-foreground block mb-1">Question:</span>
                            <pre className="text-xs whitespace-pre-wrap">{alert.question}</pre>
                          </div>
                          <Button variant="outline" size="sm" className="text-xs" onClick={() => loadExecutions(alert.id)}>
                            Load execution history
                          </Button>
                          {executions[alert.id] && (
                            <ScrollArea className="max-h-40 border rounded">
                              {executions[alert.id].length === 0 ? (
                                <p className="text-xs text-muted-foreground p-3 text-center">No executions yet.</p>
                              ) : (
                                <div className="p-2 space-y-1">
                                  {executions[alert.id].map((ex) => (
                                    <div key={ex.id} className="flex items-center gap-2 text-xs border-b pb-1">
                                      <Badge variant={ex.status === "success" ? "default" : "destructive"} className="text-[9px]">{ex.status}</Badge>
                                      <span className="text-muted-foreground">{new Date(ex.created_at).toLocaleString()}</span>
                                      {ex.duration_ms && <span className="text-muted-foreground">{ex.duration_ms}ms</span>}
                                      {ex.email_sent && <Mail className="h-3 w-3 text-green-500" />}
                                      {ex.error_message && <span className="text-destructive truncate">{ex.error_message}</span>}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </ScrollArea>
                          )}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                </div>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
