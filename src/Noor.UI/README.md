# Noor.UI: NoorMD 3.0's design system

The web side every bench is built from, so they look and behave alike (docs/noormd3/DESIGN.md, section 6.2):

- `css/noor.css`: tokens (spacing, sizes, radii, type), the nine themes, the two densities (`roomy`, `compact`),
  themed scrollbars, and the controls (buttons, fields, selects, lists, tabs, menus, dialogs, toasts).
- `js/noor-ui.js`: small helpers the shell and benches share: `el()`, menus at a point, dialogs, toasts.

The shell ships it at `/ui/…`; a bench links `/ui/css/noor.css` styles for free (the shell page has them) and only adds
its own few rules.
