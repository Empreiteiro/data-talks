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

const Alerts = () => {
  const { t } = useLanguage();
  const [agentId, setAgentId] = useState("");
  const [alertName, setAlertName] = useState("");
  const [question, setQuestion] = useState("");
  const [email, setEmail] = useState("");
  const [frequency, setFrequency] = useState("daily");
  const [executionTime, setExecutionTime] = useState("09:00");
  const [dayOfWeek, setDayOfWeek] = useState(1); // Monday
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [isCreating, setIsCreating] = useState(false);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: () => dataClient.listAgents()
  });

  const { data: alerts = [] } = useQuery({
    queryKey: ['alerts', agentId],
    queryFn: () => dataClient.listAlerts(agentId || undefined)
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
        frequency === 'monthly' ? dayOfMonth : undefined
      );
      
      // Clear form
      setAlertName("");
      setQuestion("");
      setEmail("");
      setFrequency("daily");
      setExecutionTime("09:00");
      setDayOfWeek(1);
      setDayOfMonth(1);
      
      // Refresh alerts list
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

  return (
    <main className="container py-10">
      <SEO title={`${t('alerts.title')} | ${t('nav.tagline')}`} description="Crie alertas recorrentes" canonical="/alerts" />
      <h1 className="text-3xl font-semibold mb-6">{t('alerts.title')}</h1>

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
          <Card className="shadow-sm">
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
                <Label htmlFor="agent-select">{t('alerts.agent')}</Label>
                <Select value={agentId} onValueChange={setAgentId}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('alerts.selectAgentPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {agents.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name || `${a.id.slice(0,6)}...`}
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
              <div>
                <Label htmlFor="question">{t('alerts.question')}</Label>
                <Input 
                  id="question"
                  placeholder={t('alerts.questionPlaceholder')} 
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

          <div className="grid gap-4">
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
                <Card key={a.id} className="shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center justify-between">
                      <span>{a.name} · <span className="text-muted-foreground">{a.frequency}</span></span>
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

export default Alerts;
