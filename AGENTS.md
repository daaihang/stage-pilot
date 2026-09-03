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
