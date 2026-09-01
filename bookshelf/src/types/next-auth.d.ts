import { DefaultSession, DefaultUser } from "next-auth";
import { DefaultJWT } from "next-auth/jwt";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      isModerator: boolean;
    } & DefaultSession["user"];
  }

  interface User extends DefaultUser {
    id: string;
    isModerator: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT extends DefaultJWT {
    id: string;
    isModerator: boolean;
    /**
     * When `isModerator` was last read from the database. The token is a bearer
     * credential: without a periodic re-read, a privilege copied into it at
     * sign-in can never be withdrawn. See the jwt callback in auth/options.ts.
     */
    checkedAt?: number;
  }
}
