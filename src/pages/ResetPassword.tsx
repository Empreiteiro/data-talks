import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

const ResetPassword = () => {
  const { updatePassword, initializing } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isValidSession, setIsValidSession] = useState(false);

  useEffect(() => {
    // Verifica se há um token de recuperação válido
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setIsValidSession(true);
      } else if (!initializing) {
        setError('Link de recuperação inválido ou expirado. Por favor, solicite um novo.');
      }
    };

    checkSession();
  }, [initializing]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    
    const data = new FormData(e.currentTarget);
    const password = String(data.get('password'));
    const confirmPassword = String(data.get('confirmPassword'));

    if (password !== confirmPassword) {
      setError('As senhas não coincidem');
      setLoading(false);
      return;
    }

    if (password.length < 6) {
      setError('A senha deve ter pelo menos 6 caracteres');
      setLoading(false);
      return;
    }

    try {
      await updatePassword(password);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar senha');
      setLoading(false);
    }
  }


  if (initializing) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-muted-foreground">Verificando link de recuperação...</p>
        </div>
      </main>
    );
  }

  if (!isValidSession && error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-4">
        <SEO title={`Redefinir Senha | ${t('nav.tagline')}`} description="Redefinir senha" canonical="/reset-password" />
        <div className="max-w-md w-full bg-card border rounded-lg p-6 shadow-sm">
          <h1 className="text-2xl font-semibold mb-4 text-destructive">Erro</h1>
          <p className="text-muted-foreground mb-4">{error}</p>
          <Button onClick={() => navigate('/forgot-password')} className="w-full">
            Solicitar novo link
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <SEO title={`Redefinir Senha | ${t('nav.tagline')}`} description="Redefinir senha" canonical="/reset-password" />
      <div className="max-w-md w-full bg-card border rounded-lg p-6 shadow-sm">
        <h1 className="text-2xl font-semibold mb-2">Redefinir Senha</h1>
        <p className="text-muted-foreground text-sm mb-6">
          Digite sua nova senha abaixo.
        </p>
        
        <form className="space-y-4" onSubmit={onSubmit}>
          <div className="space-y-2">
            <Label htmlFor="password">Nova Senha</Label>
            <Input 
              name="password" 
              id="password" 
              type="password" 
              required 
              minLength={6}
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="confirmPassword">Confirmar Nova Senha</Label>
            <Input 
              name="confirmPassword" 
              id="confirmPassword" 
              type="password" 
              required 
              minLength={6}
            />
          </div>
          
          {error && <p className="text-sm text-destructive">{error}</p>}
          
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? 'Atualizando...' : 'Atualizar Senha'}
          </Button>
        </form>
      </div>
    </main>
  );
};

export default ResetPassword;
