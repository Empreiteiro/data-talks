import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLanguage } from "@/contexts/LanguageContext";
import { supabaseClient } from "@/services/supabaseClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2, X } from "lucide-react";
import { useRef, useState } from "react";

const Sources = () => {
  const { t } = useLanguage();
  const [files, setFiles] = useState<File[]>([]);
  const [loading, setLoading] = useState(false);
  const credRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const { data: sources = [] } = useQuery({
    queryKey: ['sources'],
    queryFn: () => supabaseClient.listSources()
  });

  async function handleDelete(sourceId: string) {
    if (confirm(t('sources.deleteConfirm'))) {
      try {
        await supabaseClient.deleteSource(sourceId);
        queryClient.invalidateQueries({ queryKey: ['sources'] });
      } catch (e: any) {
        alert(e.message);
      }
    }
  }

  async function handleUpload() {
    if (!files.length) return;
    
    setLoading(true);
    try {
      for (const file of files) {
        await supabaseClient.uploadFile(file);
      }
      setFiles([]);
      queryClient.invalidateQueries({ queryKey: ['sources'] });
    } catch (e: any) {
      alert(`${t('sources.uploadError')} ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleBQ(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    
    try {
      const form = e.currentTarget;
      const formData = new FormData(form);
      const project = formData.get('project') as string;
      const dataset = formData.get('dataset') as string;
      const tablesInput = formData.get('tables') as string;
      const credentialsFile = credRef.current?.files?.[0];
      
      if (!credentialsFile) {
        alert(t('sources.selectCredentialsFile'));
        return;
      }
      
      if (!project || !dataset || !tablesInput) {
        alert(t('sources.fillRequiredFields'));
        return;
      }
      
      const tables = tablesInput.split(',').map(t => t.trim()).filter(t => t);
      const credentials = await credentialsFile.text();
      
      const result = await supabaseClient.connectBigQuery(credentials, project, dataset, tables);
      
      // Clear form safely
      if (form) {
        form.reset();
      }
      if (credRef.current) {
        credRef.current.value = '';
      }
      
      // Refresh sources list
      queryClient.invalidateQueries({ queryKey: ['sources'] });
      
      alert(`${t('sources.bigQueryConnected')} ${result.source?.name}`);
      
    } catch (error: any) {
      console.error('BigQuery connection error:', error);
      
      // Extract more specific error information
      let errorMessage = t('sources.unknownError');
      if (error.message) {
        errorMessage = error.message;
      } else if (typeof error === 'string') {
        errorMessage = error;
      }
      
      alert(`${t('sources.bigQueryError')} ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="container py-10">
      <SEO title={`${t('sources.title')} | ${t('nav.tagline')}`} description="Envie CSV/XLSX ou conecte seu BigQuery" canonical="/sources" />
      <h1 className="text-3xl font-semibold mb-6">{t('sources.title')}</h1>
      <Tabs defaultValue="files" className="mb-8">
        <TabsList>
          <TabsTrigger value="files">{t('sources.filesTab')}</TabsTrigger>
          <TabsTrigger value="bq">{t('sources.bigQueryTab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="files" className="mt-6">
          <div className="grid gap-4 md:grid-cols-[1fr_auto]">
            <Input type="file" accept=".csv,.xlsx,.xls" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} />
            <Button onClick={handleUpload} disabled={!files.length || loading}>{loading ? t('sources.uploading') : t('sources.uploadButton')}</Button>
          </div>
          {files.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {files.map((f, idx) => (
                <span
                  key={`${f.name}-${f.size}-${f.lastModified}`}
                  className="inline-flex items-center gap-2 rounded-md bg-secondary text-secondary-foreground px-2.5 py-1 text-xs"
                >
                  <span className="font-medium">{f.name}</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-1"
                    aria-label={`${t('sources.removeFile')} ${f.name}`}
                    onClick={() => setFiles(prev => prev.filter((_, i) => i !== idx))}
                  >
                    <X className="h-3 w-3" />
                  </Button>
                </span>
              ))}
            </div>
          )}
        </TabsContent>
        <TabsContent value="bq" className="mt-6">
          <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg">
            <h3 className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-3">
              {t('sources.bigQueryInstructions')}
            </h3>
            <div className="grid gap-2 text-sm text-blue-700 dark:text-blue-300">
              <div>{t('sources.bigQueryStep1')}</div>
              <div>{t('sources.bigQueryStep2')}</div>
              <div>{t('sources.bigQueryStep3')}</div>
              <div>{t('sources.bigQueryStep4')}</div>
              <div>{t('sources.bigQueryStep5')}</div>
              <div>{t('sources.bigQueryStep6')}</div>
              <div>{t('sources.bigQueryStep7')}</div>
              <div>{t('sources.bigQueryStep8')}</div>
            </div>
            <div className="mt-3">
              <a 
                href="https://cloud.google.com/docs/authentication/getting-started" 
                target="_blank" 
                rel="noopener noreferrer"
                className="text-sm text-blue-600 dark:text-blue-400 hover:underline"
              >
                {t('sources.bigQueryDocsLink')} →
              </a>
            </div>
          </div>
          <form onSubmit={handleBQ} className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>{t('sources.credentials')}</Label>
              <Input type="file" accept="application/json" ref={credRef} />
            </div>
            <div className="space-y-2">
              <Label>{t('sources.project')}</Label>
              <Input name="project" placeholder={t('sources.projectPlaceholder')} />
            </div>
            <div className="space-y-2">
              <Label>{t('sources.dataset')}</Label>
              <Input name="dataset" placeholder={t('sources.datasetPlaceholder')} />
            </div>
            <div className="space-y-2 md:col-span-2">
              <Label>{t('sources.allowedTables')}</Label>
              <Input name="tables" placeholder={t('sources.tablesPlaceholder')} />
            </div>
            <div className="md:col-span-2">
              <Button type="submit" disabled={loading}>
                {loading ? t('sources.connecting') : t('sources.connectBigQuery')}
              </Button>
            </div>
          </form>
        </TabsContent>
      </Tabs>

      <div className="grid gap-6">
        {sources.length === 0 ? (
          <Card className="shadow-sm">
            <CardContent className="pt-6">
              <p className="text-muted-foreground text-center">
                {t('sources.noSourcesFound')}
              </p>
            </CardContent>
          </Card>
        ) : (
          sources.map((s: any) => (
            <Card key={s.id} className="shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{s.name} <span className="text-sm text-muted-foreground">[{s.type}]</span></CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleDelete(s.id)}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="text-sm text-muted-foreground">
                    {t('sources.createdAt')} {new Date(s.created_at).toLocaleString('pt-BR')}
                  </div>
                  
                  {s.metadata && (
                    <div className="space-y-3">
                      {/* Langflow integration info */}
                      {(s.langflow_path || s.langflow_name) && (
                        <div className="border rounded-lg p-3 bg-muted/30">
                          <div className="text-sm font-medium mb-2 text-primary">
                            {t('sources.langflowIntegration')}
                          </div>
                          {s.langflow_name && (
                            <div className="text-sm">
                              <span className="font-medium">{t('sources.langflowName')}</span> {s.langflow_name}
                            </div>
                          )}
                          {s.langflow_path && (
                            <div className="text-sm">
                              <span className="font-medium">{t('sources.langflowPath')}</span> 
                              <span className="ml-1 font-mono text-xs text-muted-foreground">
                                {s.langflow_path}
                              </span>
                            </div>
                          )}
                        </div>
                      )}
                      
                      {!s.langflow_path && !s.langflow_name && s.type !== 'bigquery' && (
                        <div className="border rounded-lg p-3 bg-yellow-50 dark:bg-yellow-950/30 border-yellow-200 dark:border-yellow-800">
                          <div className="text-sm text-yellow-800 dark:text-yellow-200">
                            <span className="font-medium">{t('sources.warning')}</span> {t('sources.fileNotUploaded')}
                          </div>
                        </div>
                      )}
                      
                    </div>
                  )}
                  
                  {s.metadata && (
                    <div className="space-y-3">
                      {/* CSV/Excel file info */}
                      {s.type !== 'bigquery' && s.metadata.row_count > 0 && (
                        <div className="text-sm">
                          <span className="font-medium">{t('sources.rows')}</span> {s.metadata.row_count.toLocaleString('pt-BR')}
                        </div>
                      )}
                      
                      {s.type !== 'bigquery' && s.metadata.columns && s.metadata.columns.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-sm font-medium">{t('sources.columns')} ({s.metadata.columns.length}):</div>
                          <div className="flex flex-wrap gap-1">
                            {s.metadata.columns.map((col: string, idx: number) => (
                              <span key={idx} className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                                {col}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      
                      {s.type !== 'bigquery' && s.metadata.preview_rows && s.metadata.preview_rows.length > 0 && (
                        <div className="space-y-2">
                          <div className="text-sm font-medium">{t('sources.firstRows')}</div>
                          <div className="overflow-x-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  {s.metadata.columns?.map((col: string, idx: number) => (
                                    <TableHead key={idx} className="text-xs">{col}</TableHead>
                                  ))}
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {s.metadata.preview_rows.slice(0, 3).map((row: any, rowIdx: number) => (
                                  <TableRow key={rowIdx}>
                                    {s.metadata.columns?.map((col: string, colIdx: number) => (
                                      <TableCell key={colIdx} className="text-xs max-w-32 truncate">
                                        {row[col]?.toString() || '-'}
                                      </TableCell>
                                    ))}
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        </div>
                      )}

                      {/* BigQuery table info */}
                      {s.type === 'bigquery' && s.metadata.table_infos && (
                        <div className="space-y-4">
                          <div className="text-sm">
                            <span className="font-medium">{t('sources.project')}:</span> {s.metadata.project_id}
                          </div>
                          <div className="text-sm">
                            <span className="font-medium">{t('sources.dataset')}:</span> {s.metadata.dataset_id}
                          </div>
                          <div className="text-sm">
                            <span className="font-medium">{t('sources.connectedTables')}</span> {s.metadata.total_tables}
                            {s.metadata.failed_tables && s.metadata.failed_tables.length > 0 && (
                              <div className="text-sm text-destructive mt-1">
                                <span className="font-medium">{t('sources.tablesNotFound')}</span> {s.metadata.failed_tables.join(', ')}
                              </div>
                            )}
                          </div>
                          
                          {s.metadata.table_infos.map((tableInfo: any, tableIdx: number) => (
                            <div key={tableIdx} className="border rounded-lg p-3 space-y-2">
                              <div className="text-sm font-medium">
                                {tableInfo.table_name} 
                                {tableInfo.row_count > 0 && (
                                  <span className="text-muted-foreground ml-2">
                                    ({tableInfo.row_count.toLocaleString('pt-BR')} {t('sources.rows').toLowerCase()})
                                  </span>
                                )}
                              </div>
                              
                              {tableInfo.columns && tableInfo.columns.length > 0 && (
                                <div className="space-y-2">
                                  <div className="text-xs font-medium">{t('sources.columns')} ({tableInfo.columns.length}):</div>
                                  <div className="flex flex-wrap gap-1">
                                    {tableInfo.columns.map((col: string, colIdx: number) => (
                                      <span key={colIdx} className="inline-flex items-center rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">
                                        {col}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              )}
                              
                              {tableInfo.preview_rows && tableInfo.preview_rows.length > 0 && (
                                <div className="space-y-2">
                                  <div className="text-xs font-medium">{t('sources.firstRows')}</div>
                                  <div className="overflow-x-auto">
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          {tableInfo.columns?.map((col: string, colIdx: number) => (
                                            <TableHead key={colIdx} className="text-xs">{col}</TableHead>
                                          ))}
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {tableInfo.preview_rows.slice(0, 3).map((row: any, rowIdx: number) => (
                                          <TableRow key={rowIdx}>
                                            {tableInfo.columns?.map((col: string, colIdx: number) => (
                                              <TableCell key={colIdx} className="text-xs max-w-32 truncate">
                                                {row[col]?.toString() || '-'}
                                              </TableCell>
                                            ))}
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>
                                </div>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      
                      {s.metadata.file_size && (
                        <div className="text-sm text-muted-foreground">
                          {t('sources.size')} {(s.metadata.file_size / 1024 / 1024).toFixed(2)} MB
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </main>
  );
};

export default Sources;
