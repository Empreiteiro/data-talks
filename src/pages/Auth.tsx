import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/hooks/useAuth";
import { useEffect, useState } from "react";


const Auth = () => {
  const { login, register, isAuthenticated } = useAuth();
  const { t } = useLanguage();
  
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated) {
      window.location.href = '/dashboard';
    }
  }, [isAuthenticated]);
  async function onLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const data = new FormData(e.currentTarget);
    try {
      await login(String(data.get('email')), String(data.get('password')));
      window.location.href = '/dashboard';
    } catch (err: any) {
      setError(err.message || t('auth.loginError'));
    }
  }

  async function onRegister(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const data = new FormData(e.currentTarget);
    try {
      const res: any = await register(String(data.get('name')), String(data.get('email')), String(data.get('password')));
      if (res && !res.session) {
        setInfo(t('auth.registerSuccess'));
      } else {
        window.location.href = '/dashboard';
      }
    } catch (err: any) {
      setError(err.message || t('auth.registerError'));
    }
  }

  return (
    <main className="container py-16">
      <SEO title={`${t('auth.login')} | ${t('nav.tagline')}`} description="Autenticação por e-mail e senha" canonical="/login" />
      <div className="max-w-md mx-auto bg-card border rounded-lg p-6 shadow-sm">
        <h1 className="text-2xl font-semibold mb-6">{t('auth.title')}</h1>
        <div>
          <form className="space-y-4" onSubmit={onLogin}>
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <Input name="email" id="email" type="email" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('auth.password')}</Label>
              <Input name="password" id="password" type="password" required />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full">{t('auth.loginButton')}</Button>
          </form>
        </div>
      </div>
    </main>
  );
};

export default Auth;
