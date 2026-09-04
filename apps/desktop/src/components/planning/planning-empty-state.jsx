import { Card, CardContent } from "@/components/ui/card";

export function PlanningEmptyState({ icon: Icon, title, description, compact = false }) {
  return <Card className="border-dashed"><CardContent className={`flex ${compact ? "min-h-32" : "min-h-64"} flex-col items-center justify-center gap-3 px-6 text-center`}>
    {Icon && <Icon className="size-8 text-muted-foreground" />}
    <div><p className="font-medium">{title}</p><p className="mt-1 max-w-lg text-sm text-muted-foreground">{description}</p></div>
  </CardContent></Card>;
}
