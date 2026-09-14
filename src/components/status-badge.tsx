import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { titleCase } from "@/lib/format";

const TONE: Record<string, string> = {
  ACTIVE: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
  COMPLETED: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
  APPROVED: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400",
  AVAILABLE: "bg-sky-500/12 text-sky-700 dark:text-sky-400",
  ASSIGNED: "bg-sky-500/12 text-sky-700 dark:text-sky-400",
  PENDING: "bg-amber-500/14 text-amber-700 dark:text-amber-400",
  UNDER_REVIEW: "bg-amber-500/14 text-amber-700 dark:text-amber-400",
  CONFIGURATION: "bg-amber-500/14 text-amber-700 dark:text-amber-400",
  PROCESSING: "bg-amber-500/14 text-amber-700 dark:text-amber-400",
  RESERVED: "bg-amber-500/14 text-amber-700 dark:text-amber-400",
  SUSPENDED: "bg-destructive/12 text-destructive",
  REJECTED: "bg-destructive/12 text-destructive",
  FAILED: "bg-destructive/12 text-destructive",
  CLOSED: "bg-muted text-muted-foreground",
  RELEASED: "bg-muted text-muted-foreground",
  CANCELLED: "bg-muted text-muted-foreground",
  REVERSED: "bg-violet-500/12 text-violet-700 dark:text-violet-400",
};

export function StatusBadge({ status, className }: { status?: string | null | undefined; className?: string | undefined }) {
  if (!status) return <span className="text-muted-foreground">—</span>;
  return (
    <Badge
      variant="secondary"
      className={cn("border-0 font-medium", TONE[status] ?? "bg-muted text-muted-foreground", className)}
    >
      {titleCase(status)}
    </Badge>
  );
}
