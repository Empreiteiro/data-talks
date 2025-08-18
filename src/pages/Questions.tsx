import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabaseClient } from "@/services/supabaseClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, ThumbsDown, ThumbsUp, Trash2 } from "lucide-react";
import { useState } from "react";

const Questions = () => {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [agentId, setAgentId] = useState("");
  const [question, setQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  function extractBase64Image(answer: string): string | null {
    if (!answer) return null;

    try {
      // Try to parse as JSON first
      const parsed = JSON.parse(answer);
      if (parsed.image && typeof parsed.image === 'string') {
        // If image doesn't start with data:image, add the prefix
        if (parsed.image.startsWith('data:image/')) {
          return parsed.image;
        } else {
          // Assume PNG by default, could be enhanced to detect format
          return `data:image/png;base64,${parsed.image}`;
        }
      }
    } catch {
      // If not JSON, fall back to old logic for backwards compatibility
      const dataUrlRegex = /data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+\/=_\s\r\n]+)/i;
      const dataUrlMatch = answer.match(dataUrlRegex);
      if (dataUrlMatch) {
        return dataUrlMatch[0].replace(/[\s\r\n]+/g, '');
      }
    }

    return null;
  }

  // Remove any base64-encoded image data from text answers so it doesn't render as plain text
  function stripBase64FromText(text: string): string {
    if (!text) return '';
    // 1) Drop fences but keep inner content
    let raw = text.replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, ''));
    // 2) Remove explicit data URLs when they appear on their own lines
    raw = raw.replace(/^\s*data:image\/(png|jpe?g);base64,[A-Za-z0-9+/=\r\n]+\s*$/gmi, '');
    // 3) Remove base64-only lines starting with PNG/JPEG magic headers
    raw = raw.replace(/^\s*iVBORw0KGgo[0-9A-Za-z+/=\r\n]+\s*$/gmi, '');
    raw = raw.replace(/^\s*\/9j\/[0-9A-Za-z+/=\r\n]+\s*$/gmi, '');
    // 4) Remove common JSON fields that hold base64 blobs
    raw = raw.replace(/"(image|image_base64|imageUrl|image_url)"\s*:\s*"(?:data:image\/(?:png|jpe?g);base64,)?[0-9A-Za-z+/=\r\n]+"/gmi, '');
    // Normalize extra blank lines
    raw = raw.replace(/\n{3,}/g, '\n\n').trim();
    return raw;
  }

  // Extract human-readable text from JSON response
  function getDisplayText(answer: string, fallback: string): string {
    if (!answer) return fallback;

    try {
      // Try to parse as JSON and get the text field
      const parsed = JSON.parse(answer);
      if (parsed.text && typeof parsed.text === 'string') {
        return parsed.text.trim();
      }
      // If no text field but is valid JSON, return fallback
      return fallback;
    } catch {
      // If not JSON, return the original answer as-is (for backwards compatibility)
      return answer.trim() || fallback;
    }
  }

  const { data: agents = [] } = useQuery({
    queryKey: ['agents'],
    queryFn: () => supabaseClient.listAgents()
  });

  const { data: sources = [] } = useQuery({
    queryKey: ['sources'],
    queryFn: () => supabaseClient.listSources()
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ['qa-sessions', agentId],
    queryFn: () => supabaseClient.listQASessions(agentId || undefined)
  });

  // Set default agent when agents load
  if (agents.length > 0 && !agentId) {
    setAgentId(agents[0].id);
  }

  // Get current agent's suggested questions
  const currentAgent = agents.find(a => a.id === agentId);
  const suggestedQuestions = currentAgent?.suggested_questions || [];

  // Get columns from connected sources
  const getConnectedSourcesColumns = () => {
    if (!currentAgent || !currentAgent.source_ids) return [];
    
    const connectedSources = sources.filter(source => 
      currentAgent.source_ids.includes(source.id)
    );
    
    const columns: string[] = [];
    connectedSources.forEach(source => {
      if (source.type === 'bigquery' && source.metadata) {
        // For BigQuery sources
        const metadata = source.metadata as any;
        if (metadata.table_infos && Array.isArray(metadata.table_infos)) {
          metadata.table_infos.forEach((tableInfo: any) => {
            if (tableInfo.columns && Array.isArray(tableInfo.columns)) {
              tableInfo.columns.forEach((col: string) => {
                if (!columns.includes(col)) {
                  columns.push(col);
                }
              });
            }
          });
        }
      } else if (source.metadata) {
        // For CSV/JSON sources
        const metadata = source.metadata as any;
        if (metadata.columns && Array.isArray(metadata.columns)) {
          metadata.columns.forEach((col: string) => {
            if (!columns.includes(col)) {
              columns.push(col);
            }
          });
        }
      }
    });
    
    return columns.sort(); // Sort alphabetically
  };

  const availableColumns = getConnectedSourcesColumns();

  async function ask(sessionId?: string) {
    if (!question.trim() || !agentId) return;

    try {
      setIsLoading(true);
      const currentQuestion = question;
      setQuestion('');
      const result = await supabaseClient.askQuestion(agentId, currentQuestion, sessionId);
      
      // Refresh sessions to show the new question
      queryClient.invalidateQueries({ queryKey: ['qa-sessions'] });
      
    } catch (error: any) {
      alert(`${t('questions.error')} ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  }

  async function updateFeedback(sessionId: string, feedback: 'positive' | 'negative') {
    try {
      await supabaseClient.updateQASessionFeedback(sessionId, feedback);
      queryClient.invalidateQueries({ queryKey: ['qa-sessions'] });
    } catch (error: any) {
      alert(`${t('questions.feedbackError')} ${error.message}`);
    }
  }

  return (
    <main className="container py-10">
      <SEO title={`${t('questions.title')} | ${t('nav.tagline')}`} description={t('questions.seoDescription')} canonical="/questions" />
      <h1 className="text-3xl font-semibold mb-6">{t('questions.title')}</h1>

      {agents.length === 0 ? (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>{t('questions.beforeStart')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">{t('questions.createAgentFirst')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium mb-2">{t('questions.agent')}</label>
              <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="w-full border rounded-md px-3 py-2 bg-background">
                {agents.map(a => <option key={a.id} value={a.id}>{a.name || `${a.id.slice(0,6)}...`}</option>)}
              </select>
            </div>
            <div className="grid gap-3 md:grid-cols-[1fr_auto]">
              <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder={t('questions.questionPlaceholder')} disabled={isLoading} />
              <Button onClick={() => ask()} disabled={!question || isLoading} className="min-w-[120px]">
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('questions.processing')}
                  </>
                ) : (
                  t('questions.ask')
                )}
              </Button>
            </div>
            
            {suggestedQuestions.length > 0 && (
              <div className="space-y-2">
                <label className="block text-sm font-medium">{t('questions.suggestedQuestionsLabel')}</label>
                <div className="flex flex-wrap gap-2">
                  {suggestedQuestions.map((suggestedQuestion, index) => (
                    <Button
                      key={index}
                      variant="outline"
                      size="sm"
                      onClick={() => setQuestion(suggestedQuestion)}
                      className="text-sm"
                    >
                      {suggestedQuestion}
                    </Button>
                  ))}
                </div>
              </div>
            )}

            {availableColumns.length > 0 && (
              <div className="space-y-2">
                <label className="block text-sm font-medium">{t('questions.availableColumns')}</label>
                <div className="flex flex-wrap gap-2">
                  {availableColumns.map((column, index) => (
                    <Button
                      key={index}
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        const currentValue = question.trim();
                        const newValue = currentValue ? `${currentValue} ${column}` : column;
                        setQuestion(newValue);
                      }}
                      className="text-sm bg-muted hover:bg-muted/80 text-muted-foreground"
                    >
                      {column}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="grid gap-6">
            {isLoading && (
              <Card className="shadow-sm animate-pulse">
                <CardContent className="pt-6">
                  <div className="flex items-center justify-center space-x-2">
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    <p className="text-muted-foreground">{t('questions.processingQuestion')}</p>
                  </div>
                </CardContent>
              </Card>
            )}
            {sessions.length === 0 && !isLoading ? (
              <Card className="shadow-sm">
                <CardContent className="pt-6">
                  <p className="text-muted-foreground text-center">
                    {t('questions.noQuestionsFound')}
                  </p>
                </CardContent>
              </Card>
            ) : (
              sessions.map((h: any) => (
                <Card key={h.id} className="shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-base">{t('questions.question')}: <span className="text-muted-foreground font-normal">{h.question}</span></CardTitle>
                  </CardHeader>
                   <CardContent className="space-y-4">
                     {/* Main answer */}
                     <div className="prose prose-sm max-w-none">
                       <div className="space-y-2">
        {getDisplayText(h.answer || '', t('questions.answerNotAvailable')).split('\n').map((line: string, index: number) => {
          if (line.trim() === '') return <br key={index} />;
          
          // Check if line contains bullet points and format accordingly
          if (line.startsWith('- ')) {
            return (
              <div key={index} className="flex items-start space-x-2">
                <span className="text-primary font-bold">•</span>
                <span className="flex-1">{line.substring(2)}</span>
              </div>
            );
          }
          
          // Check if line contains bold text markers
          if (line.includes('**')) {
            const parts = line.split('**');
            return (
              <p key={index} className="mb-2 last:mb-0">
                {parts.map((part, partIndex) => 
                  partIndex % 2 === 1 ? 
                    <strong key={partIndex} className="font-semibold text-primary">{part}</strong> : 
                    part
                )}
              </p>
            );
          }
          
          return <p key={index} className="mb-2 last:mb-0">{line}</p>;
        })}
                       </div>
                     </div>
                      {(() => {
                        const img = extractBase64Image(h.answer || '');
                        return (!h.table_data?.image_url && img) ? (
                          <div className="mt-4">
                            <img 
                              src={img} 
                              alt={t('questions.analysisResult')} 
                              className="max-w-full h-auto rounded-lg"
                              loading="lazy"
                            />
                          </div>
                        ) : null;
                      })()}
                      
                      {/* Display base64 image if present in answer or table_data */}
                     {h.table_data?.image_url && (
                       <div className="mt-4">
                         <img 
                           src={h.table_data.image_url} 
                           alt={t('questions.analysisResult')} 
                           className="max-w-full h-auto rounded-lg"
                         />
                       </div>
                     )}

                    {/* Conversation History - Follow-up questions and answers (skip first if it's the same as main question) */}
                    {h.conversation_history && h.conversation_history.length > 0 && (
                      <div className="mt-6 space-y-4">
                        {h.conversation_history.slice(1).map((conversation: any, index: number) => (
                          <div key={index} className="space-y-2">
                            <div className="text-sm">
                              <span className="font-medium">{t('questions.question')}:</span> {conversation.question}
                            </div>
                            <div className="prose prose-sm max-w-none">
                              {getDisplayText(conversation.answer, '').split('\n').map((line: string, lineIndex: number) => (
                                <p key={lineIndex} className="mb-1 last:mb-0 text-sm">{line}</p>
                              ))}
                            </div>
                            {conversation.imageUrl && (
                              <div className="mt-2">
                                <img 
                                  src={conversation.imageUrl} 
                                  alt={t('questions.analysisResult')} 
                                  className="max-w-full h-auto rounded-lg"
                                />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {h.table_data && !h.table_data.image_url && Array.isArray(h.table_data) && (
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              {Object.keys(h.table_data[0] || {}).map((c) => <TableHead key={c}>{c}</TableHead>)}
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {h.table_data.map((row: any, i: number) => (
                              <TableRow key={i}>
                                {Object.keys(h.table_data[0] || {}).map((c) => <TableCell key={c}>{String(row[c])}</TableCell>)}
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                    
                    {/* Follow-up Questions */}
                    {h.follow_up_questions && h.follow_up_questions.length > 0 && (
                      <div className="space-y-2">
                        <label className="block text-sm font-medium">{t('questions.followUpQuestions')}</label>
                        <div className="flex flex-wrap gap-2">
                          {h.follow_up_questions.map((followUpQuestion: string, index: number) => (
                            <Button
                              key={index}
                              variant="outline"
                              size="sm"
                            onClick={() => {
                              setQuestion(followUpQuestion);
                              setTimeout(() => ask(h.id), 0);
                            }}
                              className="text-sm"
                            >
                              {followUpQuestion}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Button 
                          variant={h.feedback === 'positive' ? 'default' : 'ghost'} 
                          size="sm" 
                          aria-label={t('questions.positiveFeedbackLabel')}
                          onClick={() => updateFeedback(h.id, 'positive')}
                        >
                          <ThumbsUp />
                        </Button>
                        <Button 
                          variant={h.feedback === 'negative' ? 'default' : 'ghost'} 
                          size="sm" 
                          aria-label={t('questions.negativeFeedbackLabel')}
                          onClick={() => updateFeedback(h.id, 'negative')}
                        >
                          <ThumbsDown />
                        </Button>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={t('questions.deleteQuestionLabel')}
                        onClick={async () => { 
                          if (confirm(t('questions.deleteQuestionConfirm'))) {
                            try {
                              await supabaseClient.deleteQASession(h.id);
                              queryClient.invalidateQueries({ queryKey: ['qa-sessions'] });
                            } catch (e: any) {
                              alert(e.message);
                            }
                          }
                        }}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    <div className="flex items-center justify-between">
                                          <p className="text-xs text-muted-foreground">
                      {new Date(h.created_at).toLocaleString(t('questions.dateFormat'))} · {t('questions.status')}: {h.status}
                    </p>
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

export default Questions;
