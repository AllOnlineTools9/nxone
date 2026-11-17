import { describe, expect, it, vi } from "vitest";
import { emailSender } from "../src/http/email";

describe("choosing how email goes out", () => {
  it("sends through Resend when it is chosen and the key is there", () => {
    expect(emailSender({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_x" }).constructor.name).toBe("ResendEmail");
  });

  it("says loudly when Resend is chosen but the key is missing, instead of falling back in silence", () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    emailSender({ EMAIL_PROVIDER: "resend" });
    expect(said.mock.calls[0][0]).toContain("RESEND_API_KEY secret is not set");
    said.mockRestore();
  });

  it("says loudly when the key is there but the provider was never switched", () => {
    const said = vi.spyOn(console, "error").mockImplementation(() => {});
    emailSender({ EMAIL_PROVIDER: "console", RESEND_API_KEY: "re_x" });
    expect(said.mock.calls[0][0]).toContain('EMAIL_PROVIDER is "console"');
    said.mockRestore();
  });

  it("still marks log-only mode plainly when nothing is configured", () => {
    const said = vi.spyOn(console, "warn").mockImplementation(() => {});
    emailSender({});
    expect(said.mock.calls[0][0]).toContain("was not sent");
    said.mockRestore();
  });
});
