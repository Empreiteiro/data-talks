import { Button } from "@/components/ui/button";
import LanguageSelector from "@/components/ui/language-selector";
import { useLanguage } from "@/contexts/LanguageContext";
import { useAuth } from "@/hooks/useAuth";
import { Link } from "react-router-dom";

const NavBar = () => {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  

  const handleLogout = async () => {
    await logout();
  };

  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
      <nav className="container flex items-center justify-between h-16">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight" aria-label={t('nav.tagline')}>
          <span role="img" aria-label="Logo gráfico de crescimento" className="text-xl leading-none">📈</span>
          <span className="hidden sm:inline">{t('nav.tagline')}</span>
        </Link>
        
        {/* Link de Preços no Centro */}
        {!user && (
          <div className="hidden md:flex items-center">
            <Button asChild variant="ghost" size="sm">
              <Link to="/pricing">{t('pricing.title')}</Link>
            </Button>
          </div>
        )}
        
        <div className="flex items-center gap-2">
          <LanguageSelector />
          {user ? (
            <>
              <Button asChild size="sm">
                <Link to="/dashboard">{t('nav.dashboard')}</Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/account">{t('nav.account')}</Link>
              </Button>
              <Button variant="secondary" size="sm" onClick={handleLogout}>{t('nav.logout')}</Button>
            </>
          ) : (
            <>
              <Button asChild>
                <Link to="/login">{t('nav.getStarted')}</Link>
              </Button>
            </>
          )}
        </div>
      </nav>
    </header>
  );
};

export default NavBar;
