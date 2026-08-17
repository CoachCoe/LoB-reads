/**
 * Typed errors so the server layer can keep throwing while routes map the
 * failure to the right status. Previously every thrown error became a 500 and
 * its raw message was returned to the client, which turned an authorization
 * failure into a server error and leaked Prisma constraint details.
 */

export class AuthorizationError extends Error {
  constructor(message = "You do not have permission to do that") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class NotFoundError extends Error {
  constructor(message = "Not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

/** A rule the caller broke, safe to show them (e.g. "Cannot follow yourself"). */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
