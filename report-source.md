# StagePilot Production Planning Research

Date: 2026-09-04

Scope: audit the current repository and research practical layouts and data boundaries for Production schedule, occurrences, rehearsals, and schedule items.

## Current repository evidence

- `apps/desktop/src/components/planning/planning-page.jsx` provides the shared planning shell, persisted view selection, empty states, and three planning route configurations, but it passes an empty event collection to the calendar and has no planning API.
- `apps/desktop/src/components/reui/event-calendar/stagepilot-event-calendar.jsx` wraps the shared calendar engine with Chinese i18n and disables drag, resize, and slot creation. It is suitable as the visual foundation, not as a data model.
- `apps/desktop/src/components/resource-page.jsx` is the strongest existing CRUD/list/grid shell: title, description, search, filters, view tabs, loading, empty and error states.
- `apps/desktop/src/components/productions/productions-view.jsx` already demonstrates list, responsive grid, and Gantt switching, but the current Gantt data is derived from the Production project period and must not become schedule truth.
- Backend migrations and routes currently cover Production project periods, locations, memberships, workspace resources, Programs and ProgramTypes. There are no persisted ProductionOccurrence, RehearsalSession, or ScheduleItem records yet.

## External sources

- ReUI Event Calendar: https://reui.io/docs/components/radix/event-calendar
- Asana Timeline and project views: https://help.asana.com/s/article/timeline?language=en_US and https://help.asana.com/s/article/filter-and-save-views
- Smartsheet view guidance: https://help.smartsheet.com/articles/765715-grid-gantt-calendar-and-card-views
- Shoflo Production Schedule: https://blog.shoflo.tv/glossary/what-is-a-production-schedule
- Shoflo Run of Show: https://blog.shoflo.tv/glossary/what-is-a-run-of-show
- ProductionPlanner schedule model: https://productionplanner.io/docs/schedule/
- Ontime production/rundown model: https://docs.getontime.no/
