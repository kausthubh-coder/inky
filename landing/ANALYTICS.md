# Inky launch analytics

Use the dedicated PostHog organization and project named `Inky` (project `593320`). Do not send Inky events to the existing Studi project. The landing and desktop apps share the Inky project because their events have separate, explicit names and neither SDK autocaptures arbitrary product activity.

The landing app stays fully functional when analytics is not configured. Set these Vercel variables to enable it:

```text
NEXT_PUBLIC_POSTHOG_KEY=phc_...
NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

The integration is deliberately anonymous: no identify calls, form values, email addresses, autocaptured clicks, session recordings, cookies, persistent browser storage, or URL query strings are sent. PostHog cookieless server hash mode counts daily unique visitors without writing an identifier to the browser, which keeps the landing-page funnel useful without a consent banner.

## Events

| Event | Meaning | Properties |
| --- | --- | --- |
| `$pageview` | A page or client-side route was viewed | PostHog's anonymous web properties |
| `demo_started` | A visitor chose “Okay, show me” | None |
| `waitlist_cta_clicked` | A visitor moved toward the waitlist form | `placement` |
| `waitlist_form_started` | A visitor focused an email field | `placement` |
| `waitlist_joined` | Clerk accepted the waitlist entry | `placement` |
| `sign_in_started` | A visitor opened sign-in from the navigation | `placement` |
| `dashboard_viewed` | A signed-in visitor reached the account dashboard | None |
| `feedback_sent` | A tester successfully sent a web feedback note | `placement` |

## First dashboard

Create these funnels in PostHog:

1. `$pageview` where path is `/` → `waitlist_form_started` → `waitlist_joined`
2. `demo_started` → `waitlist_joined`
3. `sign_in_started` → `dashboard_viewed`

Track the first funnel as the launch conversion rate. Break it down by `placement` to compare the hero and lower waitlist section. Use Web Analytics for visitors, page views, referrers, countries, devices, and bounce rate.
