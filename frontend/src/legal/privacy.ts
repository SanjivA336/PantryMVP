import type { LegalDocument } from './types'

// Mirrors legal/Burrow-Privacy-Policy.docx. If you change the wording
// here, update the Word file (and the "updated" date) to match.
export const privacyPolicy: LegalDocument = {
  title: 'Privacy Policy',
  updated: 'October 6, 2026',
  blocks: [
    {
      type: 'p',
      text: 'This Privacy Policy explains what information Burrow ("we," "us," "our") collects, how it is used, who it is shared with, and the choices you have when you use the Burrow household kitchen-tracking service (the "Service"). The Service is operated by Sanjiv Natarajan Anand, an individual. It is not currently run by a company.',
    },
    {
      type: 'h2',
      text: '1. What we collect',
    },
    {
      type: 'bullet',
      text: '**Account information:** your email address and password. The password is handled by our sign-in provider (Supabase), which stores only a hashed version; we never see or store your raw password.',
    },
    {
      type: 'bullet',
      text: '**Profile information:** a nickname you choose for each household you join, and your role (admin or regular member).',
    },
    {
      type: 'bullet',
      text: '**Household data you or your household members enter:** foods and inventory items, quantities, units, costs, expiry dates, storage locations, who bought and who may use an item, shopping lists, recipes, usage and consumption logs, and the resulting balances and settlements between members.',
    },
    {
      type: 'bullet',
      text: '**Activity data:** an append-only log of actions in your household (who added, used, moved or removed what, corrections, settlements, members joining or leaving, and when), shown to household members as an activity feed.',
    },
    {
      type: 'bullet',
      text: '**Support requests:** if you contact us through the support form, the email address, message, device details and any attachments you provide. Do not include passwords.',
    },
    {
      type: 'bullet',
      text: '**Technical data:** standard server and hosting logs (such as IP address, request time and the page or API route requested). Our server also uses your IP address to apply rate limits that protect the Service from abuse.',
    },
    {
      type: 'bullet',
      text: '**Error reports:** if an unexpected error occurs, technical details (such as the error message, stack trace, browser type and the page you were on) may be sent to our error-tracking provider. See Section 5.',
    },
    {
      type: 'p',
      text: 'We do not collect payment card or bank information, because Burrow does not process payments. We do not ask for your location, contacts or any government identification.',
    },
    {
      type: 'h2',
      text: '2. How we use it',
    },
    {
      type: 'p',
      text: "Only to run and protect the Service: to show your household's data to you and the other members of your household, to calculate suggested balances and warnings, to send account emails (such as email confirmation and password reset), to fix bugs, and to prevent abuse. We do not sell your personal information, and we do not use advertising or behavioral-tracking tools.",
    },
    {
      type: 'h2',
      text: '3. Sharing within a household',
    },
    {
      type: 'p',
      text: 'Burrow is a multi-person tool by design. Everything you add to a household (called a "burrow" in the app), including your nickname, the items you buy and use, the costs you enter, your balances with other members and your activity, is visible to the other members of that household. This is how the Service works, not a disclosure to a third party. Do not join or create a household with someone whose access to this information you are not comfortable with. Other members see your nickname, not your email address. Households cannot see each other\'s data, with one exception: the names of custom foods you add to Burrow\'s shared food list are visible to all users.',
    },
    {
      type: 'h2',
      text: '4. Service providers who handle data for us',
    },
    {
      type: 'p',
      text: 'We share data only with the providers that make Burrow work, and only as needed for the purpose listed:',
    },
    {
      type: 'table',
      header: ['Provider', 'What it does for Burrow', 'Data involved'],
      rows: [
        [
          'Supabase',
          'Sign-in, the database, real-time updates and file storage',
          'Everything in Section 1 that is stored in your account and households',
        ],
        [
          'Resend',
          'Delivers account emails (confirmation, password reset)',
          'Your email address and the content of the email',
        ],
        [
          'Sentry',
          'Error tracking so we can find and fix bugs',
          'Technical error details; may include IP address and browser information',
        ],
        [
          'Google Forms',
          'Receives the support requests you submit',
          'Your email address, message, device details, and any files you attach',
        ],
        [
          'Cloudflare',
          'Hosts the website and its domain name (DNS)',
          'Technical data such as your IP address and request logs',
        ],
        [
          'Render',
          'Hosts the API (the server behind the app)',
          'Technical data such as your IP address and request logs, plus the data your app sends to and receives from the API',
        ],
      ],
    },
    {
      type: 'p',
      text: 'These providers act on our behalf and are bound by their own terms and privacy policies. We may share information if required by law, or to protect the Service and its users from harm. If the Service were ever transferred to someone else, your information would transfer with it, and we would update this policy.',
    },
    {
      type: 'h2',
      text: '5. Error tracking',
    },
    {
      type: 'p',
      text: 'We use Sentry to capture unexpected application errors. Reports include technical details of what went wrong. We do not turn on session recording, and the reports are not used for advertising or tracking you across other sites.',
    },
    {
      type: 'h2',
      text: '6. Cookies and local storage',
    },
    {
      type: 'p',
      text: '**Burrow does not set cookies.** The app stores a small amount of data in your browser\'s local storage: your sign-in session (so you stay signed in), and a few display preferences. It is strictly necessary for the Service to work and is not used for tracking or advertising. Because the app is installable, your browser may also cache the app\'s own files (not your data) so it can load offline. We do not track you across other websites or services, so we do not respond to "Do Not Track" browser signals.',
    },
    {
      type: 'h2',
      text: '7. Retention and deletion',
    },
    {
      type: 'bullet',
      text: '**Deleting your account:** you can do this at any time in Account settings. Your login and email address are permanently removed.',
    },
    {
      type: 'bullet',
      text: "**What stays:** your household memberships are deactivated, but the nickname you used and the records tied to it (purchases, usage, cost splits, settlements and activity entries) remain in the household's history, so other members' balances and records stay accurate. After deletion these are no longer linked to a login or an email address, but your nickname may still appear in them. If you want a nickname changed before you leave, do that first.",
    },
    {
      type: 'bullet',
      text: '**Households:** if you own or solely administer a household, you must transfer ownership or delete the household before you can delete your account. Deleting a household removes its data.',
    },
    {
      type: 'bullet',
      text: '**Backups and logs:** deleted data may remain in provider backups and logs for a limited time before it is overwritten.',
    },
    {
      type: 'bullet',
      text: '**Error and email records:** these are kept by the relevant provider under its own retention schedule.',
    },
    {
      type: 'h2',
      text: '8. Your choices and rights',
    },
    {
      type: 'p',
      text: 'You can view and correct most of your data in the app, and you can export your inventory with "Export as CSV" on the Inventory page. Depending on where you live, you may have additional rights, such as asking for a copy of your data, a correction, or deletion. To make a request, contact us using the support form linked in Section 12. We may need to verify that the request comes from you, and we will respond within a reasonable time.',
    },
    {
      type: 'h2',
      text: '9. Children',
    },
    {
      type: 'p',
      text: "Burrow is intended for people aged 18 and over, and for people aged 13 to 17 whose parent or legal guardian has read and agreed to the Terms of Service and this Privacy Policy. It is not directed to children under 13, and we do not knowingly collect personal information from anyone under 13; if we learn that we have, we will delete it. We do not ask for a date of birth: when you sign up, you confirm your age or your parent or guardian's permission. A parent or guardian can ask us to review or delete a minor's account at any time using the support form linked in Section 12. If you believe a child under 13 has created an account, contact us and we will remove it.",
    },
    {
      type: 'h2',
      text: '10. Security',
    },
    {
      type: 'p',
      text: "We take reasonable measures to protect your data, including encrypted connections, hashed passwords, and database access rules that keep each household's data separate. No method of transmission or storage is completely secure, and we cannot guarantee absolute security. Keep your password private and use a unique one.",
    },
    {
      type: 'h2',
      text: '11. Where data is processed; changes to this policy',
    },
    {
      type: 'p',
      text: 'Our providers may store and process data in the United States and other countries where they operate. We may update this policy from time to time. We will change the "Last updated" date above, and may notify you in the app or by email for significant changes. Continued use of the Service after a change means you accept the updated policy.',
    },
    {
      type: 'h2',
      text: '12. Contact',
    },
    {
      type: 'p',
      text: 'Questions about this policy, or a data access, correction or deletion request: use our support form at https://forms.gle/4eDC1Pxwi3D51zJm9.',
    },
    {
      type: 'p',
      text: 'This policy is governed by the laws of the State of Texas, USA.',
    },
  ],
}
