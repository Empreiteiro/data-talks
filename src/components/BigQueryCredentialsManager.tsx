import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { dataClient } from "@/services/supabaseClient";
import { Trash2, Upload, Key } from "lucide-react";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Credential {
  id: string;
  name: string;
  createdAt: string;
  projectId?: string;
}

interface BigQueryCredentialsManagerProps {
  onSourceAdded?: () => void;
}

export const BigQueryCredentialsManager = ({ onSourceAdded }: BigQueryCredentialsManagerProps = {}) => {
  const { t } = useLanguage();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [credentialName, setCredentialName] = useState("");
  const [credentialsFile, setCredentialsFile] = useState<File | null>(null);

  const fetchCredentials = async () => {
    try {
      const sources = await dataClient.listSources();
      const bigquery = sources.filter((s: { type: string }) => s.type === 'bigquery');
      const formattedCredentials: Credential[] = bigquery.map((s: { id: string; name: string; createdAt: string; metaJSON?: any }) => ({
        id: s.id,
        name: s.name,
        createdAt: s.createdAt,
        projectId: s.metaJSON?.projectId || s.metaJSON?.project_id,
      }));
      setCredentials(formattedCredentials);
    } catch (error) {
      console.error('Error fetching credentials:', error);
      toast.error(t('bigquery.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCredentials();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type === 'application/json') {
      setCredentialsFile(file);
    } else {
      toast.error(t('bigquery.errors.invalidFile'));
    }
  };

  const handleUpload = async () => {
    if (!credentialsFile || !credentialName.trim()) {
      toast.error(t('bigquery.errors.missingFields'));
      return;
    }

    setUploading(true);
    try {
      const credentialsJson = await credentialsFile.text();
      let parsedCredentials: { project_id?: string };
      try {
        parsedCredentials = JSON.parse(credentialsJson);
      } catch {
        toast.error(t('bigquery.errors.invalidJson'));
        return;
      }

      await dataClient.createSource(
        credentialName.trim(),
        'bigquery',
        {
          credentialsContent: credentialsJson,
          projectId: parsedCredentials.project_id || '',
          datasetId: '',
          tables: [],
        }
      );

      toast.success(t('bigquery.success.added'));
      setCredentialName('');
      setCredentialsFile(null);
      await fetchCredentials();
      onSourceAdded?.();
    } catch (error: any) {
      console.error('Error uploading credential:', error);
      toast.error(t('bigquery.errors.uploadFailed'), { description: error.message });
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await dataClient.deleteSource(id);
      toast.success(t('bigquery.success.deleted'));
      fetchCredentials();
    } catch (error: any) {
      console.error('Error deleting credential:', error);
      toast.error(t('bigquery.errors.deleteFailed'), { description: error.message });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            {t('bigquery.addCredential.title')}
          </CardTitle>
          <CardDescription>
            {t('bigquery.addCredential.description')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="credential-name">{t('bigquery.addCredential.nameLabel')}</Label>
            <Input
              id="credential-name"
              placeholder={t('bigquery.addCredential.namePlaceholder')}
              value={credentialName}
              onChange={(e) => setCredentialName(e.target.value)}
              disabled={uploading}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="credential-file">{t('bigquery.addCredential.fileLabel')}</Label>
            <Input
              id="credential-file"
              type="file"
              accept=".json"
              onChange={handleFileChange}
              disabled={uploading}
            />
            {credentialsFile && (
              <p className="text-sm text-muted-foreground">
                {t('bigquery.addCredential.fileSelected')} {credentialsFile.name}
              </p>
            )}
          </div>
          <Button
            onClick={handleUpload}
            disabled={uploading || !credentialsFile || !credentialName.trim()}
            className="w-full"
          >
            {uploading ? t('bigquery.addCredential.uploading') : t('bigquery.addCredential.uploadButton')}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            {t('bigquery.configured.title')}
          </CardTitle>
          <CardDescription>
            {t('bigquery.configured.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted-foreground">{t('bigquery.configured.loading')}</p>
          ) : credentials.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('bigquery.configured.empty')}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('bigquery.configured.name')}</TableHead>
                  <TableHead>{t('bigquery.configured.projectId')}</TableHead>
                  <TableHead>{t('bigquery.configured.createdAt')}</TableHead>
                  <TableHead className="text-right">{t('bigquery.configured.actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {credentials.map((cred) => (
                  <TableRow key={cred.id}>
                    <TableCell className="font-medium">{cred.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {cred.projectId || 'N/A'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(cred.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="ghost" size="sm">
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>{t('bigquery.delete.title')}</AlertDialogTitle>
                            <AlertDialogDescription>
                              {t('bigquery.delete.description', { name: cred.name })}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>{t('bigquery.delete.cancel')}</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => handleDelete(cred.id)}
                              className="bg-destructive text-destructive-foreground"
                            >
                              {t('bigquery.delete.confirm')}
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
