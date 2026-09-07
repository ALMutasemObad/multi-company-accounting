import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RegistrationDeliveryPending } from "./RegistrationDeliveryPending";
import { deliveryCopyFor } from "./copy";

describe("registration delivery pending UI", () => {
  const render = (overrides: Partial<Parameters<typeof RegistrationDeliveryPending>[0]> = {}) => renderToStaticMarkup(
    <RegistrationDeliveryPending
      locale="en"
      busy={false}
      resendAccepted={false}
      feedback={null}
      resendLabel="Resend verification link"
      resendingLabel="Resending…"
      backLabel="Back to sign in"
      onResend={vi.fn()}
      onBack={vi.fn()}
      {...overrides}
    />,
  );

  it("shows generic queued guidance and an explicit retry without claiming delivery", () => {
    const html = render();
    expect(html).toContain(deliveryCopyFor("en").acceptedDescription);
    expect(html).toContain(deliveryCopyFor("en").resendHelp);
    expect(html).toContain("Resend verification link");
    expect(html).not.toContain(deliveryCopyFor("en").resendAccepted);
  });

  it("keeps failure feedback visible and reports only resend request acceptance", () => {
    const failed = render({ feedback: <div role="alert">Request failed safely</div> });
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("Request failed safely");
    expect(failed).toContain("Resend verification link");

    const accepted = render({ resendAccepted: true });
    expect(accepted).toContain('role="status"');
    expect(accepted).toContain(deliveryCopyFor("en").resendAccepted);
  });

  it("disables repeated resend while a request is active", () => {
    const html = render({ busy: true });
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Resending…<\/button>/u);
  });
});
