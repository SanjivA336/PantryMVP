import type { LegalDocument } from './types'

// Mirrors legal/Burrow-Terms-of-Service.docx. If you change the wording
// here, update the Word file (and the "updated" date) to match.
export const termsOfService: LegalDocument = {
  title: 'Terms of Service',
  updated: 'October 6, 2026',
  blocks: [
    {
      type: 'p',
      text: 'These Terms of Service ("Terms") govern your use of Burrow (the "Service"), operated by Sanjiv Natarajan Anand ("Burrow," "we," "us," or "our"), an individual operating without a registered business entity. By creating an account or otherwise using the Service, you agree to these Terms and to our Privacy Policy. If you do not agree, do not use the Service.',
    },
    {
      type: 'h2',
      text: '1. What Burrow is',
    },
    {
      type: 'p',
      text: 'Burrow is a shared household kitchen and pantry tool. It helps the people in a household track food and supplies, record who bought and used what, split costs, build shopping lists, manage recipes, and see an activity history. It is a personal project, provided free of charge, with no guarantee of continued availability.',
    },
    {
      type: 'h2',
      text: '2. Eligibility and accounts',
    },
    {
      type: 'p',
      text: 'You must be at least 13 years old to create an account. If you are 18 or older (or at the age of majority where you live), you may use Burrow on your own. If you are 13 to 17, you may use Burrow only if a parent or legal guardian has read and agreed to these Terms and our Privacy Policy and is responsible for your use of the Service. When you create an account, you confirm that you meet one of these two conditions. Children under 13 may not use Burrow. If a minor uses your account or your household, you are responsible for their use. You must give a working email address and confirm it. You are responsible for keeping your login credentials secure and for everything that happens under your account. Tell us promptly if you believe your account has been compromised.',
    },
    {
      type: 'h2',
      text: '3. Households are shared spaces',
    },
    {
      type: 'p',
      text: 'Burrow is built around households, called "burrows" in the app. When you create or join one:',
    },
    {
      type: 'bullet',
      text: '**Everyone in a household can see its data**, including inventory, costs, balances, the activity feed, shopping lists and recipes, as well as the nicknames of its members. Other members see your nickname, not your email address. Adding or admitting someone shares that data with them.',
    },
    {
      type: 'bullet',
      text: "**Join codes grant access.** Anyone who has a household's join code can join it. Keep the code to people you trust.",
    },
    {
      type: 'bullet',
      text: "**Roles matter.** A household's owner and admins can manage members, including deactivating them. You are responsible for who you invite and for the roles you assign.",
    },
    {
      type: 'bullet',
      text: '**History stays with the household.** Records that other members rely on, such as purchases, usage, cost splits and settlements, are append-only by design. Removing yourself or deleting your account does not erase them (see Section 12).',
    },
    {
      type: 'h2',
      text: '4. Your content',
    },
    {
      type: 'p',
      text: 'You keep ownership of what you enter into Burrow ("Your Content"). You give us a limited, non-exclusive license to store, process and display Your Content solely as needed to operate the Service for you and your household. You are responsible for the accuracy of Your Content and for having the right to submit it, including the recipes you enter. The names of custom foods you add to Burrow\'s shared food list are visible to all users of the Service.',
    },
    {
      type: 'h2',
      text: '5. Acceptable use',
    },
    {
      type: 'p',
      text: 'Do not use the Service to:',
    },
    {
      type: 'bullet',
      text: "break the law or violate anyone else's rights;",
    },
    {
      type: 'bullet',
      text: "attempt to access another household's data, or any account that is not yours;",
    },
    {
      type: 'bullet',
      text: 'probe, scan, overload or disrupt the Service, or bypass its rate limits or access controls;',
    },
    {
      type: 'bullet',
      text: 'upload malware, or content that is unlawful, harassing or infringing;',
    },
    {
      type: 'bullet',
      text: 'scrape the Service or use it to build a competing product through automated means.',
    },
    {
      type: 'p',
      text: 'We may remove content or suspend accounts that break these rules.',
    },
    {
      type: 'h2',
      text: '6. Not financial, legal, medical, or safety advice',
    },
    {
      type: 'p',
      text: '**Burrow is an organizational aid only. It does not handle, hold, move, or process money in any form, and it does not verify or guarantee the accuracy of anything it displays or calculates.**',
    },
    {
      type: 'p',
      text: 'Specifically, and without limitation:',
    },
    {
      type: 'bullet',
      text: "**Cost splitting.** Any balance, split or settle-up suggestion Burrow shows is based on data your household entered. Burrow does not send, receive, hold or reconcile any actual payment. Recording a settlement in Burrow only records it; it does not move money. It is your and your household's responsibility to verify any calculation and to actually pay each other using whatever method you choose, independent of Burrow. We are not responsible for any financial disagreement, miscalculation or loss arising from a balance or split shown in the Service.",
    },
    {
      type: 'bullet',
      text: "**Expiry and freshness.** Expiry and best-by dates, and related warnings, are suggestions only. They come from data you or your household entered, or are estimated automatically from a food's typical shelf life, and they may be wrong. They are not a food-safety determination. Always check the package and the food itself, and use your own judgment (and your senses) about whether food is safe to eat, regardless of what the Service displays.",
    },
    {
      type: 'bullet',
      text: '**Recipes.** Recipes and ingredient information come from what you or other people enter and may be incomplete or wrong. **Never rely on Burrow for allergy, dietary-restriction or medical information.** Verify ingredients and preparation yourself before eating or serving anything.',
    },
    {
      type: 'bullet',
      text: '**General accuracy.** Quantities, costs, categories, warnings and every other value Burrow displays are provided "as is," may be incomplete, outdated or incorrect, and depend on what you and other members enter.',
    },
    {
      type: 'p',
      text: 'In short: Burrow is a suggestion tool, not a source of truth. You are always responsible for verifying anything that matters before acting on it.',
    },
    {
      type: 'h2',
      text: '7. Features that may be limited',
    },
    {
      type: 'p',
      text: 'Some features may be limited to certain accounts, may change, or may be unavailable at any time.',
    },
    {
      type: 'h2',
      text: '8. Availability and your data',
    },
    {
      type: 'p',
      text: 'The Service is run by one person as a personal project. It may have bugs, downtime or planned maintenance, and we may change or remove features at any time. We make reasonable efforts to protect your data, but we do not guarantee that it will never be lost. If your data matters to you, use the "Export as CSV" option on the Inventory page to keep your own copy.',
    },
    {
      type: 'h2',
      text: '9. Third-party services',
    },
    {
      type: 'p',
      text: 'Burrow relies on outside providers (described in the Privacy Policy) for things like sign-in, data storage, email delivery and error tracking. We are not responsible for outages or changes caused by those providers.',
    },
    {
      type: 'h2',
      text: '10. No warranty',
    },
    {
      type: 'p',
      text: '**THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE," WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, ACCURACY AND NON-INFRINGEMENT, TO THE FULLEST EXTENT PERMITTED BY LAW.**',
    },
    {
      type: 'h2',
      text: '11. Limitation of liability',
    },
    {
      type: 'p',
      text: '**TO THE FULLEST EXTENT PERMITTED BY LAW, BURROW AND ITS OPERATOR WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, OR ANY LOSS OF DATA, MONEY, FOOD OR GOODWILL, ARISING FROM YOUR USE OF (OR INABILITY TO USE) THE SERVICE. THIS INCLUDES, WITHOUT LIMITATION, ANY DISPUTE BETWEEN HOUSEHOLD MEMBERS OVER COST SPLITTING OR BALANCES, AND ANY HARM FROM RELYING ON AN EXPIRY DATE OR FOOD-SAFETY INFERENCE. TO THE EXTENT ANY LIABILITY CANNOT BE EXCLUDED, OUR TOTAL LIABILITY FOR ANY CLAIM IS LIMITED TO THE AMOUNT YOU PAID TO USE THE SERVICE IN THE PAST TWELVE MONTHS (WHICH, FOR A FREE SERVICE, IS ZERO).** Some places do not allow certain limitations, so parts of this Section may not apply to you.',
    },
    {
      type: 'h2',
      text: '12. Ending your use',
    },
    {
      type: 'p',
      text: "You may stop using the Service and delete your account at any time from Account settings. You cannot delete your account while you own a household (transfer ownership or delete the household first) or while you are a household's only admin. When you delete your account, your login and email address are removed. Your membership is deactivated, but the nickname you used and the records tied to it (for example, past purchases, usage and cost splits) remain in that household's history so that other members' balances stay correct. They are no longer linked to a login.",
    },
    {
      type: 'p',
      text: 'We may suspend or end access to the Service, in whole or in part, at any time and for any reason, including breach of these Terms or simply discontinuing the project.',
    },
    {
      type: 'h2',
      text: '13. Changes to these Terms',
    },
    {
      type: 'p',
      text: 'We may update these Terms from time to time. We will change the "Last updated" date above, and may notify you in the app or by email for significant changes. Continued use of the Service after a change means you accept the updated Terms.',
    },
    {
      type: 'h2',
      text: '14. Governing law',
    },
    {
      type: 'p',
      text: 'These Terms are governed by the laws of the State of Texas, USA, without regard to conflict-of-law principles. If any part of these Terms is found unenforceable, the rest remains in effect.',
    },
    {
      type: 'h2',
      text: '15. Contact',
    },
    {
      type: 'p',
      text: 'Questions about these Terms: use our support form at https://forms.gle/4eDC1Pxwi3D51zJm9.',
    },
  ],
}
