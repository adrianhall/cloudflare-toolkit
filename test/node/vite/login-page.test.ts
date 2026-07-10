// Tests for renderViteLoginPage (docs/SPECv2.md §5.6, §7.2, issue #14). Written fresh for this
// toolkit — upstream `cloudflare-auth` only exercised this renderer via an axe-core
// accessibility scan (jsdom + axe, not part of this toolkit's test stack), not plain content
// assertions, so there is no equivalent unit test file to port. These tests cover every branch
// in `src/lib/vite/login-page.ts`: the single-email vs. selectable-users form, the
// present/absent error banner, the first-user-checked/others-unchecked radio state, and
// HTML-escaping of untrusted input.
import { describe, expect, it } from "vitest";
import { renderViteLoginPage } from "../../../src/lib/vite/login-page.js";

describe("renderViteLoginPage", () => {
  it("renders a single free-text email input when no users are provided", () => {
    const html = renderViteLoginPage("/cdn-cgi/access/login", "/dashboard");

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('id="email"');
    expect(html).not.toContain("<fieldset>");
    expect(html).not.toContain("custom-email");
  });

  it("reflects the loginPath and redirectTo values in the form", () => {
    const html = renderViteLoginPage("/cdn-cgi/access/login", "/dashboard");

    expect(html).toContain('action="/cdn-cgi/access/login"');
    expect(html).toContain('value="/dashboard"');
  });

  it("does not render an error banner when no error is given", () => {
    const html = renderViteLoginPage("/cdn-cgi/access/login", "/");
    expect(html).not.toContain('class="error"');
  });

  it("renders an error banner with role=alert when an error is given", () => {
    const html = renderViteLoginPage(
      "/cdn-cgi/access/login",
      "/",
      [],
      "A valid email address is required."
    );
    expect(html).toContain('class="error" role="alert"');
    expect(html).toContain("A valid email address is required.");
  });

  it("renders selectable users with a name and a plain email when no name is given", () => {
    const html = renderViteLoginPage("/cdn-cgi/access/login", "/", [
      { email: "alice@example.com", name: "Alice" },
      { email: "bob@example.com" }
    ]);

    expect(html).toContain("<fieldset>");
    expect(html).toContain("Choose an identity");
    // First user (with a name): distinct name + email spans.
    expect(html).toContain('<span class="name">Alice</span>');
    expect(html).toContain('<span class="email">alice@example.com</span>');
    // Second user (no name): the email is used as the name, with no separate email span.
    expect(html).toContain('<span class="name">bob@example.com</span>');
  });

  it("checks only the first user's radio input", () => {
    const html = renderViteLoginPage("/cdn-cgi/access/login", "/", [
      { email: "alice@example.com" },
      { email: "bob@example.com" }
    ]);

    expect(html).toContain('value="alice@example.com" checked');
    expect(html).toContain('value="bob@example.com" />');
    expect(html).not.toContain('value="bob@example.com" checked');
  });

  it("shows a custom-email field alongside selectable users", () => {
    const html = renderViteLoginPage("/cdn-cgi/access/login", "/", [
      { email: "alice@example.com" }
    ]);
    expect(html).toContain('id="custom-email"');
    expect(html).toContain("Or enter a custom email address");
  });

  it("escapes HTML-significant characters in loginPath and redirectTo", () => {
    const html = renderViteLoginPage('"><script>alert(1)</script>', '"><script>alert(2)</script>');
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).not.toContain("<script>alert(2)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;script&gt;alert(2)&lt;/script&gt;");
  });

  it("escapes HTML-significant characters in the error message", () => {
    const html = renderViteLoginPage(
      "/cdn-cgi/access/login",
      "/",
      [],
      '"><script>alert(3)</script>'
    );
    expect(html).not.toContain("<script>alert(3)</script>");
    expect(html).toContain("&lt;script&gt;alert(3)&lt;/script&gt;");
  });

  it("escapes HTML-significant characters in user name and email", () => {
    const html = renderViteLoginPage("/cdn-cgi/access/login", "/", [
      { email: '"><script>alert(4)</script>', name: '"><script>alert(5)</script>' }
    ]);
    expect(html).not.toContain("<script>alert(4)</script>");
    expect(html).not.toContain("<script>alert(5)</script>");
    expect(html).toContain("&lt;script&gt;alert(4)&lt;/script&gt;");
    expect(html).toContain("&lt;script&gt;alert(5)&lt;/script&gt;");
  });
});
