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
  }
}
