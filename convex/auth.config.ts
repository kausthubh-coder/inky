import type { AuthConfig } from "convex/server";

export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN!,
      applicationID: process.env.CLERK_OAUTH_CLIENT_ID!,
    },
  ],
} satisfies AuthConfig;
