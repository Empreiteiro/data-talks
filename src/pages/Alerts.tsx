import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { dataClient } from "@/services/dataClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { usePageWalkthrough } from "@/contexts/WalkthroughContext";
import { alertsSteps } from "@/components/walkthrough/steps/alertsSteps";

const Alerts = () => {
  const { t } = useLanguage();
  const [agentId, setAgentId] = useState("");
  const [alertName, setAlertName] = useState("");
  const [alertType, setAlertType] = useState("alert");
  const [question, setQuestion] = useState("");
  const [email, setEmail] = useState("");
  const [frequency, setFrequency] = useState("daily");
  const [executionTime, setExecutionTime] = useState("09:00");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [isCreating, setIsCreating] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [expandedAlertId, setExpandedAlertId] = useState<string | null>(null);

  // Webhooks state
  const [showWebhookForm, setShowWebhookForm] = useState(false);
  const [webhookName, setWebhookName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");

  const { toast } = useToast();
  const queryClient = useQueryClient();
  usePageWalkthrough('alerts', alertsSteps);

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: () => dataClient.listAgents()
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ['alerts', agentId],
    queryFn: () => dataClient.listAlerts(agentId || undefined)
  });

  const { data: webhooks = [] } = useQuery({
    queryKey: ['webhooks'],
    queryFn: () => dataClient.listWebhooks()
  });

  // Set default agent when agents load
  if (agents.length > 0 && !agentId) {
    setAgentId(agents[0].id);
  }

  async function createAlert() {
    if (!agentId || !alertName || !question || !email) {
      toast({
        title: t('alerts.error'),
        description: t('alerts.fillRequiredFields'),
        variant: "destructive"
      });
      return;
    }

    try {
      setIsCreating(true);
      await dataClient.createAlert(
        agentId,
        alertName,
        question,
        email,
        frequency,
        executionTime,
        frequency === 'weekly' ? dayOfWeek : undefined,
        frequency === 'monthly' ? dayOfMonth : undefined,
        alertType
      );

      setAlertName("");
      setQuestion("");
      setEmail("");
      setFrequency("daily");
      setAlertType("alert");
      setExecutionTime("09:00");
      setDayOfWeek(1);
      setDayOfMonth(1);

      queryClient.invalidateQueries({ queryKey: ['alerts'] });

      toast({
        title: t('alerts.success'),
        description: t('alerts.alertCreated')
      });
    } catch (error) {
      toast({
        title: t('alerts.error'),
        description: error.message || t('alerts.errorCreatingAlert'),
        variant: "destructive"
      });
    } finally {
      setIsCreating(false);
    }
  }

  async function handleTestAlert(alertId: string) {
    setTestingId(alertId);
    try {
      const result = await dataClient.testAlert(alertId);
      toast({
        title: result.status === 'success' ? t('alerts.success') : t('alerts.error'),
        description: result.status === 'success'
          ? t('alerts.testSuccess')
          : (result.error || t('alerts.testFailed')),
        variant: result.status === 'success' ? 'default' : 'destructive',
      });
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    } catch (error) {
      toast({
        title: t('alerts.error'),
        description: error.message || t('alerts.testFailed'),
        variant: "destructive"
      });
    } finally {
      setTestingId(null);
    }
  }

  async function handleToggleActive(alertId: string, currentActive: boolean) {
    try {
      await dataClient.updateAlert(alertId, { is_active: !currentActive });
      queryClient.invalidateQueries({ queryKey: ['alerts'] });
    } catch (error) {
      toast({ title: t('alerts.error'), description: error.message, variant: "destructive" });
    }
  }

  async function createWebhook() {
    if (!webhookName || !webhookUrl) {
      toast({ title: t('alerts.error'), description: t('alerts.fillRequiredFields'), variant: "destructive" });
      return;
    }
    try {
      await dataClient.createWebhook({ name: webhookName, url: webhookUrl });
      setWebhookName("");
      setWebhookUrl("");
      setShowWebhookForm(false);
      queryClient.invalidateQueries({ queryKey: ['webhooks'] });
      toast({ title: t('alerts.success'), description: t('alerts.webhookCreated') });
    } catch (error) {
      toast({ title: t('alerts.error'), description: error.message, variant: "destructive" });
    }
  }

  return (
    <main className="container py-10">
      <SEO title={`${t('alerts.title')} | ${t('nav.tagline')}`} description="Crie alertas recorrentes" canonical="/alerts" />
      <h1 className="text-3xl font-semibold mb-6" data-walkthrough="alerts-header">{t('alerts.title')}</h1>

      {agents.length === 0 ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>{t('alerts.beforeStart')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">{t('alerts.createAgentFirst')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {/* Create Alert Form */}
          <Card className="shadow-sm" data-walkthrough="alerts-form">
            <CardHeader>
              <CardTitle>{t('alerts.newAlert')}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div>
                <Label htmlFor="alert-name">{t('alerts.alertName')}</Label>
                <Input
                  id="alert-name"
                  placeholder={t('alerts.alertNamePlaceholder')}
                  value={alertName}
                  onChange={(e) => setAlertName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="alert-type">{t('alerts.alertType')}</Label>
                <Select value={alertType} onValueChange={setAlertType}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="alert">{t('alerts.typeAlert')}</SelectItem>
                    <SelectItem value="report">{t('alerts.typeReport')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="agent-select">{t('alerts.agent')}</Label>
                <Select value={agentId} onValueChange={setAgentId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('alerts.selectAgentPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name || `${a.id.slice(0, 6)}...`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="email">{t('alerts.email')}</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder={t('alerts.emailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="md:col-span-2">
                <Label htmlFor="question">{t('alerts.question')}</Label>
                <Input
                  id="question"
                  placeholder={alertType === 'report' ? t('alerts.reportQuestionPlaceholder') : t('alerts.questionPlaceholder')}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="frequency">{t('alerts.frequency')}</Label>
                <Select value={frequency} onValueChange={setFrequency}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">{t('alerts.daily')}</SelectItem>
                    <SelectItem value="weekly">{t('alerts.weekly')}</SelectItem>
                    <SelectItem value="monthly">{t('alerts.monthly')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label htmlFor="execution-time">{t('alerts.executionTime')}</Label>
                <Input
                  id="execution-time"
                  type="time"
                  value={executionTime}
                  onChange={(e) => setExecutionTime(e.target.value)}
                />
              </div>
              {frequency === 'weekly' && (
                <div>
                  <Label htmlFor="day-of-week">{t('alerts.dayOfWeek')}</Label>
                  <Select value={dayOfWeek.toString()} onValueChange={(value) => setDayOfWeek(parseInt(value))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">{t('alerts.sunday')}</SelectItem>
                      <SelectItem value="1">{t('alerts.monday')}</SelectItem>
                      <SelectItem value="2">{t('alerts.tuesday')}</SelectItem>
                      <SelectItem value="3">{t('alerts.wednesday')}</SelectItem>
                      <SelectItem value="4">{t('alerts.thursday')}</SelectItem>
                      <SelectItem value="5">{t('alerts.friday')}</SelectItem>
                      <SelectItem value="6">{t('alerts.saturday')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {frequency === 'monthly' && (
                <div>
                  <Label htmlFor="day-of-month">{t('alerts.dayOfMonth')}</Label>
                  <Select value={dayOfMonth.toString()} onValueChange={(value) => setDayOfMonth(parseInt(value))}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 31 }, (_, i) => i + 1).map((day) => (
                        <SelectItem key={day} value={day.toString()}>
                          {day}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="md:col-span-2">
                <Button onClick={createAlert} disabled={isCreating}>
                  {isCreating ? t('alerts.creating') : t('alerts.createAlert')}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Alerts List */}
          <div className="grid gap-4">
            <h2 className="text-xl font-semibold">{t('alerts.activeAlerts')}</h2>
            {alerts.length === 0 ? (
              <Card className="shadow-sm">
                <CardContent className="pt-6">
                  <p className="text-muted-foreground text-center">
                    {t('alerts.noAlerts')}
                  </p>
                </CardContent>
              </Card>
            ) : (
              alerts.map((a) => (
                <Card key={a.id} className={`shadow-sm ${!a.is_active ? 'opacity-60' : ''}`}>
                  <CardHeader>
                    <CardTitle className="text-base flex items-center justify-between">
                      <span>
                        <span className={`inline-block w-2 h-2 rounded-full mr-2 ${a.last_status === 'error' ? 'bg-red-500' : a.last_status === 'success' ? 'bg-green-500' : 'bg-gray-300'}`} />
                        {a.name}
                        <span className="text-muted-foreground ml-2 text-xs uppercase">
                          {a.type === 'report' ? t('alerts.typeReport') : t('alerts.typeAlert')}
                        </span>
                        <span className="text-muted-foreground ml-2">· {a.frequency}</span>
                      </span>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleToggleActive(a.id, a.is_active !== false)}
                        >
                          {a.is_active !== false ? t('alerts.pause') : t('alerts.resume')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={testingId === a.id}
                          onClick={() => handleTestAlert(a.id)}
                        >
                          {testingId === a.id ? t('alerts.testing') : t('alerts.test')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setExpandedAlertId(expandedAlertId === a.id ? null : a.id)}
                        >
                          {t('alerts.history')}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => dataClient.deleteAlert(a.id).then(() => {
                            queryClient.invalidateQueries({ queryKey: ['alerts'] });
                            toast({
                              title: t('alerts.success'),
                              description: t('alerts.alertRemoved')
                            });
                          })}
                        >
                          {t('alerts.remove')}
                        </Button>
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-sm">
                      <strong>{t('alerts.question')}:</strong> {a.question}
                    </div>
                    <div className="text-sm">
                      <strong>{t('alerts.email')}:</strong> {a.email}
                    </div>
                    <div className="text-sm">
                      <strong>{t('alerts.scheduleField')}</strong> {a.frequency === 'daily' ? t('alerts.daily') :
                        a.frequency === 'weekly' ? t('alerts.weekly') : t('alerts.monthly')} {t('alerts.at')} {a.execution_time || '09:00'}
                      {a.frequency === 'weekly' && a.day_of_week !== null && (
                        <span> - {[t('alerts.sunday'), t('alerts.monday'), t('alerts.tuesday'), t('alerts.wednesday'), t('alerts.thursday'), t('alerts.friday'), t('alerts.saturday')][a.day_of_week]}</span>
                      )}
                      {a.frequency === 'monthly' && a.day_of_month && (
                        <span> - {t('alerts.day')} {a.day_of_month}</span>
                      )}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {t('alerts.createdAt')} {new Date(a.created_at).toLocaleString('pt-BR')}
                      {a.next_run && (
                        <span> · {t('alerts.nextExecution')} {new Date(a.next_run).toLocaleString('pt-BR')}</span>
                      )}
                      {a.last_run && (
                        <span> · {t('alerts.lastRun')} {new Date(a.last_run).toLocaleString('pt-BR')}
                          {a.last_status && <span className={a.last_status === 'success' ? 'text-green-600' : 'text-red-600'}> ({a.last_status})</span>}
                        </span>
                      )}
                    </div>

                    {/* Execution History */}
                    {expandedAlertId === a.id && (
                      <AlertExecutionHistory alertId={a.id} />
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {/* Webhooks Section */}
          <div className="space-y-4" data-walkthrough="alerts-webhooks">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">{t('alerts.webhooks')}</h2>
              <Button variant="outline" onClick={() => setShowWebhookForm(!showWebhookForm)}>
                {showWebhookForm ? t('alerts.cancel') : t('alerts.addWebhook')}
              </Button>
            </div>

            {showWebhookForm && (
              <Card className="shadow-sm">
                <CardContent className="pt-6 grid gap-4 md:grid-cols-2">
                  <div>
                    <Label>{t('alerts.webhookName')}</Label>
                    <Input
                      placeholder={t('alerts.webhookNamePlaceholder')}
                      value={webhookName}
                      onChange={(e) => setWebhookName(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>{t('alerts.webhookUrl')}</Label>
                    <Input
                      placeholder="https://example.com/webhook"
                      value={webhookUrl}
                      onChange={(e) => setWebhookUrl(e.target.value)}
                    />
                  </div>
                  <div className="md:col-span-2">
                    <Button onClick={createWebhook}>{t('alerts.createWebhook')}</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {webhooks.length === 0 && !showWebhookForm ? (
              <Card className="shadow-sm">
                <CardContent className="pt-6">
                  <p className="text-muted-foreground text-center">{t('alerts.noWebhooks')}</p>
                </CardContent>
              </Card>
            ) : (
              webhooks.map((w) => (
                <Card key={w.id} className={`shadow-sm ${!w.is_active ? 'opacity-60' : ''}`}>
                  <CardContent className="pt-6 flex items-center justify-between">
                    <div className="space-y-1">
                      <div className="font-medium">{w.name}</div>
                      <div className="text-sm text-muted-foreground">{w.url}</div>
                      <div className="text-xs text-muted-foreground">
                        {t('alerts.events')}: {w.events.join(', ')}
                        {w.last_triggered_at && (
                          <span> · {t('alerts.lastTriggered')} {new Date(w.last_triggered_at).toLocaleString('pt-BR')}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          await dataClient.updateWebhook(w.id, { is_active: !w.is_active });
                          queryClient.invalidateQueries({ queryKey: ['webhooks'] });
                        }}
                      >
                        {w.is_active ? t('alerts.pause') : t('alerts.resume')}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={async () => {
                          await dataClient.deleteWebhook(w.id);
                          queryClient.invalidateQueries({ queryKey: ['webhooks'] });
                          toast({ title: t('alerts.success'), description: t('alerts.webhookRemoved') });
                        }}
                      >
                        {t('alerts.remove')}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))
            )}
          </div>
        </div>
      )}
    </main>
  );
};

function AlertExecutionHistory({ alertId }: { alertId: string }) {
  const { t } = useLanguage();
  const { data: executions = [], isLoading } = useQuery({
    queryKey: ['alert-executions', alertId],
    queryFn: () => dataClient.listAlertExecutions(alertId, 10),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">{t('common.loading')}</p>;
  if (executions.length === 0) return <p className="text-sm text-muted-foreground">{t('alerts.noExecutions')}</p>;

  return (
    <div className="mt-4 border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left font-medium">{t('alerts.executionDate')}</th>
            <th className="px-3 py-2 text-left font-medium">{t('alerts.status')}</th>
            <th className="px-3 py-2 text-left font-medium">{t('alerts.emailSent')}</th>
            <th className="px-3 py-2 text-left font-medium">{t('alerts.webhooksFired')}</th>
            <th className="px-3 py-2 text-left font-medium">{t('alerts.duration')}</th>
          </tr>
        </thead>
        <tbody>
          {executions.map((ex) => (
            <tr key={ex.id} className="border-t">
              <td className="px-3 py-2">{new Date(ex.created_at).toLocaleString('pt-BR')}</td>
              <td className="px-3 py-2">
                <span className={ex.status === 'success' ? 'text-green-600' : 'text-red-600'}>
                  {ex.status}
                </span>
              </td>
              <td className="px-3 py-2">{ex.email_sent ? 'Yes' : 'No'}</td>
              <td className="px-3 py-2">{ex.webhooks_fired}</td>
              <td className="px-3 py-2">{ex.duration_ms ? `${(ex.duration_ms / 1000).toFixed(1)}s` : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default Alerts;
