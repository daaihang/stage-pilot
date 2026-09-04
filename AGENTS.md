# StagePilot Agent Guidelines

## User feedback and Toasts

- Every user-triggered operation that can succeed or fail must provide visible feedback through the shared `notify` API from `apps/desktop/src/components/ui/sonner.jsx`.
- Use `notify.success` after a completed mutation or meaningful action.
- Use `notify.error` for failures, including the actionable error description when available.
- Use `notify.message` or `notify.info` for neutral state changes and non-blocking information.
- Use `notify.loading`/`notify.promise` for operations that may take noticeable time, and replace or dismiss the loading toast when the operation completes.
- Do not rely only on inline text, button state, console output, or an activity log for operation feedback.
- Do not show duplicate toasts for the same user action; the component handling the user action owns the feedback.
- Toasts must not contain secrets such as passwords, access tokens, refresh tokens, or production verification tokens.

## Task completion and Git commits

- After completing a user-requested code, configuration, or documentation task, run verification appropriate to the change and create a local Git commit for the completed work.
- Stage only files that belong to the task. Do not commit generated outputs, secrets, local tooling shims, debug artifacts, or unrelated user changes.
- Do not push, open a pull request, or otherwise change remote Git state unless the user explicitly requests it.
- If a task cannot be verified or committed because of an external blocker, report the blocker and leave unrelated changes untouched.

## Window-level detail sidebar

- `WindowDetailProvider` and `WindowDetailHost` in `apps/desktop/src/App.jsx` own the detail surface for the whole application window. Do not create a page-local `Sheet`, drawer, fixed detail layer, or duplicate `open` / width / exclusive state for a page that uses this surface.
- A page that needs details adapts only by calling `useWindowDetail().registerDetail({ key, getDetail, triggerRef, storageKey })` and by wiring its trigger to `setDetailOpen`. Keep `key`, `storageKey`, and `triggerRef` stable; the trigger ref is used to restore focus after close.
- Add routes with independent main/detail scrolling to the shell's `workspace` content-mode selection. Keep ordinary routes in `document` mode so their existing scroll, padding, and max-width behavior remains unchanged.
- The titlebar is the single close and exclusive-toggle surface. Detail content must not add a second close button or overlap `var(--app-titlebar-height)`.
- The host decides `inline`, `overlay`, and `exclusive` from the actual content container width. The inline separator only adjusts detail width; it must not switch to exclusive or close the detail at drag thresholds. Preserve the `ResizeObserver`, width persistence, separator keyboard semantics, touch handling, focus restoration, reduced-motion behavior, and shared `notify` feedback when extending it.
- Exclusive detail is an inset work-area window. Use the current shadcn surface tokens (`bg-popover`, `text-popover-foreground`, `rounded-none`, `ring-1 ring-foreground/10`); a shadow may distinguish the exclusive layer. Narrow overlay detail is a full host-local page surface without a backdrop or blur; neither surface may cover the application titlebar or the persistent left `AppSidebar`.
- When adding a new page adapter, read [`docs/window-detail-sidebar.md`](docs/window-detail-sidebar.md) before changing the shell or detail pane. Verify both responsive modes and run the desktop build before committing.

## Icon system

- Product UI uses Remix Icon `*Line` as the default icon family, matching `apps/desktop/components.json`. Use `*Fill` only for an approved brand, illustration, or state-specific exception.
- Application and page code imports icons only from `@/components/ui/icons`. Direct imports from `lucide-react` or `@remixicon/react` are allowed only inside that adapter and documented special exceptions.
- Prefer the adapter's semantic aliases (`Plus`, `Search`, `Trash2`, `Pencil`, `RefreshCw`, `PanelRightOpen`, etc.) or its `Icon`/`iconMap` registry. Do not introduce a second icon-library entry point.
- Decorative icons must be `aria-hidden="true"` and `focusable="false"`; icon-only buttons must provide an accessible `aria-label` (or equivalent accessible name). Icons with their own `aria-label`, `role="img"`, `role="status"`, or title must remain exposed to assistive technology.
- Keep icon sizing on existing shadcn tokens (`size-3`, `size-3.5`, `size-4`, `size-5`, and button/sidebar size variants) rather than hard-coding vendor defaults.
- After adding or updating shadcn/ReUI components, search for raw icon-library imports and keep the adapter allowlist clean. Record the reason for every special-icon exception in `components/ui/icons.jsx`.
