# Desktop modal dialog conventions

This applies to ordinary `Dialog` and `AlertDialog` surfaces in the desktop app. `Sheet` and the persistent window-detail sidebar have separate layout contracts and are not covered here.

## Host and interaction boundary

- Dialogs render through the application `AppModalLayerProvider` host, not directly over the whole document. On desktop routes the host begins below the native/application titlebar; public campaign and program-sheet routes use the viewport safe-area instead.
- The backdrop dims and blurs the workspace while leaving the titlebar outside the modal host. Dialog and AlertDialog use the shared modal transition: open for 250ms from scale 0.96 and opacity 0, close for 150ms back to scale 0.96 and opacity 0, with `cubic-bezier(0.22, 1, 0.36, 1)`. The backdrop fades on the same durations; reduced-motion preference disables both transitions.
- The host covers the main workspace, including an open window-detail surface. When a dialog opens, the workspace becomes `inert`. The titlebar remains available to mouse and keyboard; only its right-side detail controls are disabled until all dialogs close.
- A normal dialog closes when its own backdrop is pressed. Pressing the titlebar or a titlebar menu does not dismiss it. `AlertDialog` does not close on outside press; its Cancel, action and Escape behavior remain explicit.
- Only the top registered dialog is interactive. Lower dialogs in a nested stack become `inert` and hidden from assistive technology until the top dialog's close transition completes. The shell remains isolated through that transition; route unmount still releases registrations immediately.
- Route-owned dialogs should remain mounted under their route so navigation naturally dismisses them. Application-level dialogs must be under the app-level modal provider.

## Size and height

Every callsite must choose `size` explicitly. Do not add caller-level `max-w-*`, `max-h-*` or fixed width classes to `DialogContent` / `AlertDialogContent`.

| Size | Maximum width |
| --- | ---: |
| `sm` | 24rem |
| `md` | 32rem |
| `lg` | 42rem |
| `xl` | 52rem |

The shared content primitive preserves side gutters, centers within the available host, and limits height to the titlebar-safe viewport. The outer popup is a flex column; `DialogHeader` and `DialogFooter` remain fixed while the middle `DialogBody` scrolls. Do not make the entire popup the scroll region or place a page-local fixed layer over it.

```jsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent size="md">
    <DialogHeader>
      <DialogTitle>Edit resource</DialogTitle>
      <DialogDescription>Update the short operational details.</DialogDescription>
    </DialogHeader>
    <DialogBody>
      <form onSubmit={save} className="space-y-4">
        {/* fields */}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button type="submit">Save</Button>
        </DialogFooter>
      </form>
    </DialogBody>
  </DialogContent>
</Dialog>
```

For `AlertDialog`, use the corresponding `AlertDialogHeader`, `AlertDialogBody`, and `AlertDialogFooter`. Confirmation-only alerts can omit a body when their description is part of the header.

## Form layout

- Forms are single-column by default. Use `DialogFormGrid` only for short, independent fields that benefit from side-by-side presentation.
- The grid switches at the body container's available width, not a viewport breakpoint. Each column has a 14rem minimum; below that threshold it returns to one column. A lone or odd final field spans the full row when appropriate.
- Names, descriptions, notes, long text, and other wide fields should be full-width. Do not use `sm:grid-cols-*` to lay out modal form fields; use `DialogFormGrid`.
- Select triggers inside modal forms and `DialogFormGrid` are full-width. Toolbar and non-form Select sizing is unchanged.
- `DetailFormLayout` inside a modal should use `scrollBoundary="parent"`; the modal body's scroll region owns scrolling and the form action bar stays reachable.

```jsx
<DialogBody>
  <form onSubmit={save} className="space-y-4">
    <Field>
      <FieldLabel htmlFor="name">Name</FieldLabel>
      <Input id="name" value={name} onChange={updateName} />
    </Field>
    <DialogFormGrid>
      <Field>{/* short field */}</Field>
      <Field>{/* another short field */}</Field>
      <Field className="col-span-full">{/* optional wide field */}</Field>
    </DialogFormGrid>
    <DialogFooter>{/* actions */}</DialogFooter>
  </form>
</DialogBody>
```

## Review checklist

- [ ] The correct size tier is declared, and the caller has no width/height override.
- [ ] Long content is inside `DialogBody`; the header and actions remain visible in a short window.
- [ ] Form grids are based on the dialog body width and only pair fields that remain readable at 14rem each.
- [ ] Select triggers in forms are full-width; list/filter Selects keep their normal sizing.
- [ ] Escape, backdrop behavior, nested dialogs, focus return, titlebar menus, and disabled detail controls still behave correctly.
