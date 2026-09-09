import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import WorkReviewSection from "@/components/reviews/WorkReviewSection";

/**
 * JR-1: a review's text could be written and never cleared.
 *
 * `WorkReviewSection` sent `content: content || undefined`, so an emptied
 * textarea sent no `content` key at all. Prisma omits undefined fields from the
 * SET clause, so the row kept its old text while the reader was told "Review
 * updated" — and a reload showed the text still there.
 *
 * The test is here rather than in the integration suite because the defect was
 * entirely in what the client SENT. The server already accepted `null` and
 * cleared correctly, so an integration test posting `null` passes against the
 * unfixed code and proves nothing. What has to be asserted is the request body.
 */

const showToast = jest.fn();
jest.mock("@/components/providers/ToastProvider", () => ({
  useToast: () => ({ showToast }),
}));

const refresh = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

/** The body of the last POST to /api/reviews, parsed. */
function lastReviewBody(): Record<string, unknown> {
  const calls = (global.fetch as jest.Mock).mock.calls;
  const post = [...calls].reverse().find(([url]) => url === "/api/reviews");
  if (!post) throw new Error("no POST to /api/reviews was made");
  return JSON.parse(post[1].body as string);
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = jest.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
  ) as unknown as typeof fetch;
});

const existing = { id: "r1", rating: 4, content: "First thoughts." };

it("sends content: null when the reader clears the text", async () => {
  render(<WorkReviewSection workKey="OL1W" existingReview={existing} />);

  const textarea = screen.getByRole("textbox");
  fireEvent.change(textarea, { target: { value: "" } });
  fireEvent.click(screen.getByRole("button", { name: /update review/i }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalled());

  const body = lastReviewBody();
  // null, not undefined and not "". undefined never reaches JSON.stringify
  // output at all, which is the whole defect: the key was simply absent.
  expect(body).toHaveProperty("content", null);
  expect(body.rating).toBe(4);
});

it("sends content: null when the text is only whitespace", async () => {
  render(<WorkReviewSection workKey="OL1W" existingReview={existing} />);

  fireEvent.change(screen.getByRole("textbox"), { target: { value: "   \n  " } });
  fireEvent.click(screen.getByRole("button", { name: /update review/i }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(lastReviewBody()).toHaveProperty("content", null);
});

it("still sends the text when there is text", async () => {
  // The control: without it, `content: null` unconditionally would pass above.
  render(<WorkReviewSection workKey="OL1W" existingReview={existing} />);

  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "Second thoughts." },
  });
  fireEvent.click(screen.getByRole("button", { name: /update review/i }));

  await waitFor(() => expect(global.fetch).toHaveBeenCalled());
  expect(lastReviewBody()).toHaveProperty("content", "Second thoughts.");
});
