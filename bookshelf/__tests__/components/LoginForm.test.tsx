import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import LoginForm from "@/app/login/LoginForm";

/**
 * FLOW-1: every sign-in failure was reported as a wrong password.
 *
 * `authorize()` throws "Too many sign-in attempts. Please wait a few minutes and
 * try again." — a message written specifically to tell someone to stop and wait —
 * and the form did `if (result?.error) setError("Invalid email or password")`,
 * discarding it. Ten failures then a *correct* password told the reader their
 * password was wrong; they retried, and before the SEC-4 fix each retry extended
 * the window.
 *
 * This is the defect class the previous audit fixed at eleven `fetch` sites. The
 * `signIn()` site was not in that list.
 *
 * Verified in next-auth 4's source rather than assumed: `core/routes/callback.js`
 * redirects with `error=${encodeURIComponent(error.message)}` when `authorize`
 * **throws** (:344-349), and only substitutes the literal "CredentialsSignin"
 * when it *returns* something falsy (:334-338). Our `authorize` throws on every
 * failure path, so the real message does arrive — which is what makes this fix
 * more than cosmetic.
 */

const mockSignIn = jest.fn();
jest.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args),
}));

const mockPush = jest.fn();
const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  useSearchParams: () => new URLSearchParams(),
}));

function submitCredentials() {
  fireEvent.change(screen.getByLabelText(/email/i), {
    target: { value: "reader@example.com" },
  });
  fireEvent.change(screen.getByLabelText(/password/i), {
    target: { value: "hunter2hunter2" },
  });
  fireEvent.click(screen.getByRole("button", { name: /sign in/i }));
}

beforeEach(() => {
  mockSignIn.mockReset();
  mockPush.mockReset();
  mockRefresh.mockReset();
});

describe("LoginForm error reporting", () => {
  it("shows the lockout message instead of blaming the password", async () => {
    const lockout =
      "Too many sign-in attempts. Please wait a few minutes and try again.";
    mockSignIn.mockResolvedValue({ error: lockout });

    render(<LoginForm />);
    submitCredentials();

    await waitFor(() => expect(screen.getByText(lockout)).toBeInTheDocument());

    // The assertion that fails on the old code: it showed this instead.
    expect(screen.queryByText("Invalid email or password")).toBeNull();
  });

  it("still says 'invalid' for an actually-invalid password", async () => {
    mockSignIn.mockResolvedValue({ error: "Invalid email or password" });

    render(<LoginForm />);
    submitCredentials();

    await waitFor(() =>
      expect(screen.getByText("Invalid email or password")).toBeInTheDocument()
    );
  });

  it("does not leak next-auth's internal code to the reader", async () => {
    // The path where authorize returns falsy rather than throwing. "CredentialsSignin"
    // is a library token, not a sentence.
    mockSignIn.mockResolvedValue({ error: "CredentialsSignin" });

    render(<LoginForm />);
    submitCredentials();

    await waitFor(() =>
      expect(screen.getByText("Invalid email or password")).toBeInTheDocument()
    );
    expect(screen.queryByText("CredentialsSignin")).toBeNull();
  });

  it("navigates on success and reports nothing", async () => {
    mockSignIn.mockResolvedValue({ error: undefined, ok: true });

    render(<LoginForm />);
    submitCredentials();

    await waitFor(() => expect(mockPush).toHaveBeenCalled());
    expect(screen.queryByText(/invalid|too many/i)).toBeNull();
  });
});
