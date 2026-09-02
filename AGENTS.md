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
