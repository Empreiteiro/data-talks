import { SEO } from "@/components/SEO";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/contexts/LanguageContext";
import { useNavigate } from "react-router-dom";

/**
 * Open-source version: password reset via email is not implemented.
 */
const ResetPassword = () => {
  const { t } = useLanguage();
  const navigate = useNavigate();

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <SEO title={`Reset Password | ${t('nav.tagline')}`} description="Reset password" canonical="/reset-password" />
      <div className="max-w-md w-full bg-card border rounded-lg p-6 shadow-sm text-center">
        <h1 className="text-2xl font-semibold mb-2">Reset Password</h1>
        <p className="text-muted-foreground mb-6">
          Password reset is not available in this version. Contact your administrator to change your password.
        </p>
        <Button onClick={() => navigate("/")} className="w-full">
          Back to home
        </Button>
      </div>
    </main>
  );
};

export default ResetPassword;
