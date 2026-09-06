# Style ownership

Global CSS loads from `pages/_app.tsx` in this order:

| File | Responsibility |
| --- | --- |
| `index.css` | Tailwind reset and component entry points |
| `base.css` | Fonts, body defaults, selection, number-input reset, scrollbars |
| `shared.css` | Shared `btn-*`, `type-*`, lobby/room wallpaper, panel fades |
| `game.css` | Table textures, room controls, betting buttons, hand/chip animations |
| `utilities.css` | Tailwind utilities, loaded last to retain per-element overrides |

The global component rules use `@apply` directly. Keep utility CSS last;
wrapping rules in `@layer components` in separately processed files would
require a matching Tailwind directive in those files.

Each screen imports its CSS Module directly:

| File | Responsibility |
| --- | --- |
| `Register.module.css` | Authentication form, responsive login wallpaper, avatars and social placeholders |
| `Lobby.module.css` | Lobby account/navigation, room list/empty state, friends list |
| `History.module.css` | History rows, amounts, dates, empty state and scroll area |
| `Dialog.module.css` | Shared dialog surface/header, form controls and primary/secondary buttons |

History uses `History.module.css` and `Dialog.module.css`; it does not depend
on lobby styles. Shared controls are imported as `ui` to distinguish them
from a screen's layout classes. When moving a selector between modules,
update JSX references and descendant selectors together (class names are scoped).

## UI audit

The stylesheet split preserves the existing game layout and betting colors.
The accompanying audit covers registration, lobby/create/friends/history,
profile/avatar editing, recharge/rebuy, settings, wallet, chat and scoreboards.

Fixed omissions:

- Friends dialog now uses the shared dialog/input/button styles.
- Icon-only close/send/chat-size controls and wallet/rebuy controls have descriptive labels.
- Sound/microphone/output sliders have names; language and avatar selections expose state.
- Avatar file upload remains keyboard accessible.
- Recharge uses two columns on narrow screens; long profile/settings/scoreboard dialogs scroll.
- Non-interactive empty game seats are disabled instead of remaining keyboard stops.
- Both languages include the new control labels.

Expected placeholders: social sign-in on the registration page is disabled
and marked as unavailable until an authentication integration exists.

Validation: `npm run type-check`, `npm run build`, and Prettier. TypeScript
checks translation key use; CSS Module class references also need checking
when selectors move because Next's default CSS Module typing accepts any key.
Browser visual verification requires the Chromium system libraries, which
are not installed in the current workspace environment.
