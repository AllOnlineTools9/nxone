import Link from "next/link";
import { BRAND, LEGAL_ENTITY } from "@/lib/config";

export interface LegalPage { slug: string; title: string; description: string; updated: string; Body: () => React.JSX.Element }

const UPDATED = "19 November 2026";

/** The registered business, where it has been filled in. Nothing is shown until it has. */
const entityName = () => LEGAL_ENTITY.name || BRAND.name;
const grievanceEmail = () => LEGAL_ENTITY.grievanceOfficer.email || BRAND.email;

function BusinessDetails() {
  if (!LEGAL_ENTITY.name && !LEGAL_ENTITY.address.length) return null;
  return (
    <>
      <h2>The business</h2>
      <p>
        {LEGAL_ENTITY.name ? <>{BRAND.name} is run by <strong>{LEGAL_ENTITY.name}</strong>.<br /></> : null}
        {LEGAL_ENTITY.address.map((line) => <span key={line}>{line}<br /></span>)}
        {LEGAL_ENTITY.phone ? <>Phone: <a href={`tel:${LEGAL_ENTITY.phone.replace(/\s/g, "")}`}>{LEGAL_ENTITY.phone}</a><br /></> : null}
        Email: <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a>
      </p>
    </>
  );
}

export const LEGAL: LegalPage[] = [
  {
    slug: "privacy-policy",
    title: "Privacy policy",
    description: `How ${BRAND.name} handles your information: what is held, why, and what is never done with it.`,
    updated: UPDATED,
    Body: () => (
      <>
        <h2>The short version</h2>
        <p>Your documents are built in your browser. If you create an account, a copy of your records is held so that nothing is lost and your devices stay in step. If you do not, nothing is sent anywhere at all. Either way the data is yours: export it or delete it whenever you like, and we never sell it or hand it to advertisers.</p>

        <h2>What is on your device</h2>
        <p>Everything you type into a document, along with your logo and signature, is held in your browser&apos;s local storage so that closing the tab does not lose your work. Clearing your browser data removes it, which is why we offer an account and a backup file.</p>

        <h2>What we hold when you have an account</h2>
        <p>Your invoices, customers, items, expenses and business details, as you saved them, plus your email address. We hold them so a second device can catch up and so a lost laptop is not a lost year. Tax is still worked out on your device, not ours.</p>
        <p>We do not look at your records except where you ask us to: the weekly summary email is assembled from them, and a photographed bill is passed to a reading service only when you attach one and your plan includes that. Nothing is used to train anything.</p>

        <h2>Links you share</h2>
        <p>When you send a document as a link, a copy of that document, and its PDF, is kept so the person you sent it to can open and download it. Anyone holding the link can see it, so treat it like the document itself. It stops working when you withdraw it or when it expires, and the PDF goes with it.</p>

        <h2>When something breaks</h2>
        <p>If a page fails, a short report goes to us: what the error was and which page it happened on. Before it is kept, email addresses, GSTINs, long numbers, links and anything that looks like a key or token are removed. It never includes what you typed into a document.</p>

        <h2>Who helps us run it</h2>
        <p>A few services do part of the work, each only for that part:</p>
        <ul>
          <li><strong>Cloudflare</strong> hosts the site and the database your account copy is kept in.</li>
          <li><strong>Resend</strong> delivers our emails: sign-in links, reminders and summaries.</li>
          <li><strong>Google Cloud Vision</strong> reads a photographed bill, only when you attach one.</li>
          <li><strong>Razorpay</strong> takes payment for a paid plan. Your card or UPI details go to them, never to us.</li>
          <li><strong>Google Analytics</strong> counts visits, as described below.</li>
        </ul>

        <h2>What we do collect</h2>
        <p>Like most websites we use analytics to understand which pages are visited and roughly where visitors come from. That covers pages viewed, approximate location by country or city, device type and browser. It does not include anything you type into a document.</p>
        <p>If advertising is enabled on the site, advertising partners may set cookies to choose which advertisements to show. Where the law requires it, you will be asked before any non-essential cookie is set, and you can change your mind later.</p>

        <h2>What we never do</h2>
        <ul>
          <li>Sell or share your information with data brokers or advertisers</li>
          <li>Require an account: the whole product works without one</li>
          <li>Use your records to train anything</li>
          <li>Keep your data after you ask us to delete it, beyond the 30 days our backups take to roll over</li>
        </ul>

        <h2>Fonts and files loaded from elsewhere</h2>
        <p>The site loads its typefaces and code from a content delivery network, which by its nature sees the address of the page requesting them. This is ordinary web infrastructure and involves nothing you have typed.</p>

        <h2>Children</h2>
        <p>This is a tool for businesses and is not directed at children.</p>

        <h2>Your rights</h2>
        <p>You can export everything we hold at any time, from your business details, as a file you keep. You can ask us to correct anything, or to delete your account and everything in it, and we will within 30 days. If you have never signed in, we hold nothing of yours to begin with.</p>

        <h2>Complaints</h2>
        <p>
          For anything about your data, write to {LEGAL_ENTITY.grievanceOfficer.name ? <>our grievance officer, {LEGAL_ENTITY.grievanceOfficer.name}, at </> : null}
          <a href={`mailto:${grievanceEmail()}`}>{grievanceEmail()}</a>. We reply within 7 days and resolve complaints within 30. If you are in India and not satisfied with our answer, you can take it to the Data Protection Board of India.
        </p>

        <h2>Changes</h2>
        <p>If this policy changes in a way that matters, the date at the top will change with it.</p>
      </>
    )
  },
  {
    slug: "terms",
    title: "Terms of use",
    description: `The terms on which you may use ${BRAND.name}, in plain language.`,
    updated: UPDATED,
    Body: () => (
      <>
        <p>These terms are an agreement between you and {entityName()}. By using {BRAND.name} you accept them.</p>

        <h2>Using the tools</h2>
        <p>The free plan is free to use for your own business documents. You may use the documents you create here for any lawful purpose, commercial or otherwise. You own what you create; we claim nothing in it.</p>

        <h2>What we do not promise</h2>
        <p>The tools are offered as they are. We work hard on the arithmetic and test it, but we cannot promise the site is free of errors or available at all times.</p>

        <h2>Tax information is a starting point, not advice</h2>
        <p>The tax rates and formats here are the commonly published ones, each carrying its source and the date it took effect. They are a convenience, not a ruling. Classification and rates depend on the detail of what you sell, and they change. Check anything that matters against your own tax authority or your accountant before you file or rely on it. See the <Link href="/disclaimer">disclaimer</Link> for more.</p>

        <h2>Your account</h2>
        <p>You sign in with a link sent to your email, so keep that inbox safe: whoever can read it can sign in. If you add people to your business, you are responsible for what they do in it, and you can remove them at any time.</p>

        <h2>Paid plans</h2>
        <ul>
          <li>Prices are on the <Link href="/pricing">pricing page</Link>, in Indian rupees. Any GST that applies is shown before you pay.</li>
          <li>A plan renews automatically, monthly or yearly as you chose, and is charged at the start of each period until you cancel.</li>
          <li>You can cancel at any time. The plan stays active until the end of the period already paid for, then your account moves to the free plan. Nothing you made is deleted.</li>
          <li>Payments are not refunded, except as the <Link href="/cancellation-and-refunds">cancellation and refunds policy</Link> sets out.</li>
          <li>If we change a price, you will hear about it by email at least 30 days before it applies to you, and can cancel before then.</li>
          <li>If a payment fails, we will try again and tell you. If it still fails after 7 days, the account moves to the free plan until it is paid.</li>
        </ul>

        <h2>Your responsibility</h2>
        <p>You are responsible for what your documents say: the figures, the tax treatment, the terms and whether the invoice is correct. Keep your own copy of anything you need by law: you can export everything at any time.</p>

        <h2>Fair use</h2>
        <p>Do not use the site to break the law, to create documents intended to deceive, or to attack the service itself.</p>

        <h2>Liability</h2>
        <p>To the extent the law allows, we are not liable for loss arising from use of the site, including lost profit, rejected filings or penalties. Where we are liable, it is limited to what you paid us in the 12 months before the claim.</p>

        <h2>Ending it</h2>
        <p>You can stop using {BRAND.name} and delete your account whenever you like. We may suspend an account that breaks these terms, and will tell you why unless the law prevents it.</p>

        <h2>Law</h2>
        <p>These terms are governed by the laws of India{LEGAL_ENTITY.jurisdictionCity ? <>, and the courts of {LEGAL_ENTITY.jurisdictionCity} have jurisdiction</> : null}.</p>

        <h2>Contact</h2>
        <p>Questions about these terms: <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a>.</p>
      </>
    )
  },
  {
    slug: "disclaimer",
    title: "Disclaimer",
    description: "Why the tax rates here are a starting point rather than authoritative, and how to check them.",
    updated: UPDATED,
    Body: () => (
      <>
        <h2>We are not your accountant</h2>
        <p>Nothing on this site is tax, legal or financial advice. It is software that does arithmetic and lays out documents.</p>

        <h2>Where the rates come from</h2>
        <p>Every tax rate in the system carries three things: the dates it applies between, the authority it came from, and how far it has been verified. You can see all of it in the document, and rates marked as unverified say so plainly rather than pretending otherwise.</p>
        <p>They are drawn from published schedules such as the GST Council rate schedules in India, HMRC guidance in the United Kingdom, the Federal Tax Authority in the UAE and the equivalent bodies elsewhere. Those bodies are the authority; we are not.</p>

        <h2>Why your rate may differ</h2>
        <ul>
          <li>Classification turns on the detail of the product, its packaging, its composition or its end use</li>
          <li>Some rates change with the price of a single unit, such as apparel and hotel rooms in India</li>
          <li>Exemptions, reverse charge, composition schemes and special zones all change the treatment</li>
          <li>Rates change, sometimes with little notice. India moved to 5, 18 and 40 percent on 22 September 2025</li>
          <li>Local taxes, such as sales tax in the United States, differ street by street, which is why we ask you to enter the rate</li>
        </ul>

        <h2>What to do about it</h2>
        <p>Use the tool to produce the document, then check the rate against the schedule for your goods or services, or ask an accountant. If the figures matter, which for tax they always do, a five minute check is cheap.</p>
      </>
    )
  },
  {
    slug: "cancellation-and-refunds",
    title: "Cancellation and refunds",
    description: `How to cancel a paid ${BRAND.name} plan, what happens to your work, and when a payment is refunded.`,
    updated: UPDATED,
    Body: () => (
      <>
        <h2>The short version</h2>
        <p>Cancel whenever you like. Your plan runs to the end of the period you paid for, then your account moves to the free plan with everything in it kept. Payments are not refunded, except where we charged you by mistake.</p>

        <h2>Cancelling</h2>
        <ul>
          <li>Choose <strong>Cancel plan</strong> under Your business details, or write to <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a> from the email you sign in with and we will cancel it within 2 working days.</li>
          <li>Nothing more is charged after you cancel.</li>
          <li>The paid features stay on until the end of the month or year already paid for.</li>
          <li>After that the account is on the free plan. Your invoices, customers and records are not deleted, and you can export them at any time, or come back to a paid plan later.</li>
        </ul>

        <h2>Refunds</h2>
        <p>Monthly and yearly plans are not refunded once the period has started, in full or in part, including when you cancel partway through it. That is why cancelling keeps everything working to the end of what you paid for.</p>
        <p>We do refund the full amount when:</p>
        <ul>
          <li>you were charged twice for the same period,</li>
          <li>you were charged after you had cancelled, or</li>
          <li>you were charged for a plan you did not choose, because of a fault on our side.</li>
        </ul>
        <p>Write to <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a> within 30 days of the charge, with the date and amount. We confirm within 2 working days, and the money reaches the card, UPI account or bank account you paid from within <strong>5 to 7 working days</strong> after that. How fast it shows depends on your bank.</p>

        <h2>Free plan</h2>
        <p>The free plan costs nothing, so there is nothing to cancel or refund. To delete your account and everything in it, write to <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a> from the email you sign in with.</p>

        <h2>Questions</h2>
        <p>Write to <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a>.</p>
      </>
    )
  },
  {
    slug: "shipping-and-delivery",
    title: "Shipping and delivery",
    description: `${BRAND.name} is an online service: nothing is shipped, and a paid plan starts as soon as it is paid for.`,
    updated: UPDATED,
    Body: () => (
      <>
        <h2>Nothing is shipped</h2>
        <p>{BRAND.name} is software you use in your web browser. There are no physical goods, so there is no shipping, no delivery charge and nothing to wait for at the door.</p>

        <h2>When you get what you paid for</h2>
        <p>A paid plan starts the moment the payment goes through. The features are on in your account straight away, on every device you sign in on. You get an email confirming the payment, with an invoice for it.</p>
        <p>If a payment has gone through and the plan has not started within 24 hours, write to <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a> with the date and amount. We will switch it on, or refund the payment in full if we cannot.</p>

        <h2>Documents you make</h2>
        <p>Invoices, quotations and other documents you create are downloaded straight to your device as PDF files, or sent from your own email and WhatsApp. {BRAND.name} does not post or deliver anything on your behalf.</p>
      </>
    )
  },
  {
    slug: "about",
    title: `About ${BRAND.name}`,
    description: `Why ${BRAND.name} exists, how it works, and what it will become.`,
    updated: UPDATED,
    Body: () => (
      <>
        <h2>Why this exists</h2>
        <p>Most free invoice tools want your email before they will give you a PDF, and most of them upload your customer list to a server you know nothing about. For a document that contains your prices, your margins and your clients, that is a strange trade.</p>
        <p>{BRAND.name} does the work in your browser instead, and you can use the whole thing without an account. When you do make one, it exists to keep a copy safe and your devices in step, not to collect anything.</p>

        <h2>How it works</h2>
        <p>Everything, including the PDF, is built by code running on your own device. Tax rules live in country packs: structured data carrying rates, formats and the dates each rule applies between. Nothing is hard-coded, which is why an invoice dated before a rate change still calculates on the old rate.</p>
        <p>Amounts are held as whole paise and cents rather than decimals, so a hundred line items never drift by a rupee. The arithmetic is covered by tests, including the awkward cases: rates that change with the price of one unit, tax splitting between CGST, SGST, UTGST and IGST, and discounts spread across lines without losing a unit.</p>

        <h2>Where it is going</h2>
        <p>Documents are the start. The intention is a place to run the money side of a small business: what you are owed, what you owe, what the tax will be, and what the next few weeks look like. The same rules engine underneath, the same refusal to hold your data where it does not need to be held.</p>

        <h2>Who made it</h2>
        <p>A small team that got tired of the alternatives. Write to us at <a href={`mailto:${BRAND.email}`}>{BRAND.email}</a>: feature requests, bugs and disagreements about tax treatment are all welcome.</p>
      </>
    )
  },
  {
    slug: "contact",
    title: "Contact",
    description: `How to reach ${BRAND.name} about a bug, a feature or a tax rule that looks wrong.`,
    updated: UPDATED,
    Body: () => (
      <>
        <p>One address for everything: <a href={`mailto:${BRAND.email}`} className="font-semibold">{BRAND.email}</a></p>
        <p>We reply within 2 working days, usually sooner.</p>

        <BusinessDetails />

        <h2>Billing</h2>
        <p>To cancel, or about a charge you did not expect, write from the email you sign in with and say which business it is. See the <Link href="/cancellation-and-refunds">cancellation and refunds policy</Link>.</p>

        <h2>Reporting a bug</h2>
        <p>Tell us what you were doing, what you expected and what happened instead. Your country, the document type and the browser help. Do not send the document itself: it may contain your customer&apos;s details, and we do not need it.</p>

        <h2>A rate or a rule that looks wrong</h2>
        <p>These are the messages we most want. Tell us the country, the rate you expected, and the notification or schedule that supports it. Every rule here carries a source, and correcting one is a small change.</p>

        <h2>Feature requests</h2>
        <p>Say what you are trying to do rather than the feature you have in mind. The underlying problem is usually more useful than the proposed solution.</p>

        <h2>Press and coverage</h2>
        <p>Same address. Happy to explain how the browser-based approach works, including the parts that are awkward.</p>
      </>
    )
  }
];

export const legalBySlug = (slug: string) => LEGAL.find((p) => p.slug === slug);
