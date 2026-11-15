/**
 * Sending email, behind an interface, because the provider is a decision for later and the rest of
 * the system should not care. The development adapter writes to the log rather than pretending to
 * send: a button that silently does nothing is worse than one that says what it did.
 */

export interface EmailMessage { to: string; subject: string; text: string }

export interface EmailSender {
  readonly name: string;
  /** Returns false when the message could not be sent, rather than throwing into a request. */
  send(message: EmailMessage): Promise<boolean>;
}

/** For local work. The link is printed so you can click it from the terminal. */
export class ConsoleEmail implements EmailSender {
  readonly name = "console";
  async send(message: EmailMessage): Promise<boolean> {
    console.log(`\n--- email to ${message.to} ---\n${message.subject}\n\n${message.text}\n---\n`);
    return true;
  }
}

/** Resend, chosen because it works from a Worker without an SDK. Needs RESEND_API_KEY. */
export class ResendEmail implements EmailSender {
  readonly name = "resend";
  constructor(private apiKey: string, private from: string) {}

  async send(message: EmailMessage): Promise<boolean> {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to: message.to, subject: message.subject, text: message.text })
    });
    if (!res.ok) console.error("Email failed:", res.status, await res.text().catch(() => ""));
    return res.ok;
  }
}

export function emailSender(env: { EMAIL_PROVIDER?: string; RESEND_API_KEY?: string; EMAIL_FROM?: string }): EmailSender {
  if (env.EMAIL_PROVIDER === "resend" && env.RESEND_API_KEY) {
    return new ResendEmail(env.RESEND_API_KEY, env.EMAIL_FROM ?? "NXOne <hello@nxone.io>");
  }
  return new ConsoleEmail();
}

export function loginEmail(link: string, minutes: number): EmailMessage {
  return {
    to: "",
    subject: "Your NXOne sign-in link",
    text: [
      "Here is your link to sign in to NXOne:",
      "",
      link,
      "",
      `It works once and expires in ${minutes} minutes.`,
      "If you did not ask for it, you can ignore this email. Nobody can sign in without the link.",
      "",
      "NXOne"
    ].join("\n")
  };
}

/**
 * The invitation. It says who asked, for which business, and what the person will be able to do,
 * because an email that says only "you have been invited" is indistinguishable from a phishing
 * attempt and deserves to be deleted.
 */
export function inviteEmail(link: string, opts: { org: string; invitedBy: string; role: string; days: number }): EmailMessage {
  return {
    to: "",
    subject: `${opts.invitedBy} has asked you to join ${opts.org} on NXOne`,
    text: [
      `${opts.invitedBy} has asked you to join ${opts.org} on NXOne, as ${opts.role}.`,
      "",
      link,
      "",
      `The link works once and expires in ${opts.days} days. You do not need a password: opening it signs you in.`,
      "",
      "If you were not expecting this, ignore it. Nothing happens until the link is opened, and you can tell the sender it arrived unasked.",
      "",
      "NXOne"
    ].join("\n")
  };
}
