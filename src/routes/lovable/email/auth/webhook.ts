import * as React from 'react'
import { createAuthEmailHandler } from '@lovable.dev/email-js'
import { createFileRoute } from '@tanstack/react-router'
import { SignupEmail } from '@/lib/email-templates/signup'
import { InviteEmail } from '@/lib/email-templates/invite'
import { MagicLinkEmail } from '@/lib/email-templates/magic-link'
import { RecoveryEmail } from '@/lib/email-templates/recovery'
import { EmailChangeEmail } from '@/lib/email-templates/email-change'
import { ReauthenticationEmail } from '@/lib/email-templates/reauthentication'

// Configuration
const SITE_NAME = "CreditVoice OS Backend"
const SENDER_DOMAIN = "notify.creditvoice.securecloudweb.net"
const ROOT_DOMAIN = "creditvoice.securecloudweb.net"
const FROM_DOMAIN = "creditvoice.securecloudweb.net"
// Canonical app destination for administrator onboarding links.
const SITE_URL = "https://creditvoice.lovable.app"

// The SDK handler owns verification, dispatch, and retry semantics; this file
// owns only the email decisions: subjects, templates, and per-type props.
export const Route = createFileRoute("/lovable/email/auth/webhook")({
  server: {
    handlers: {
      POST: ({ request }) => {
        const handler = createAuthEmailHandler({
          apiKey: process.env['LOVABLE_API_KEY']!,
          from: { name: SITE_NAME, address: `noreply@${FROM_DOMAIN}` },
          senderDomain: SENDER_DOMAIN,
          sendUrl: process.env['LOVABLE_SEND_URL'],
          emails: {
            signup: {
              subject: 'Confirm your email',
              render: (data) =>
                React.createElement(SignupEmail, {
                  siteName: SITE_NAME,
                  siteUrl: SITE_URL,
                  recipient: data.email,
                  confirmationUrl: data.url,
                }),
            },
            invite: {
              subject: "You've been invited",
              render: (data) =>
                React.createElement(InviteEmail, {
                  siteName: SITE_NAME,
                  siteUrl: SITE_URL,
                  confirmationUrl: data.url,
                }),
            },
            magiclink: {
              subject: 'Your login link',
              render: (data) =>
                React.createElement(MagicLinkEmail, {
                  siteName: SITE_NAME,
                  confirmationUrl: data.url,
                }),
            },
            recovery: {
              subject: 'Reset your password',
              render: (data) => {
                // Secure onboarding contract: the native token_hash travels in
                // the URL fragment (never the query string), and the request ID
                // from RedirectTo is preserved. Destination shape:
                // <callback_url>#token_hash=<hash>&type=recovery
                const tokenHash = (data as { token_hash?: string | null }).token_hash
                const destination = data.callback_url || `${SITE_URL}/reset-password`
                const confirmationUrl = tokenHash
                  ? `${destination}#token_hash=${encodeURIComponent(tokenHash)}&type=recovery`
                  : data.url
                return React.createElement(RecoveryEmail, {
                  siteName: SITE_NAME,
                  confirmationUrl,
                })
              },
            },
            email_change: {
              subject: 'Confirm your new email',
              render: (data) =>
                React.createElement(EmailChangeEmail, {
                  siteName: SITE_NAME,
                  oldEmail: data.old_email ?? '',
                  email: data.email,
                  newEmail: data.new_email ?? '',
                  confirmationUrl: data.url,
                }),
            },
            reauthentication: {
              subject: 'Your verification code',
              render: (data) =>
                React.createElement(ReauthenticationEmail, { token: data.token ?? '' }),
            },
          },
        })
        return handler(request)
      },
    },
  },
})
