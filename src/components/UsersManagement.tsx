import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/contexts/LanguageContext";
import { Users } from "lucide-react";

/**
 * Open-source version: multi-user management is not implemented.
 */
const UsersManagement = () => {
  const { language } = useLanguage();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          {language === 'pt' ? 'Gestão de usuários' : 'User management'}
        </CardTitle>
        <CardDescription>
          {language === 'pt'
            ? 'A gestão de usuários não está disponível nesta versão open-source.'
            : 'User management is not available in this open-source version.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground">
          {language === 'pt'
            ? 'Esta instalação utiliza apenas o backend Python local. Para múltiplos usuários, configure o controle de acesso no servidor.'
            : 'This installation uses the local Python backend only. For multiple users, configure access control on the server.'}
        </p>
      </CardContent>
    </Card>
  );
};

export default UsersManagement;
