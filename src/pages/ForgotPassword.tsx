import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/hooks/useAuth";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

const ForgotPassword = () => {
  const { requestPasswordReset } = useAuth();
  const { t } = useLanguage();
  
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    
    const data = new FormData(e.currentTarget);
    try {
      await requestPasswordReset(String(data.get('email')));
      setSuccess(true);
    } catch (err) {
      setError(err.message || 'Erro ao enviar e-mail de recuperação');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <SEO title={`Recuperar Senha | ${t('nav.tagline')}`} description="Recuperação de senha" canonical="/forgot-password" />
      <div className="max-w-md w-full bg-card border rounded-lg p-6 shadow-sm">
        <Link to="/login" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6">
          <ArrowLeft className="h-4 w-4" />
          Voltar para login
        </Link>
        
        <h1 className="text-2xl font-semibold mb-2">Recuperar Senha</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Digite seu e-mail e enviaremos instruções para redefinir sua senha.
        </p>
        
        {success ? (
          <Alert>
            <AlertDescription>
              E-mail enviado com sucesso! Verifique sua caixa de entrada para continuar.
            </AlertDescription>
          </Alert>
        ) : (
          <form className="space-y-4" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input 
                name="email" 
                id="email" 
                type="email" 
                required 
                placeholder="seu@email.com"
              />
            </div>
            
            {error && <p className="text-sm text-destructive">{error}</p>}
            
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Enviando...' : 'Enviar e-mail de recuperação'}
            </Button>
          </form>
        )}
      </div>
    </main>
  );
};

export default ForgotPassword;
