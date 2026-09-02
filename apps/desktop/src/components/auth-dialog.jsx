import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AuthScreen } from "@/components/auth-screen";

export function AuthDialog({ open, onOpenChange, onLogin, onRegister }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="z-[60] max-w-md" showCloseButton><AuthScreen onLogin={onLogin} onRegister={onRegister} /></DialogContent></Dialog>;
}
