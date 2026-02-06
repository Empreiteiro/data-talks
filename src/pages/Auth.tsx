import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/hooks/useAuth";
import { usePythonBackend } from "@/config";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";


const Auth = () => {
  const { login, loginWithUsername, register, isAuthenticated, loginRequired } = useAuth();
  const { t } = useLanguage();
  const useApi = usePythonBackend();
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated) {
      window.location.href = '/';
    }
  }, [isAuthenticated]);

  async function onLogin(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const data = new FormData(e.currentTarget);
    try {
      if (useApi && loginRequired) {
        await loginWithUsername(String(data.get('username')), String(data.get('password')));
      } else {
        await login(String(data.get('email')), String(data.get('password')));
      }
      window.location.href = '/';
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
        window.location.href = '/';
      }
    } catch (err: any) {
      setError(err.message || t('auth.registerError'));
    }
  }

  const showUsernameLogin = useApi && loginRequired;

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <SEO title={`${t('auth.login')} | ${t('nav.tagline')}`} description="Login" canonical="/login" />
      <div className="max-w-md w-full bg-card border rounded-lg p-6 shadow-sm">
        <h1 className="text-2xl font-semibold mb-6">{t('auth.title')}</h1>

        {showUsernameLogin ? (
          <form className="space-y-4" onSubmit={onLogin}>
            <div className="space-y-2">
              <Label htmlFor="login-username">{t('auth.username')}</Label>
              <Input name="username" id="login-username" type="text" required autoComplete="username" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="login-password">{t('auth.password')}</Label>
              <Input name="password" id="login-password" type="password" required autoComplete="current-password" />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full">{t('auth.loginButton')}</Button>
          </form>
        ) : (
          <Tabs defaultValue="login" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login">{t('auth.login')}</TabsTrigger>
              <TabsTrigger value="register">{t('auth.register')}</TabsTrigger>
            </TabsList>
            <TabsContent value="login">
              <form className="space-y-4" onSubmit={onLogin}>
                <div className="space-y-2">
                  <Label htmlFor="login-email">{t('auth.email')}</Label>
                  <Input name="email" id="login-email" type="text" required autoComplete="username" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password">{t('auth.password')}</Label>
                  <Input name="password" id="login-password" type="password" required />
                </div>
                <Link to="/forgot-password" className="text-sm text-primary hover:underline inline-block">
                  {t('auth.forgotPassword')}
                </Link>
                {error && <p className="text-sm text-destructive">{error}</p>}
                {info && <p className="text-sm text-green-600">{info}</p>}
                <Button type="submit" className="w-full">{t('auth.loginButton')}</Button>
              </form>
            </TabsContent>
            <TabsContent value="register">
              <form className="space-y-4" onSubmit={onRegister}>
                <div className="space-y-2">
                  <Label htmlFor="register-name">{t('auth.name')}</Label>
                  <Input name="name" id="register-name" type="text" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-email">{t('auth.email')}</Label>
                  <Input name="email" id="register-email" type="email" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="register-password">{t('auth.password')}</Label>
                  <Input name="password" id="register-password" type="password" required minLength={6} />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                {info && <p className="text-sm text-green-600">{info}</p>}
                <Button type="submit" className="w-full">{t('auth.registerButton')}</Button>
              </form>
            </TabsContent>
          </Tabs>
        )}
      </div>
    </main>
  );
};

export default Auth;
