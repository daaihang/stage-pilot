import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogBody, } from "@/components/ui/alert-dialog";

/**
 * Shared destructive confirmation for soft-deleted resources.
 *
 * The dialog intentionally owns no mutation or toast state. Callers keep
 * ownership of the operation so the same loading/success/error feedback is
 * used for resources and their child resources.
 */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  resourceName,
  resourceType = "资源",
  resourceCollectionLabel = "资源库",
  busy = false,
  onConfirm,
  confirmLabel = "删除",
}) {
  const name = resourceName || "此资源";

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!busy) onOpenChange?.(nextOpen);
      }}
    >
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>删除{resourceType}</AlertDialogTitle>
          <AlertDialogDescription>
            确定要删除{resourceType}“{name}”吗？删除后从{resourceCollectionLabel}隐藏，当前暂无恢复入口。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "删除中…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
