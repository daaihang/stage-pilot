# Desktop modal dialog conventions

This contract applies to ordinary `Dialog` and `AlertDialog` surfaces in the desktop app. `Sheet` and the persistent window-detail sidebar have separate layout contracts and are not covered here.

## Host, height, and interaction boundary

- Dialogs render through the application `AppModalLayerProvider` host. On desktop routes the host begins below the application titlebar; public routes use the viewport safe area.
- The backdrop dims and blurs the workspace while leaving the titlebar outside the modal host. Dialog and AlertDialog keep the shared 250ms open / 150ms close transition; reduced-motion preference disables it.
- The host covers the main workspace, including an open window-detail surface. The workspace becomes inert while a dialog is open. The titlebar remains available to mouse and keyboard; only its right-side detail controls are disabled.
- Only the top registered dialog is interactive. Route-owned dialogs close naturally when their route unmounts. AlertDialog does not close on outside press; its Cancel, action, and Escape behavior remain explicit.

Every callsite must choose `size="sm|md|lg|xl"`. Shared maximum widths are 24rem, 32rem, 42rem, and 52rem. Do not add caller-level `max-w-*`, `max-h-*`, or fixed width classes. The popup keeps its 16px outer gutter and height limit based on the titlebar-safe viewport.

## Required region structure

Each dialog has three sibling regions in this order:

1. `DialogHeader` / `AlertDialogHeader` — fixed title and description.
2. `DialogBody` / `AlertDialogBody` — the only scrollable region.
3. `DialogFooter` / `AlertDialogFooter` — fixed actions, outside the scrolling body.

For a form dialog, wrap all three regions in `DialogForm`. This preserves native form submission while keeping the footer outside the scroll viewport. Do not put `DialogFooter`, `AlertDialogFooter`, `DetailFormLayout`, or `FormActionBar` inside a dialog body.

```jsx
<Dialog open={open} onOpenChange={setOpen}>
  <DialogContent size="md">
    <DialogForm onSubmit={save}>
      <DialogHeader>
        <DialogTitle>Edit resource</DialogTitle>
        <DialogDescription>Update the short operational details.</DialogDescription>
      </DialogHeader>
      <DialogBody>
        <div className="space-y-4">
          <Field>
            <FieldLabel htmlFor="name">Name</FieldLabel>
            <Input id="name" value={name} onChange={updateName} />
          </Field>
          <DialogFormGrid>
            <Field>{/* short independent field */}</Field>
            <Field>{/* another short independent field */}</Field>
            <Field className="col-span-full">{/* optional wide field */}</Field>
          </DialogFormGrid>
        </div>
      </DialogBody>
      <DialogFooter
        layout="standard"
        cancel={<Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>}
        primary={<Button type="submit">Save</Button>}
      />
    </DialogForm>
  </DialogContent>
</Dialog>
```

`AlertDialog` follows the same region structure. Keep its alert semantics by passing `AlertDialogCancel` and `AlertDialogAction` through the footer slots:

```jsx
<AlertDialogFooter
  layout="standard"
  cancel={<AlertDialogCancel>Cancel</AlertDialogCancel>}
  primary={<AlertDialogAction variant="destructive">Delete</AlertDialogAction>}
/>
```

## Footer action roles and responsive behavior

Every footer explicitly declares `layout` and a single `primary` action. `cancel` is optional, `secondary` accepts at most two actions, and no action priority is inferred from child order or button styling.

- `standard`: on a roomy dialog, all actions stay grouped and right-aligned, with primary rightmost. When the dialog is host-constrained or the natural action group does not fit, actions stack full-width in cancel → secondary → primary order.
- `wizard`: on a roomy dialog, Cancel sits at the left and secondary + primary remain grouped at the right. In compact mode they stack full-width in reading order.
- `auth`: a named exception for login/registration flows; the primary action remains centered and full-width.
- A lone ordinary primary action is content-width and right-aligned when there is room; it becomes full-width when the host constrains the dialog.

The footer observes the actual dialog and footer widths with `ResizeObserver`. It compares the chosen size tier with the dialog's measured width and compares a hidden, inert natural-width measurement of its actions with the available footer width. No viewport or hard-coded rem breakpoint controls footer wrapping. Keep DOM order aligned with compact visual order so keyboard focus proceeds cancel → secondary → primary.

```jsx
<DialogFooter
  layout="wizard"
  cancel={<Button type="button" variant="outline">Cancel</Button>}
  secondary={<Button type="button" variant="ghost">Save draft</Button>}
  primary={<Button type="submit">Continue</Button>}
/>
```

## Form layout

- Forms are single-column by default. Use `DialogFormGrid` only for short, independent fields that benefit from side-by-side presentation.
- The grid responds to the body container, not the viewport; each column needs at least 14rem plus the shared gap. A lone or odd final field spans the full row where appropriate.
- Names, descriptions, notes, and other long fields should occupy the full row. Do not use viewport `sm:grid-cols-*` classes for modal forms.
- Select triggers inside modal forms and `DialogFormGrid` are full-width. Toolbar and non-form Select sizing is unchanged.
- `DetailFormLayout` and `FormActionBar` remain available for non-modal detail surfaces. Modal forms use `DialogForm` and semantic footer slots instead.

## Review checklist

- [ ] The correct `size` tier is declared; no caller width/height override is present.
- [ ] Header, Body, and Footer are siblings in that order; only Body scrolls.
- [ ] Form dialogs use one `DialogForm` around all three regions; submit remains a native submit action.
- [ ] Footer declares `layout` and one primary action; cancel and secondary roles are explicit.
- [ ] Short forms have no artificial bottom clearance; long forms scroll while header/footer remain visible.
- [ ] Form grids and Select widths follow the container-based rules above.
- [ ] Escape, backdrop behavior, nested dialogs, focus return, titlebar menus, and AlertDialog semantics still behave correctly.
