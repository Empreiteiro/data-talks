import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useLanguage } from "@/contexts/LanguageContext";
import { useToast } from "@/hooks/use-toast";
import { supabaseClient } from "@/services/supabaseClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Plus, Save, Share, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
const AgentBriefing = () => {
  const { t } = useLanguage();
  const {
    toast
  } = useToast();
  const queryClient = useQueryClient();
  const [agentId, setAgentId] = useState<string>("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedSource, setSelectedSource] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [shareEnabled, setShareEnabled] = useState(false);
  const [sharePassword, setSharePassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [suggestedQuestions, setSuggestedQuestions] = useState<string[]>([]);
  const [newQuestion, setNewQuestion] = useState("");
  const {
    data: sources = []
  } = useQuery({
    queryKey: ['sources'],
    queryFn: () => supabaseClient.listSources()
  });
  const {
    data: agents = []
  } = useQuery({
    queryKey: ['agents'],
    queryFn: () => supabaseClient.listAgents()
  });
  const currentAgent = useMemo(() => agentId ? agents.find(a => a.id === agentId) : undefined, [agentId, agents]);
  const [shareLink, setShareLink] = useState("");
  
  const isNewAgent = !agentId;
  const canSave = name.trim().length > 0 && selectedSource.length > 0;
  
  useEffect(() => {
    if (currentAgent) {
      setName(currentAgent.name || "");
      setDescription(currentAgent.description || "");
      setSelectedSource(currentAgent.source_ids?.[0] || "");
      setShareEnabled(currentAgent.has_share_token || false);
      setSharePassword(currentAgent.has_password ? "******" : "");
      setSuggestedQuestions((currentAgent as any).suggested_questions || []);
      
      // Get share token if sharing is enabled
      if (currentAgent.has_share_token) {
        supabaseClient.getAgentShareToken(currentAgent.id).then(token => {
          if (token) {
            setShareLink(`${window.location.origin}/share/${token}`);
          }
        });
      } else {
        setShareLink("");
      }
    } else {
      setName("");
      setDescription("");
      setSelectedSource("");
      setSharePassword("");
      setShareEnabled(false);
      setShareLink("");
      setSuggestedQuestions([]);
    }
  }, [currentAgent]);
  async function deleteAgent() {
    if (!agentId) return;
    if (confirm(t('agent.deleteConfirm', { name: currentAgent?.name || agentId }))) {
      try {
        setIsLoading(true);
        await supabaseClient.deleteAgent(agentId);
        queryClient.invalidateQueries({
          queryKey: ['agents']
        });
        setAgentId("");
        toast({
          title: t('agent.deleted'),
          description: t('agent.deletedSuccess')
        });
      } catch (e: any) {
        toast({
          title: t('agent.error'),
          description: e.message,
          variant: "destructive"
        });
      } finally {
        setIsLoading(false);
      }
    }
  }
  async function save() {
    if (!canSave) return;
    try {
      setIsLoading(true);
      if (isNewAgent) {
        await supabaseClient.createAgent(name, [selectedSource], description, suggestedQuestions);
        toast({
          title: t('agent.saved'),
          description: t('agent.savedSuccess')
        });
      } else {
        await supabaseClient.updateAgent(agentId, name, [selectedSource], description, suggestedQuestions);
        toast({
          title: t('agent.saved'),
          description: t('agent.savedSuccess')
        });
      }
      queryClient.invalidateQueries({
        queryKey: ['agents']
      });
    } catch (e: any) {
      toast({
        title: t('agent.error'),
        description: e.message,
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  }
  function selectSource(sourceId: string) {
    setSelectedSource(sourceId);
  }

  function addSuggestedQuestion() {
    if (newQuestion.trim() && !suggestedQuestions.includes(newQuestion.trim())) {
      setSuggestedQuestions([...suggestedQuestions, newQuestion.trim()]);
      setNewQuestion("");
    }
  }

  function removeSuggestedQuestion(index: number) {
    setSuggestedQuestions(suggestedQuestions.filter((_, i) => i !== index));
  }

  async function toggleSharing(enabled: boolean) {
    if (!currentAgent) return;
    
    try {
      setIsLoading(true);
      const result = await supabaseClient.toggleAgentSharing(currentAgent.id, enabled, enabled ? sharePassword : undefined);
      setShareEnabled(enabled);
      
      // Update share link if sharing was enabled
      if (enabled && result?.share_token) {
        setShareLink(`${window.location.origin}/share/${result.share_token}`);
      } else {
        setShareLink("");
      }
      
      if (!enabled) {
        setSharePassword("");
      }
      
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      
      toast({
        title: enabled ? t('agent.sharingEnabled') : t('agent.sharingDisabled'),
        description: enabled ? t('agent.sharingEnabledSuccess') : t('agent.sharingDisabledSuccess')
      });
    } catch (e: any) {
      toast({
        title: t('agent.error'),
        description: e.message,
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  }

  async function updateSharePassword() {
    if (!currentAgent) return;
    
    try {
      setIsLoading(true);
      await supabaseClient.updateAgentSharePassword(currentAgent.id, sharePassword);
      
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      
      toast({
        title: t('agent.passwordUpdated'),
        description: t('agent.passwordUpdatedSuccess')
      });
    } catch (e: any) {
      toast({
        title: t('agent.error'),
        description: e.message,
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  }
  return <main className="container py-10">
      <SEO title={`${t('agent.title')} | ${t('nav.tagline')}`} description="Defina o contexto e ative o agente" canonical="/agent" />
      <h1 className="text-3xl font-semibold mb-6">{t('agent.title')}</h1>
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('agent.title')}</CardTitle>
          {currentAgent && <Button variant="ghost" size="sm" onClick={deleteAgent} className="text-destructive hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </Button>}
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>{t('agent.name')}</Label>
            <select value={agentId} onChange={e => setAgentId(e.target.value)} className="w-full border rounded-md px-3 py-2 bg-background" disabled={isLoading}>
              <option value="">{t('agent.newAgent')}</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name || `${a.id.slice(0, 6)}...`}</option>)}
            </select>
          </div>

          <div className="space-y-2">
            <Label>{t('agent.name')}</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Análises de Vendas 2025" disabled={isLoading} />
          </div>

          <div className="space-y-2">
            <Label>{t('agent.description')}</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder={t('agent.descriptionPlaceholder')} rows={3} disabled={isLoading} />
          </div>

          <div className="space-y-3">
            <Label>{t('agent.dataSource')}</Label>
            {sources.length === 0 ? <p className="text-muted-foreground">{t('agent.noDataSourcesFound')}</p> : <div className="grid gap-3">
                {sources.map((source: any) => <div key={source.id} className={`flex items-center space-x-3 p-3 rounded-lg border cursor-pointer transition-colors ${selectedSource === source.id ? 'bg-primary/10 border-primary' : 'bg-card hover:bg-muted/50'}`} onClick={() => selectSource(source.id)}>
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${selectedSource === source.id ? 'border-primary bg-primary' : 'border-muted-foreground'}`}>
                      {selectedSource === source.id && <div className="w-2 h-2 rounded-full bg-primary-foreground"></div>}
                    </div>
                    <div className="flex-1">
                      <Label className="text-sm font-medium cursor-pointer">
                        {source.name}
                      </Label>
                      <div className="text-xs text-muted-foreground mt-1">
                        Tipo: {source.type.toUpperCase()}
                        {source.metadata?.row_count && <span> • {source.metadata.row_count.toLocaleString()} linhas</span>}
                        {source.metadata?.total_tables && <span> • {source.metadata.total_tables} tabela(s)</span>}
                      </div>
                    </div>
                  </div>)}
              </div>}
            <p className="text-xs text-muted-foreground">
              {t('agent.selectDataSourceHelp')}
            </p>
          </div>

          <div className="space-y-3">
            <Label>{t('agent.suggestedQuestions')}</Label>
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input 
                  value={newQuestion} 
                  onChange={(e) => setNewQuestion(e.target.value)}
                  placeholder={t('agent.questionPlaceholder')}
                  disabled={isLoading}
                  onKeyPress={(e) => e.key === 'Enter' && addSuggestedQuestion()}
                />
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={addSuggestedQuestion}
                  disabled={!newQuestion.trim() || isLoading}
                >
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              
              {suggestedQuestions.length > 0 && (
                <div className="space-y-2">
                  {suggestedQuestions.map((question, index) => (
                    <div key={index} className="flex items-center justify-between p-3 bg-muted/30 rounded-lg border">
                      <span className="text-sm">{question}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeSuggestedQuestion(index)}
                        disabled={isLoading}
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {t('agent.addSuggestedQuestionsHelp')}
            </p>
          </div>

          {currentAgent && (
            <Card className="bg-muted/50">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Share className="h-5 w-5" />
                  {t('agent.sharing')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-medium">{t('agent.enableSharing')}</Label>
                    <p className="text-xs text-muted-foreground">
                      {t('agent.enableSharingHelp')}
                    </p>
                  </div>
                  <Switch
                    checked={shareEnabled}
                    onCheckedChange={toggleSharing}
                    disabled={isLoading}
                  />
                </div>

                {shareEnabled && (
                  <div className="space-y-4 pt-4 border-t">
                    <div className="space-y-2">
                      <Label>{t('agent.shareLink')}</Label>
                      <div className="flex items-center gap-2">
                        <Input 
                          readOnly 
                          value={shareLink} 
                          aria-label="Link compartilhável do agente"
                          className="font-mono text-sm" 
                        />
                        <Button 
                          type="button" 
                          variant="secondary" 
                          onClick={() => {
                            navigator.clipboard.writeText(shareLink);
                            toast({
                              title: t('agent.linkCopied'),
                              description: t('agent.linkCopiedDescription')
                            });
                          }} 
                          disabled={isLoading}
                        >
                          {t('agent.copyLink')}
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>{t('agent.sharePassword')}</Label>
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Input
                            type={showPassword ? "text" : "password"}
                            value={sharePassword}
                            onChange={(e) => setSharePassword(e.target.value)}
                            placeholder={t('agent.sharePasswordPlaceholder')}
                            disabled={isLoading}
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="absolute right-1 top-1 h-8 w-8 p-0"
                            onClick={() => setShowPassword(!showPassword)}
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </Button>
                        </div>
                        <Button 
                          type="button" 
                          variant="outline" 
                          onClick={updateSharePassword}
                          disabled={isLoading}
                        >
                          {t('agent.save')}
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {sharePassword ? t('agent.passwordProtected') : t('agent.publicAccess')}
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <div className="flex gap-2">
            <Button onClick={save} disabled={!canSave || isLoading} className="flex items-center gap-2">
              {isNewAgent ? <Plus className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {isNewAgent ? t('agent.createAgent') : t('agent.saveChanges')}
            </Button>
            
            
          </div>
        </CardContent>
      </Card>
    </main>;
};
export default AgentBriefing;