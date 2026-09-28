import { Dialog, DialogContent, DialogBody, } from "@/components/ui/dialog";
import { AuthScreen } from "@/components/auth-screen";

export function AuthDialog({ open, onOpenChange, onLogin, onRegister }) {
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent size="md" className="z-[60]" showCloseButton><DialogBody><AuthScreen onLogin={onLogin} onRegister={onRegister} /></DialogBody></DialogContent></Dialog>;
}
