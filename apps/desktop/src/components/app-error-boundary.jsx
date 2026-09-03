import { Component } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { notify } from "@/components/ui/sonner";

export class AppErrorBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    notify.error("页面加载失败", { description: error?.message || "发生未知界面错误" });
  }

  componentDidUpdate(previousProps) {
    if (this.state.error && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main className="flex min-h-full items-center justify-center p-6"><Card className="w-full max-w-lg"><CardHeader><div className="mb-2 flex size-10 items-center justify-center bg-destructive/10 text-destructive"><AlertTriangle className="size-5" /></div><CardTitle>这个页面暂时无法显示</CardTitle><CardDescription>界面遇到了可恢复错误。你可以返回工作台或重新加载应用，不会继续显示空白页面。</CardDescription></CardHeader><CardContent className="space-y-3"><div className="flex flex-wrap gap-2"><Button onClick={() => { window.location.hash = "#/"; this.setState({ error: null }); }}>返回工作台</Button><Button variant="outline" onClick={() => window.location.reload()}><RefreshCw />重新加载</Button></div>{import.meta.env.DEV && <pre className="max-h-36 overflow-auto border bg-muted/30 p-3 text-xs text-destructive">{this.state.error?.stack || this.state.error?.message}</pre>}</CardContent></Card></main>;
  }
}
