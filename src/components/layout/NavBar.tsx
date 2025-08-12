import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

const NavBar = () => {
  const { user, logout } = useAuth();
  

  const handleLogout = async () => {
    await logout();
  };

  return (
    <header className="sticky top-0 z-40 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
      <nav className="container flex items-center justify-between h-16">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight" aria-label="Página inicial">
          <span role="img" aria-label="Logo gráfico de crescimento" className="text-xl leading-none">📈</span>
          <span className="hidden sm:inline">Converse com seus dados</span>
        </Link>
        <div className="flex items-center gap-2">
          {user ? (
            <>
              <Button asChild size="sm">
                <Link to="/dashboard">Dashboard</Link>
              </Button>
              <Button asChild size="sm">
                <Link to="/account">Conta</Link>
              </Button>
              <Button variant="secondary" size="sm" onClick={handleLogout}>Sair</Button>
            </>
          ) : (
            <Button asChild>
              <Link to="/login">Começar agora</Link>
            </Button>
          )}
        </div>
      </nav>
    </header>
  );
};

export default NavBar;
